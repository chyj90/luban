package com.luban.controller;

import com.luban.entity.ApiKey;
import com.luban.entity.ApiKeyTool;
import com.luban.entity.ToolDefinition;
import com.luban.service.ApiKeyService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/keys")
public class ApiKeyController {

    private final ApiKeyService apiKeyService;

    public ApiKeyController(ApiKeyService apiKeyService) {
        this.apiKeyService = apiKeyService;
    }

    @GetMapping("/list")
    public ResponseEntity<List<ApiKey>> list(@RequestParam Long ownerId) {
        return ResponseEntity.ok(apiKeyService.listByOwner(ownerId));
    }

    @PostMapping("/generate")
    public ResponseEntity<Map<String, String>> generate(@RequestBody Map<String, Object> params) {
        Long ownerId = ((Number) params.get("ownerId")).longValue();
        String name = (String) params.get("name");
        return ResponseEntity.ok(apiKeyService.generateKey(ownerId, name));
    }

    @PostMapping("/{keyId}/request-tool")
    public ResponseEntity<ApiKeyTool> requestToolPermission(
            @PathVariable Long keyId,
            @RequestBody Map<String, Object> params) {
        Long toolId = ((Number) params.get("toolId")).longValue();
        return ResponseEntity.ok(apiKeyService.requestToolPermission(keyId, toolId));
    }

    @GetMapping("/{keyId}/tools")
    public ResponseEntity<List<ApiKeyTool>> listKeyTools(@PathVariable Long keyId) {
        return ResponseEntity.ok(apiKeyService.listKeyTools(keyId));
    }

    @GetMapping("/available-tools")
    public ResponseEntity<List<ToolDefinition>> listAvailableTools() {
        return ResponseEntity.ok(apiKeyService.listAvailableTools());
    }

    @PostMapping("/tool-permission/{id}/approve")
    public ResponseEntity<ApiKeyTool> approveToolPermission(@PathVariable Long id) {
        return ResponseEntity.ok(apiKeyService.approveToolPermission(id));
    }

    @PostMapping("/tool-permission/{id}/reject")
    public ResponseEntity<ApiKeyTool> rejectToolPermission(@PathVariable Long id) {
        return ResponseEntity.ok(apiKeyService.rejectToolPermission(id));
    }

    @PostMapping("/{keyId}/revoke")
    public ResponseEntity<Map<String, String>> revokeKey(@PathVariable Long keyId) {
        apiKeyService.revokeKey(keyId);
        return ResponseEntity.ok(Map.of("status", "ok"));
    }
}