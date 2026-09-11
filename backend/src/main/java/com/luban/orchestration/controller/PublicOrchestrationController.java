package com.luban.orchestration.controller;

import com.luban.dto.ApiResponse;
import com.luban.orchestration.entity.OrchestrationExecution;
import com.luban.orchestration.service.OrchestrationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 编排对外公开调用端点（X-API-Key 独立认证，无需 JWT）。
 *
 * 路径 /api/v1/public/orchestrations/** 被 SecurityConfig 放行，
 * 由 ApiKeyAuthFilter 对 X-API-Key 进行认证。
 */
@RestController
@RequestMapping("/api/v1/public/orchestrations")
@RequiredArgsConstructor
public class PublicOrchestrationController {

    private final OrchestrationService orchestrationService;

    @PostMapping("/{toolName}/invoke")
    public ResponseEntity<ApiResponse<Map<String, Object>>> invoke(
            @PathVariable String toolName,
            @RequestBody(required = false) Map<String, Object> body,
            jakarta.servlet.http.HttpServletRequest request) {
        Long apiKeyId = (Long) request.getAttribute("api_key_id");
        if (apiKeyId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(ApiResponse.error("缺少有效 X-API-Key（需申请并获批编排调用权限）"));
        }
        try {
            return ResponseEntity.ok(ApiResponse.ok(orchestrationService.invokeByApiKey(
                    toolName, apiKeyId, body == null ? Map.of() : body)));
        } catch (SecurityException e) {
            boolean rateLimited = e.getMessage() != null
                    && (e.getMessage().contains("频繁") || e.getMessage().contains("配额"));
            return ResponseEntity.status(rateLimited ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.FORBIDDEN)
                    .body(ApiResponse.error(e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ApiResponse.error(e.getMessage()));
        }
    }
}