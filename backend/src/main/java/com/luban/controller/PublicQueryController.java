package com.luban.controller;

import com.luban.constant.ToolType;
import com.luban.dto.ApiResponse;
import com.luban.entity.ToolDefinition;
import com.luban.invoke.ExecutionContext;
import com.luban.invoke.InvocationException;
import com.luban.invoke.InvocationOrigin;
import com.luban.invoke.InvocationPrincipal;
import com.luban.invoke.InvocationRequest;
import com.luban.invoke.InvocationService;
import com.luban.invoke.TargetType;
import com.luban.repository.ApiKeyToolRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.security.ApiKeyAuthFilter;
import com.luban.service.ApiKeyRateLimiter;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 查询对外公开调用端点（X-API-Key 独立认证，无需 JWT）——与编排外调入口同一模式：
 * 认证由 ApiKeyAuthFilter 完成（挂 api_key_id），本层做限流 + api_key_tool APPROVED 授权，
 * 执行走统一漏斗（深度/环/超时护栏与 invocation_trace 审计照常生效）。
 * 路径 /api/v1/public/queries/** 被 SecurityConfig 放行，Phase 4 统一外调端点时与编排入口一并收敛。
 */
@RestController
@RequestMapping("/api/v1/public/queries")
@RequiredArgsConstructor
public class PublicQueryController {

    private final ToolDefinitionRepository toolDefinitionRepository;
    private final ApiKeyToolRepository apiKeyToolRepository;
    private final InvocationService invocationService;
    private final ApiKeyRateLimiter rateLimiter;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @PostMapping("/{toolName}/run")
    public ResponseEntity<ApiResponse<Map<String, Object>>> run(
            @PathVariable String toolName,
            @RequestBody(required = false) Map<String, Object> body,
            jakarta.servlet.http.HttpServletRequest request) {
        Long apiKeyId = (Long) request.getAttribute(ApiKeyAuthFilter.API_KEY_ATTR);
        if (apiKeyId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(ApiResponse.error("缺少有效 X-API-Key（需申请并获批查询调用权限）"));
        }
        try {
            rateLimiter.check(apiKeyId);
            ToolDefinition tool = toolDefinitionRepository.findAll().stream()
                    .filter(t -> toolName.equals(t.getName()))
                    .findFirst()
                    .orElseThrow(() -> new IllegalArgumentException("查询工具不存在: " + toolName));
            if (!ToolType.QUERY.equals(tool.getToolType())) {
                throw new IllegalArgumentException("该工具不是数据查询类型: " + toolName);
            }
            // Key 对该查询工具的授权校验（ApiKeyTool APPROVED），与编排外调同一授权粒度
            boolean approved = apiKeyToolRepository.findByApiKeyIdAndStatus(apiKeyId, "APPROVED").stream()
                    .anyMatch(kt -> kt.getToolId().equals(tool.getId()));
            if (!approved) {
                throw new SecurityException("该 API KEY 未获此查询调用授权");
            }
            long queryId = ((Number) parseConfig(tool.getConfig()).get("queryId")).longValue();
            var result = invocationService.invoke(InvocationRequest.of(
                    TargetType.QUERY, queryId, body == null ? Map.of() : body,
                    ExecutionContext.root(InvocationOrigin.PUBLIC_API,
                            InvocationPrincipal.ofApiKey(apiKeyId), null, null)));
            if (!result.isSuccess()) {
                boolean forbidden = InvocationException.FORBIDDEN.equals(result.getErrorCode());
                return ResponseEntity.status(forbidden ? HttpStatus.FORBIDDEN : HttpStatus.BAD_REQUEST)
                        .body(ApiResponse.error(result.getErrorMessage()));
            }
            return ResponseEntity.ok(ApiResponse.ok(result.dataAsMap()));
        } catch (ApiKeyRateLimiter.RateLimitExceeded e) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(ApiResponse.error(e.getMessage()));
        } catch (SecurityException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ApiResponse.error(e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    private Map<String, Object> parseConfig(String config) {
        try {
            return objectMapper.readValue(config == null ? "{}" : config,
                    new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            throw new IllegalArgumentException("查询工具配置解析失败: " + toolConfigSummary(config));
        }
    }

    private String toolConfigSummary(String config) {
        return config == null ? "null" : config.substring(0, Math.min(config.length(), 100));
    }
}
