package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.entity.ApiKey;
import com.luban.entity.ApiKeyDatasource;
import com.luban.entity.ApiKeyTool;
import com.luban.entity.Application;
import com.luban.entity.Datasource;
import com.luban.entity.ToolDefinition;
import com.luban.entity.User;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.DatasourceRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.service.ApiKeyService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/api-keys")
public class ApiKeyController {

    private final ApiKeyService apiKeyService;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final DatasourceRepository datasourceRepository;
    private final ApplicationRepository applicationRepository;

    public ApiKeyController(ApiKeyService apiKeyService,
                            ToolDefinitionRepository toolDefinitionRepository,
                            DatasourceRepository datasourceRepository,
                            ApplicationRepository applicationRepository) {
        this.apiKeyService = apiKeyService;
        this.toolDefinitionRepository = toolDefinitionRepository;
        this.datasourceRepository = datasourceRepository;
        this.applicationRepository = applicationRepository;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> list(
            @AuthenticationPrincipal User user) {
        List<ApiKey> keys = apiKeyService.listByOwner(user.getId());
        List<Map<String, Object>> result = keys.stream().map(k -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", k.getId());
            item.put("apiKeyId", k.getKeyPrefix() + "****");
            item.put("name", k.getName());
            item.put("status", k.getStatus());
            item.put("createdAt", k.getCreatedAt() != null ? k.getCreatedAt().toString() : null);
            item.put("lastUsedAt", k.getLastUsedAt() != null ? k.getLastUsedAt().toString() : null);
            return item;
        }).collect(Collectors.toList());
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<Map<String, String>>> generate(
            @AuthenticationPrincipal User user,
            @RequestBody(required = false) Map<String, Object> params) {
        String name = params != null && params.get("name") != null
                ? (String) params.get("name") : "默认 Key";
        Map<String, String> keyData = apiKeyService.generateKey(user.getId(), name);
        return ResponseEntity.ok(ApiResponse.ok(keyData));
    }

    @PostMapping("/{keyId}/request-tool")
    public ResponseEntity<ApiResponse<ApiKeyTool>> requestToolPermission(
            @PathVariable Long keyId,
            @RequestBody Map<String, Object> params,
            @AuthenticationPrincipal User user) {
        Long toolId = ((Number) params.get("toolId")).longValue();
        return ResponseEntity.ok(ApiResponse.ok(apiKeyService.requestToolPermission(keyId, toolId, user.getId(), user.getAccount())));
    }

    @PostMapping("/{keyId}/request-tools")
    public ResponseEntity<ApiResponse<List<ApiKeyTool>>> requestToolPermissions(
            @PathVariable Long keyId,
            @RequestBody Map<String, Object> params,
            @AuthenticationPrincipal User user) {
        @SuppressWarnings("unchecked")
        List<Integer> toolIds = (List<Integer>) params.get("toolIds");
        List<ApiKeyTool> results = toolIds.stream()
                .map(id -> apiKeyService.requestToolPermission(keyId, id.longValue(), user.getId(), user.getAccount()))
                .collect(Collectors.toList());
        return ResponseEntity.ok(ApiResponse.ok(results));
    }

    @GetMapping("/{keyId}/tools")
    public ResponseEntity<ApiResponse<List<ApiKeyTool>>> listKeyTools(@PathVariable Long keyId) {
        return ResponseEntity.ok(ApiResponse.ok(apiKeyService.listKeyTools(keyId)));
    }

    @GetMapping("/available-tools")
    public ResponseEntity<ApiResponse<List<ToolDefinition>>> listAvailableTools() {
        return ResponseEntity.ok(ApiResponse.ok(apiKeyService.listAvailableTools()));
    }

    @GetMapping("/application-tools")
    public ResponseEntity<ApiResponse<Map<String, Object>>> listApplicationTools(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(defaultValue = "") String search) {
        PageRequest pageRequest = PageRequest.of(page - 1, size);
        Page<ToolDefinition> toolPage;
        if (search.isBlank()) {
            toolPage = toolDefinitionRepository.findByScope("APPLICATION", pageRequest);
        } else {
            toolPage = toolDefinitionRepository.findByScopeAndSearch("APPLICATION", search, pageRequest);
        }

        Map<Long, String> appNameMap = new LinkedHashMap<>();
        List<Map<String, Object>> tools = toolPage.getContent().stream().map(t -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", t.getId());
            item.put("name", t.getName());
            item.put("displayName", t.getDisplayName());
            item.put("description", t.getDescription());
            item.put("toolType", t.getToolType() != null ? t.getToolType().getValue() : "");
            item.put("inputSchema", t.getInputSchema());
            item.put("outputSchema", t.getOutputSchema());
            item.put("config", t.getConfig());
            item.put("groupId", t.getGroupId());
            item.put("applicationId", t.getGroupId());
            String appName = appNameMap.computeIfAbsent(t.getGroupId(),
                    gid -> applicationRepository.findById(gid)
                            .map(Application::getName)
                            .orElse("未知应用"));
            item.put("applicationName", appName);
            return item;
        }).collect(Collectors.toList());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("tools", tools);
        result.put("totalPages", toolPage.getTotalPages());
        result.put("totalElements", toolPage.getTotalElements());
        result.put("page", page);
        result.put("size", size);
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    @PostMapping("/tool-permission/{id}/approve")
    @RequirePermission(Permissions.CONNECT_SYSTEMS)
    public ResponseEntity<ApiResponse<ApiKeyTool>> approveToolPermission(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(apiKeyService.approveToolPermission(id)));
    }

