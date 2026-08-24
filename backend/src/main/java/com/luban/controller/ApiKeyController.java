package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.entity.ApiKey;
import com.luban.entity.ApiKeyDatasource;
import com.luban.entity.ApiKeyTool;
import com.luban.entity.Application;
import com.luban.entity.ApplicationApiKey;
import com.luban.entity.Datasource;
import com.luban.entity.ToolDefinition;
import com.luban.entity.User;
import com.luban.repository.DatasourceRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.service.ApiKeyService;
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

    public ApiKeyController(ApiKeyService apiKeyService,
                            ToolDefinitionRepository toolDefinitionRepository,
                            DatasourceRepository datasourceRepository) {
        this.apiKeyService = apiKeyService;
        this.toolDefinitionRepository = toolDefinitionRepository;
        this.datasourceRepository = datasourceRepository;
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

    @PostMapping("/tool-permission/{id}/approve")
    public ResponseEntity<ApiResponse<ApiKeyTool>> approveToolPermission(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(apiKeyService.approveToolPermission(id)));
    }

    @PostMapping("/tool-permission/{id}/reject")
    public ResponseEntity<ApiResponse<ApiKeyTool>> rejectToolPermission(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(apiKeyService.rejectToolPermission(id)));
    }

    @DeleteMapping("/{keyId}")
    public ResponseEntity<ApiResponse<Map<String, String>>> revokeKey(@PathVariable Long keyId) {
        apiKeyService.revokeKey(keyId);
        return ResponseEntity.ok(ApiResponse.ok(Map.of("status", "ok")));
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
    public ResponseEntity<ApiResponse<ApiKeyDatasource>> approveDatasourcePermission(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(apiKeyService.approveDatasourcePermission(id)));
    }

    @PostMapping("/datasource-permission/{id}/reject")
    public ResponseEntity<ApiResponse<ApiKeyDatasource>> rejectDatasourcePermission(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(apiKeyService.rejectDatasourcePermission(id)));
    }

    // ==================== Application Binding ====================

    @GetMapping("/by-application/{applicationId}")
    public ResponseEntity<ApiResponse<List<ApiKey>>> listKeysByApplication(@PathVariable Long applicationId) {
        return ResponseEntity.ok(ApiResponse.ok(apiKeyService.listKeysByApplication(applicationId)));
    }

    @GetMapping("/{keyId}/applications")
    public ResponseEntity<ApiResponse<List<Application>>> listApplicationsByKey(@PathVariable Long keyId) {
        return ResponseEntity.ok(ApiResponse.ok(apiKeyService.listApplicationsByKey(keyId)));
    }

    @PostMapping("/{keyId}/bind-application")
    public ResponseEntity<ApiResponse<ApplicationApiKey>> bindApplication(
            @PathVariable Long keyId,
            @RequestBody Map<String, Object> params,
            @AuthenticationPrincipal User user) {
        Long applicationId = ((Number) params.get("applicationId")).longValue();
        return ResponseEntity.ok(ApiResponse.ok(
                apiKeyService.bindApplication(keyId, applicationId, user.getId())));
    }

    @PostMapping("/{keyId}/unbind-application")
    public ResponseEntity<ApiResponse<Map<String, String>>> unbindApplication(
            @PathVariable Long keyId,
            @RequestBody Map<String, Object> params,
            @AuthenticationPrincipal User user) {
        Long applicationId = ((Number) params.get("applicationId")).longValue();
        apiKeyService.unbindApplication(keyId, applicationId, user.getId());
        return ResponseEntity.ok(ApiResponse.ok(Map.of("status", "ok")));
    }

    // ==================== Application Resource Aggregation ====================

    @GetMapping("/application/{applicationId}/tools")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> listApplicationTools(
            @PathVariable Long applicationId) {
        List<ApiKeyTool> approved = apiKeyService.listApprovedToolsForApplication(applicationId);
        List<Map<String, Object>> result = approved.stream().map(kt -> {
            Map<String, Object> item = new LinkedHashMap<>();
            ToolDefinition tool = toolDefinitionRepository.findById(kt.getToolId()).orElse(null);
            item.put("id", kt.getId());
            item.put("toolId", kt.getToolId());
            item.put("apiKeyId", kt.getApiKeyId());
            item.put("status", kt.getStatus());
            item.put("toolName", tool != null ? tool.getName() : "未知工具");
            item.put("displayName", tool != null ? tool.getDisplayName() : "未知工具");
            item.put("description", tool != null ? tool.getDescription() : "");
            item.put("toolType", tool != null ? tool.getToolType() : "");
            item.put("inputSchema", tool != null ? tool.getInputSchema() : "");
            item.put("outputSchema", tool != null ? tool.getOutputSchema() : "");
            return item;
        }).collect(Collectors.toList());
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    @GetMapping("/application/{applicationId}/datasources")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> listApplicationDatasources(
            @PathVariable Long applicationId) {
        List<ApiKeyDatasource> approved = apiKeyService.listApprovedDatasourcesForApplication(applicationId);
        List<Map<String, Object>> result = approved.stream().map(kd -> {
            Map<String, Object> item = new LinkedHashMap<>();
            Datasource ds = datasourceRepository.findById(kd.getDatasourceId()).orElse(null);
            item.put("id", kd.getId());
            item.put("datasourceId", kd.getDatasourceId());
            item.put("apiKeyId", kd.getApiKeyId());
            item.put("status", kd.getStatus());
            item.put("name", ds != null ? ds.getName() : "未知数据源");
            item.put("type", ds != null ? ds.getType() : "");
            item.put("config", ds != null ? ds.getConfig() : "{}");
            return item;
        }).collect(Collectors.toList());
        return ResponseEntity.ok(ApiResponse.ok(result));
    }
}