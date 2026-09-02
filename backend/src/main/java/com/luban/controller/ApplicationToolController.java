package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.entity.Application;
import com.luban.entity.ToolDefinition;
import com.luban.entity.User;
import com.luban.entity.ApplicationApiKey;
import com.luban.entity.ApiKeyTool;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.repository.ApplicationApiKeyRepository;
import com.luban.repository.ApiKeyToolRepository;
import com.luban.repository.UserRepository;
import com.luban.service.PageService;
import com.luban.workflow.entity.Role;
import com.luban.workflow.entity.RoleUser;
import com.luban.workflow.repository.RoleRepository;
import com.luban.workflow.repository.RoleUserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/application-tools")
public class ApplicationToolController {

    private static final Logger log = LoggerFactory.getLogger(ApplicationToolController.class);
    private static final Pattern VAR_PATTERN = Pattern.compile("\\{\\{(\\w+)\\}\\}");
    private static final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();

    private final ToolDefinitionRepository toolDefinitionRepository;
    private final RoleRepository roleRepository;
    private final RoleUserRepository roleUserRepository;
    private final ApplicationApiKeyRepository applicationApiKeyRepository;
    private final ApiKeyToolRepository apiKeyToolRepository;
    private final UserRepository userRepository;
    private final PageService pageService;
    private final ApplicationRepository applicationRepository;

    public ApplicationToolController(ToolDefinitionRepository toolDefinitionRepository,
                                     RoleRepository roleRepository,
                                     RoleUserRepository roleUserRepository,
                                     ApplicationApiKeyRepository applicationApiKeyRepository,
                                     ApiKeyToolRepository apiKeyToolRepository,
                                     UserRepository userRepository,
                                     PageService pageService,
                                     ApplicationRepository applicationRepository) {
        this.toolDefinitionRepository = toolDefinitionRepository;
        this.roleRepository = roleRepository;
        this.roleUserRepository = roleUserRepository;
        this.applicationApiKeyRepository = applicationApiKeyRepository;
        this.apiKeyToolRepository = apiKeyToolRepository;
        this.userRepository = userRepository;
        this.pageService = pageService;
        this.applicationRepository = applicationRepository;
    }

