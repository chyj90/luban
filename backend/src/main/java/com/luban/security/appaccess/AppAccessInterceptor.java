package com.luban.security.appaccess;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.security.CachedBodyFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 应用访问控制单点强制。
 *
 * 三层解析（注解声明优先，默认规则兜底）：
 * 1. 方法/类上有 @AppAccess：按 from/key 直接取 applicationId，或经 resource resolver 解析；
 * 2. 无注解但请求能解析出 applicationId（path 变量 / 查询参数 / JSON body 字段）：
 *    GET 按 VIEW、写方法按 DEVELOP 兜底校验（默认拒绝，防新端点裸奔）；
 * 3. 都解析不出：放行（平台级端点，如 /users/me）。
 */
@Component
public class AppAccessInterceptor implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(AppAccessInterceptor.class);
    private static final Set<HttpMethod> WRITE_METHODS =
            Set.of(HttpMethod.POST, HttpMethod.PUT, HttpMethod.PATCH, HttpMethod.DELETE);

    private final AppAccessService appAccessService;
    private final List<AppResourceResolver> resolvers;
    private final ObjectMapper objectMapper;

    public AppAccessInterceptor(AppAccessService appAccessService,
                                List<AppResourceResolver> resolvers,
                                ObjectMapper objectMapper) {
        this.appAccessService = appAccessService;
        this.resolvers = resolvers;
        this.objectMapper = objectMapper;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!(handler instanceof HandlerMethod handlerMethod)) {
            return true;
        }
        Long userId = currentUserId();
        if (userId == null) {
            return true; // 未认证请求由 Security 层拒绝；API Key 等非用户主体另有白名单约束
        }

        AppAccess annotation = handlerMethod.getMethodAnnotation(AppAccess.class);
        if (annotation == null) {
            annotation = handlerMethod.getBeanType().getAnnotation(AppAccess.class);
        }

        try {
            if (annotation != null) {
                return checkWithAnnotation(annotation, request, handlerMethod, userId);
            }
            return checkByDefaultRule(request, handlerMethod, userId);
        } catch (AppAccessService.AppAccessDeniedException e) {
            respond(response, e.getStatus(), e.getMessage());
            return false;
        }
    }

    private boolean checkWithAnnotation(AppAccess annotation, HttpServletRequest request,
                                        HandlerMethod handlerMethod, Long userId) {
        String key = annotation.key();
        AppAccess.Source from = annotation.from();

        if (!annotation.resource().isEmpty() && annotation.asResource()) {
            String resourceKey = key.isEmpty() ? "id" : key;
            Long resourceId = extractLong(request, handlerMethod, sourceOf(annotation.from(), resourceKey), resourceKey);
            if (resourceId == null) {
                return true; // 无资源 id 的请求（如列表接口的其它路径分支）交由方法自身逻辑处理
            }
            AppResourceResolver resolver = resolvers.stream()
                    .filter(r -> r.resourceType().equals(annotation.resource()))
                    .findFirst()
                    .orElseThrow(() -> new IllegalStateException("未找到资源解析器: " + annotation.resource()));
            Long appId = resolver.applicationIdOf(resourceId);
            if (appId == null) {
                if (!resolver.resourceExists(resourceId)) {
                    throw new AppAccessService.AppAccessDeniedException("资源不存在", 404);
                }
                // 平台级共享资源：按动作决定平台权限或放行（交由服务层兜底）
                String platformPerm = resolver.platformPermission(annotation.action());
                if (platformPerm != null) {
                    appAccessService.assertPlatformPermission(userId, platformPerm);
                }
                return true;
            }
            appAccessService.assertAccess(userId, appId, annotation.action());
            return true;
        }

        String directKey = key.isEmpty() ? "applicationId" : key;
        Long appId = extractLong(request, handlerMethod, sourceOf(from, directKey), directKey);
        if (appId == null) {
            return true; // 声明了鉴权但请求未携带应用标识，交由方法自身逻辑处理
        }
        appAccessService.assertAccess(userId, appId, annotation.action());
        return true;
    }

    /** 默认规则：能解析出 applicationId 就按动作级别兜底校验（写操作 DEVELOP，读操作 VIEW） */
    private boolean checkByDefaultRule(HttpServletRequest request, HandlerMethod handlerMethod, Long userId) {
        Long appId = extractLong(request, handlerMethod, AppAccess.Source.AUTO, "applicationId");
        if (appId == null) {
            return true;
        }
        boolean write = WRITE_METHODS.contains(HttpMethod.valueOf(request.getMethod()));
        AppAction action = write ? AppAction.DEVELOP : AppAction.VIEW;
        log.debug("[AppAccess] 默认规则兜底: {} {} → appId={} action={}", request.getMethod(), request.getRequestURI(), appId, action);
        appAccessService.assertAccess(userId, appId, action);
        return true;
    }

    private AppAccess.Source sourceOf(AppAccess.Source from, String key) {
        if (from != AppAccess.Source.AUTO) return from;
        return switch (key) {
            case "applicationId" -> AppAccess.Source.AUTO; // AUTO 顺序里已覆盖
            default -> AppAccess.Source.AUTO;
        };
    }

    /** 按 PATH → PARAM → BODY 顺序提取长整型值 */
    private Long extractLong(HttpServletRequest request, HandlerMethod handlerMethod,
                             AppAccess.Source from, String key) {
        if (from == AppAccess.Source.PATH || from == AppAccess.Source.AUTO) {
            Map<String, String> pathVars = pathVariables(request);
            String v = pathVars.get(key);
            if (v != null) return parseLong(v);
        }
        if (from == AppAccess.Source.PARAM || from == AppAccess.Source.AUTO) {
            String v = request.getParameter(key);
            if (v != null) return parseLong(v);
        }
        if (from == AppAccess.Source.BODY || from == AppAccess.Source.AUTO) {
            return bodyLong(request, key);
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private Map<String, String> pathVariables(HttpServletRequest request) {
        Object attr = request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
        return attr instanceof Map ? (Map<String, String>) attr : Collections.emptyMap();
    }

    private Long bodyLong(HttpServletRequest request, String key) {
        String body = (String) request.getAttribute(CachedBodyFilter.CACHED_BODY_ATTR);
        if (body == null || body.isBlank()) return null;
        try {
            JsonNode node = objectMapper.readTree(body).get(key);
            if (node == null || node.isNull()) return null;
            if (node.isNumber()) return node.asLong();
            if (node.isTextual()) return parseLong(node.asText());
        } catch (Exception ignored) {
            // 非 JSON 请求体或解析失败：视同未提供
        }
        return null;
    }

    private Long parseLong(String v) {
        try {
            return Long.valueOf(v.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private Long currentUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof com.luban.entity.User user) {
            return user.getId();
        }
        return null;
    }

    private void respond(HttpServletResponse response, int status, String message) {
        try {
            response.setStatus(status);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"success\":false,\"message\":\"" + message.replace("\"", "'") + "\"}");
        } catch (Exception e) {
            log.error("[AppAccess] 写响应失败", e);
        }
    }
}
