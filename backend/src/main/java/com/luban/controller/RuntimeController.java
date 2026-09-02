package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.dto.RunQueryRequest;
import com.luban.dto.RunQueryResponse;
import com.luban.entity.Application;
import com.luban.entity.Page;
import com.luban.entity.ToolDefinition;
import com.luban.entity.User;
import com.luban.entity.ApplicationApiKey;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.PageRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.repository.ApplicationApiKeyRepository;
import com.luban.repository.ApiKeyToolRepository;
import com.luban.service.PageService;
import com.luban.service.QueryService;
import com.luban.workflow.entity.Role;
import com.luban.workflow.entity.RoleUser;
import com.luban.workflow.entity.RolePermission;
import com.luban.workflow.repository.RoleRepository;
import com.luban.workflow.repository.RoleUserRepository;
import com.luban.workflow.repository.RolePermissionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/runtime")
public class RuntimeController {

    private static final Logger log = LoggerFactory.getLogger(RuntimeController.class);

    private final PageService pageService;
    private final QueryService queryService;
    private final PageRepository pageRepository;
    private final ApplicationRepository applicationRepository;
    private final RoleRepository roleRepository;
    private final RoleUserRepository roleUserRepository;
    private final RolePermissionRepository rolePermissionRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final ApplicationApiKeyRepository applicationApiKeyRepository;
    private final ApiKeyToolRepository apiKeyToolRepository;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper = new com.fasterxml.jackson.databind.ObjectMapper();

    public RuntimeController(PageService pageService,
                             QueryService queryService,
                             PageRepository pageRepository,
                             ApplicationRepository applicationRepository,
                             RoleRepository roleRepository,
                             RoleUserRepository roleUserRepository,
                             RolePermissionRepository rolePermissionRepository,
                             ToolDefinitionRepository toolDefinitionRepository,
                             ApplicationApiKeyRepository applicationApiKeyRepository,
                             ApiKeyToolRepository apiKeyToolRepository) {
        this.pageService = pageService;
        this.queryService = queryService;
        this.pageRepository = pageRepository;
        this.applicationRepository = applicationRepository;
        this.roleRepository = roleRepository;
        this.roleUserRepository = roleUserRepository;
        this.rolePermissionRepository = rolePermissionRepository;
        this.toolDefinitionRepository = toolDefinitionRepository;
        this.applicationApiKeyRepository = applicationApiKeyRepository;
        this.apiKeyToolRepository = apiKeyToolRepository;
    }

    @GetMapping("/{pageId}/code")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getPageCode(
            @PathVariable Long pageId,
            @AuthenticationPrincipal User user) {
        checkPageAccess(pageId, user);
        return ResponseEntity.ok(ApiResponse.ok(pageService.getCodePage(pageId)));
    }

    @PostMapping("/{pageId}/query/{queryId}/run")
    public ResponseEntity<ApiResponse<RunQueryResponse>> runQuery(
            @PathVariable Long pageId,
            @PathVariable Long queryId,
            @RequestBody(required = false) RunQueryRequest request,
            @AuthenticationPrincipal User user) {
        checkPageAccess(pageId, user);
        if (request == null) request = new RunQueryRequest();
        return ResponseEntity.ok(ApiResponse.ok(queryService.run(queryId, request)));
    }

    @PostMapping("/{pageId}/tool/{toolId}/run")
    public ResponseEntity<ApiResponse<Map<String, Object>>> runTool(
            @PathVariable Long pageId,
            @PathVariable Long toolId,
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal User user) {
        checkPageAccess(pageId, user);

        ToolDefinition tool = toolDefinitionRepository.findById(toolId)
                .orElseThrow(() -> new RuntimeException("API 不存在: " + toolId));

        String scope = tool.getScope();
        if ("APPLICATION".equals(scope)) {
            Long applicationId = getPageApplicationId(pageId);
            if (!tool.getGroupId().equals(applicationId)) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(ApiResponse.error("无权调用此 API"));
            }
        } else if ("PLATFORM".equals(scope)) {
            Long applicationId = getPageApplicationId(pageId);
            if (!tool.getGroupId().equals(applicationId)) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(ApiResponse.error("无权调用此 API"));
            }