    @PostMapping("/{applicationId}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> create(
            @PathVariable Long applicationId,
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal User user) {
        String name = (String) body.get("name");
        String displayName = (String) body.getOrDefault("displayName", name);
        String description = (String) body.getOrDefault("description", "");
        String method = (String) body.getOrDefault("method", "GET");
        String url = (String) body.get("url");

        if (name == null || name.isBlank() || url == null || url.isBlank()) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("name 和 url 不能为空"));
        }

        String uniqueName = "app_" + applicationId + "_" + name.replaceAll("[^a-zA-Z0-9_-]", "_");
        if (toolDefinitionRepository.findByName(uniqueName).isPresent()) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("API 名称已存在: " + name));
        }

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> headers = (List<Map<String, Object>>) body.get("headers");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> queryParams = (List<Map<String, Object>>) body.get("queryParams");
        String bodyContent = (String) body.get("body");
        String contentType = (String) body.getOrDefault("contentType", "application/json");

        Map<String, Object> config = new LinkedHashMap<>();
        config.put("method", method);
        config.put("url", url);
        if (headers != null) config.put("headers", headers);
        if (queryParams != null) config.put("queryParams", queryParams);
        if (bodyContent != null && !bodyContent.isBlank()) config.put("body", bodyContent);
        config.put("contentType", contentType);

        ToolDefinition tool = new ToolDefinition();
        tool.setName(uniqueName);
        tool.setDisplayName(displayName);
        tool.setDescription(description);
        tool.setToolType("HTTP");
        tool.setGroupId(applicationId);
        tool.setScope("APPLICATION");
        tool.setConfig(toJson(config));
        tool.setCreatedBy(user.getId());

        toolDefinitionRepository.save(tool);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(toToolMap(tool)));
    }

    private void checkAppOwnership(Long applicationId, User user) {
        Application app = applicationRepository.findById(applicationId)
                .orElseThrow(() -> new IllegalArgumentException("应用不存在"));
        if (!app.getCreatedBy().equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "无权操作此应用");
        }
    }

    @PutMapping("/{applicationId}/{id}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> update(
            @PathVariable Long applicationId,
            @PathVariable Long id,
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal User user) {
        checkAppOwnership(applicationId, user);
        ToolDefinition tool = toolDefinitionRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("API 不存在: " + id));

        if (!"APPLICATION".equals(tool.getScope()) || !tool.getGroupId().equals(applicationId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ApiResponse.error("无权修改此 API"));
        }

        String displayName = (String) body.get("displayName");
        String description = (String) body.get("description");
        String method = (String) body.get("method");
        String url = (String) body.get("url");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> headers = (List<Map<String, Object>>) body.get("headers");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> queryParams = (List<Map<String, Object>>) body.get("queryParams");
        String bodyContent = (String) body.get("body");
        String contentType = (String) body.get("contentType");

        Map<String, Object> config = new LinkedHashMap<>();
        config.put("method", method != null ? method : "GET");
        config.put("url", url != null ? url : "");
        if (headers != null) config.put("headers", headers);
        if (queryParams != null) config.put("queryParams", queryParams);
        if (bodyContent != null && !bodyContent.isBlank()) config.put("body", bodyContent);
        if (contentType != null) config.put("contentType", contentType);

        if (displayName != null) tool.setDisplayName(displayName);
        if (description != null) tool.setDescription(description);
        tool.setConfig(toJson(config));

        toolDefinitionRepository.save(tool);
        return ResponseEntity.ok(ApiResponse.ok(toToolMap(tool)));
    }

    @DeleteMapping("/{applicationId}/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(
            @PathVariable Long applicationId,
            @PathVariable Long id,
            @AuthenticationPrincipal User user) {
        checkAppOwnership(applicationId, user);
        ToolDefinition tool = toolDefinitionRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("API 不存在: " + id));

        if (!"APPLICATION".equals(tool.getScope()) || !tool.getGroupId().equals(applicationId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ApiResponse.error("无权删除此 API"));
        }

        toolDefinitionRepository.delete(tool);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PostMapping("/{applicationId}/{id}/run")
    public ResponseEntity<ApiResponse<Map<String, Object>>> run(
            @PathVariable Long applicationId,
            @PathVariable Long id,
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal User user) {
        ToolDefinition tool = toolDefinitionRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("API 不存在: " + id));

        String scope = tool.getScope();
        if ("APPLICATION".equals(scope)) {
            checkAppOwnership(applicationId, user);
            if (!tool.getGroupId().equals(applicationId)) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(ApiResponse.error("无权调用此 API"));
            }
        } else if (!"PLATFORM".equals(scope)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ApiResponse.error("不支持的 API 类型"));
        }

        // 授权 API（PLATFORM scope）额外校验：白名单 + KEY 绑定权限
        if ("PLATFORM".equals(scope)) {
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
        }

        @SuppressWarnings("unchecked")
        Map<String, Object> params = (Map<String, Object>) body.getOrDefault("params", Map.of());

        try {
            Map<String, Object> config = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readValue(tool.getConfig(), Map.class);
            String method = (String) config.getOrDefault("method", "GET");
            String url = (String) config.get("url");

            if (url == null || url.isBlank()) {
                return ResponseEntity.badRequest()
                        .body(ApiResponse.error("API 未配置 URL"));
            }

            String resolvedUrl = replaceVars(url, params);

            @SuppressWarnings("unchecked")
            List<Map<String, String>> headers = (List<Map<String, String>>) config.get("headers");
            @SuppressWarnings("unchecked")
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
                result.put("body", new com.fasterxml.jackson.databind.ObjectMapper().readValue(responseBody, Object.class));
            } catch (Exception e) {
                result.put("body", responseBody);
            }

            log.info("API run: {} {} ({}ms) -> {}", tool.getDisplayName(), method, elapsed, response.statusCode());
            return ResponseEntity.ok(ApiResponse.ok(result));
        } catch (Exception e) {
            log.error("API run failed: {}", tool.getDisplayName(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(ApiResponse.error("API 调用失败: " + e.getMessage()));
        }
    }

    @GetMapping("/{applicationId}/roles")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> listRoles(
            @PathVariable Long applicationId) {
        List<Role> roles = roleRepository.findByApplicationId(applicationId);
        List<Map<String, Object>> result = roles.stream().map(role -> {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("id", role.getId());
            map.put("name", role.getName());
            map.put("slug", role.getSlug());
            map.put("description", role.getDescription());
            map.put("memberCount", roleUserRepository.findByRoleId(role.getId()).size());
            return map;
        }).collect(Collectors.toList());
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    @GetMapping("/{applicationId}/pages")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> listPages(
            @PathVariable Long applicationId) {
        return ResponseEntity.ok(ApiResponse.ok(pageService.listByApplication(applicationId)));
    }

    @PostMapping("/{applicationId}/members")
    @Transactional
    public ResponseEntity<ApiResponse<Map<String, Object>>> addMember(
            @PathVariable Long applicationId,
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal User user) {
        // 白名单校验
        if (!isAppMember(applicationId, user.getId())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ApiResponse.error("无权管理此应用成员"));
        }

        Long targetUserId = body.get("userId") instanceof Number
                ? ((Number) body.get("userId")).longValue() : null;
        Long roleId = body.get("roleId") instanceof Number
                ? ((Number) body.get("roleId")).longValue() : null;

        if (targetUserId == null || roleId == null) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("userId 和 roleId 不能为空"));
        }

        Role role = roleRepository.findById(roleId)
                .orElseThrow(() -> new RuntimeException("角色不存在: " + roleId));
        if (!role.getApplicationId().equals(applicationId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ApiResponse.error("角色不属于此应用"));
        }

        if (roleUserRepository.findByRoleIdAndUserId(roleId, targetUserId).isPresent()) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("用户已是该角色成员"));
        }

        roleUserRepository.save(new RoleUser(roleId, targetUserId));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("userId", targetUserId);
        result.put("roleId", roleId);
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    @DeleteMapping("/{applicationId}/members/{userId}")
    @Transactional
    public ResponseEntity<ApiResponse<Void>> removeMember(
            @PathVariable Long applicationId,
            @PathVariable Long userId,
            @AuthenticationPrincipal User user) {
        // 白名单校验
        if (!isAppMember(applicationId, user.getId())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ApiResponse.error("无权管理此应用成员"));
        }

        List<Role> appRoles = roleRepository.findByApplicationId(applicationId);
        for (Role role : appRoles) {
            roleUserRepository.findByRoleIdAndUserId(role.getId(), userId)
                    .ifPresent(roleUserRepository::delete);
        }

        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    private boolean isAppMember(Long applicationId, Long userId) {
        List<Role> appRoles = roleRepository.findByApplicationId(applicationId);
        List<Long> appRoleIds = appRoles.stream().map(Role::getId).toList();
        List<RoleUser> userRoles = roleUserRepository.findByUserId(userId);
        return userRoles.stream().anyMatch(ru -> appRoleIds.contains(ru.getRoleId()));
    }

    private String replaceVars(String template, Map<String, Object> params) {
        if (template == null || params == null || params.isEmpty()) return template;
        Matcher m = VAR_PATTERN.matcher(template);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String varName = m.group(1);
            Object value = params.get(varName);
            m.appendReplacement(sb, Matcher.quoteReplacement(value != null ? value.toString() : ""));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private String encode(String value) {
        try {
            return java.net.URLEncoder.encode(value, "UTF-8");
        } catch (Exception e) {
            return value;
        }
    }

    private Map<String, Object> toToolMap(ToolDefinition tool) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", tool.getId());
        map.put("name", tool.getName());
        map.put("displayName", tool.getDisplayName());
        map.put("description", tool.getDescription());
        map.put("toolType", tool.getToolType());
        map.put("groupId", tool.getGroupId());
        map.put("scope", tool.getScope());
        map.put("config", tool.getConfig());
        map.put("inputSchema", tool.getInputSchema());
        return map;
    }

    private String toJson(Object obj) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(obj);
        } catch (Exception e) {
            return "{}";
        }
    }
}