    @PostMapping("/tool-permission/{id}/reject")
    @RequirePermission(Permissions.CONNECT_SYSTEMS)
    public ResponseEntity<ApiResponse<ApiKeyTool>> rejectToolPermission(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(apiKeyService.rejectToolPermission(id)));
    }

    @DeleteMapping("/{keyId}")
    public ResponseEntity<ApiResponse<Map<String, String>>> revokeKey(
            @PathVariable Long keyId,
            @AuthenticationPrincipal User user) {
        apiKeyService.revokeKey(keyId, user.getId());
        return ResponseEntity.ok(ApiResponse.ok(Map.of("status", "ok")));
    }

    @PostMapping("/{keyId}/rotate")
    public ResponseEntity<ApiResponse<Map<String, String>>> rotateKey(
            @PathVariable Long keyId,
            @AuthenticationPrincipal User user) {
        Map<String, String> result = apiKeyService.rotateKey(keyId, user.getId());
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    @DeleteMapping("/{keyId}/permanent")
    public ResponseEntity<ApiResponse<Map<String, String>>> deleteKey(
            @PathVariable Long keyId,
            @AuthenticationPrincipal User user) {
        apiKeyService.deleteKey(keyId, user.getId());
        return ResponseEntity.ok(ApiResponse.ok(Map.of("status", "ok")));
    }

    @PostMapping("/{keyId}/restore")
    public ResponseEntity<ApiResponse<Map<String, String>>> restoreKey(
            @PathVariable Long keyId,
            @AuthenticationPrincipal User user) {
        apiKeyService.restoreKey(keyId, user.getId());
        return ResponseEntity.ok(ApiResponse.ok(Map.of("status", "ok")));
    }

    @PutMapping("/{keyId}/name")
    public ResponseEntity<ApiResponse<Map<String, Object>>> renameKey(
            @PathVariable Long keyId,
            @AuthenticationPrincipal User user,
            @RequestBody Map<String, Object> params) {
        String name = (String) params.get("name");
        ApiKey key = apiKeyService.renameKey(keyId, user.getId(), name);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", key.getId());
        result.put("name", key.getName());
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    // ==================== Datasource Permission ====================

    @GetMapping("/{keyId}/datasources")
    public ResponseEntity<ApiResponse<List<ApiKeyDatasource>>> listKeyDatasources(@PathVariable Long keyId) {
        return ResponseEntity.ok(ApiResponse.ok(apiKeyService.listKeyDatasources(keyId)));
    }

    @GetMapping("/available-datasources")
    public ResponseEntity<ApiResponse<List<Datasource>>> listAvailableDatasources(
            @RequestParam Long groupId) {
        return ResponseEntity.ok(ApiResponse.ok(apiKeyService.listAvailableDatasources(groupId)));
    }

    @PostMapping("/{keyId}/request-datasource")
    public ResponseEntity<ApiResponse<ApiKeyDatasource>> requestDatasourcePermission(
            @PathVariable Long keyId,
            @RequestBody Map<String, Object> params,
            @AuthenticationPrincipal User user) {
        Long datasourceId = ((Number) params.get("datasourceId")).longValue();
        return ResponseEntity.ok(ApiResponse.ok(
                apiKeyService.requestDatasourcePermission(keyId, datasourceId, user.getId(), user.getAccount())));
    }

    @PostMapping("/datasource-permission/{id}/approve")
    @RequirePermission(Permissions.CONNECT_SYSTEMS)
    public ResponseEntity<ApiResponse<ApiKeyDatasource>> approveDatasourcePermission(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(apiKeyService.approveDatasourcePermission(id)));
    }

    @PostMapping("/datasource-permission/{id}/reject")
    @RequirePermission(Permissions.CONNECT_SYSTEMS)
    public ResponseEntity<ApiResponse<ApiKeyDatasource>> rejectDatasourcePermission(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(apiKeyService.rejectDatasourcePermission(id)));
    }

}