            List<Role> appRoles = roleRepository.findByApplicationId(applicationId);
            List<Long> appRoleIds = appRoles.stream().map(Role::getId).toList();
            List<RoleUser> userRoles = roleUserRepository.findByUserId(user.getId());
            boolean inWhitelist = userRoles.stream()
                    .anyMatch(ru -> appRoleIds.contains(ru.getRoleId()));
            if (!inWhitelist) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(ApiResponse.error("无权访问此应用，请联系管理员"));
            }

            List<ApplicationApiKey> bindings = applicationApiKeyRepository
                    .findByApplicationIdAndStatus(applicationId, "ACTIVE");
            if (bindings.isEmpty()) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(ApiResponse.error("应用未绑定有效 API KEY"));
            }
            boolean hasKeyPermission = bindings.stream().anyMatch(binding -> {
                return apiKeyToolRepository.findByApiKeyIdAndToolId(binding.getApiKeyId(), tool.getId())
                        .map(akt -> "APPROVED".equals(akt.getStatus()))
                        .orElse(false);
            });
            if (!hasKeyPermission) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(ApiResponse.error("API KEY 无权调用此工具"));
            }
        } else {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ApiResponse.error("不支持的 API 类型"));
        }

        return executeTool(tool, body);
    }

    private void checkPageAccess(Long pageId, User user) {
        Page page = pageRepository.findById(pageId)
                .orElseThrow(() -> new RuntimeException("页面不存在"));

        Application app = applicationRepository.findById(page.getApplicationId())
                .orElseThrow(() -> new RuntimeException("应用不存在"));

        if (app.getCreatedBy() != null && app.getCreatedBy().equals(user.getId())) {
            return;
        }

        List<Role> appRoles = roleRepository.findByApplicationId(page.getApplicationId());
        List<Long> appRoleIds = appRoles.stream().map(Role::getId).toList();
        List<RoleUser> userRoles = roleUserRepository.findByUserId(user.getId());
        List<Long> userRoleIds = userRoles.stream()
                .map(RoleUser::getRoleId)
                .filter(appRoleIds::contains)
                .toList();

        Set<String> pagePermissions = rolePermissionRepository.findByRoleIdIn(userRoleIds).stream()
                .map(RolePermission::getPermission)
                .filter(p -> p.startsWith("app:page:"))
                .collect(Collectors.toSet());

        if (!pagePermissions.contains("app:page:" + pageId)) {
            throw new RuntimeException("无权访问此页面");
        }
    }

    private Long getPageApplicationId(Long pageId) {
        Page page = pageRepository.findById(pageId)
                .orElseThrow(() -> new RuntimeException("页面不存在"));
        return page.getApplicationId();
    }

    @SuppressWarnings("unchecked")
    private ResponseEntity<ApiResponse<Map<String, Object>>> executeTool(ToolDefinition tool, Map<String, Object> body) {
        Map<String, Object> params = (Map<String, Object>) body.getOrDefault("params", Map.of());

        try {
            Map<String, Object> config = objectMapper.readValue(tool.getConfig(), Map.class);
            String method = (String) config.getOrDefault("method", "GET");
            String url = (String) config.get("url");

            if (url == null || url.isBlank()) {
                return ResponseEntity.badRequest()
                        .body(ApiResponse.error("API 未配置 URL"));
            }

            String resolvedUrl = replaceVars(url, params);

            List<Map<String, String>> headers = (List<Map<String, String>>) config.get("headers");
            List<Map<String, String>> queryParams = (List<Map<String, String>>) config.get("queryParams");
            String bodyContent = (String) config.get("body");
            String contentType = (String) config.getOrDefault("contentType", "application/json");

            if (queryParams != null && !queryParams.isEmpty()) {
                StringBuilder qs = new StringBuilder();
                for (Map<String, String> p : queryParams) {
                    String k = p.get("key");
                    String v = p.get("value");
                    if (k != null && !k.isBlank()) {
                        String resolvedV = replaceVars(v != null ? v : "", params);
                        if (qs.length() > 0) qs.append("&");
                        qs.append(encode(k)).append("=").append(encode(resolvedV));
                    }
                }
                if (qs.length() > 0) {
                    resolvedUrl += (resolvedUrl.contains("?") ? "&" : "?") + qs.toString();
                }
            }

            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(resolvedUrl))
                    .timeout(Duration.ofSeconds(30));

            HttpRequest.BodyPublisher bodyPublisher = HttpRequest.BodyPublishers.noBody();
            if ("POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method) || "PATCH".equalsIgnoreCase(method)) {
                if (bodyContent != null && !bodyContent.isBlank()) {
                    String resolvedBody = replaceVars(bodyContent, params);
                    bodyPublisher = HttpRequest.BodyPublishers.ofString(resolvedBody);
                    builder.header("Content-Type", contentType != null ? contentType : "application/json");
                }
            }

            builder.method(method.toUpperCase(), bodyPublisher);

            if (headers != null) {
                for (Map<String, String> h : headers) {
                    String k = h.get("key");
                    String v = h.get("value");
                    String enabled = h.get("enabled");
                    if (k != null && !k.isBlank() && !"false".equals(enabled)) {
                        builder.header(k, replaceVars(v != null ? v : "", params));
                    }
                }
            }

            long start = System.currentTimeMillis();
            HttpResponse<String> response = httpClient.send(builder.build(),
                    HttpResponse.BodyHandlers.ofString());
            long elapsed = System.currentTimeMillis() - start;

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("status", response.statusCode());
            result.put("headers", response.headers().map());
            result.put("elapsed", elapsed);

            String responseBody = response.body();
            try {
                result.put("body", objectMapper.readValue(responseBody, Object.class));
            } catch (Exception e) {
                result.put("body", responseBody);
            }

            log.info("Runtime API run: {} {} ({}ms) -> {}", tool.getDisplayName(), method, elapsed, response.statusCode());
            return ResponseEntity.ok(ApiResponse.ok(result));
        } catch (Exception e) {
            log.error("Runtime API run failed: {}", tool.getDisplayName(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(ApiResponse.error("API 调用失败: " + e.getMessage()));
        }
    }

    private String replaceVars(String template, Map<String, Object> params) {
        if (template == null || params == null || params.isEmpty()) return template;
        String result = template;
        for (Map.Entry<String, Object> entry : params.entrySet()) {
            result = result.replace("{{" + entry.getKey() + "}}", String.valueOf(entry.getValue()));
        }
        return result;
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}