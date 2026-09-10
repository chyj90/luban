package com.luban.orchestration.controller;

import com.luban.dto.ApiResponse;
import com.luban.entity.User;
import com.luban.orchestration.dsl.OrchestrationDsl;
import com.luban.orchestration.entity.OrchestrationDefinition;
import com.luban.orchestration.entity.OrchestrationExecution;
import com.luban.orchestration.lint.OrchestrationLinter;
import com.luban.orchestration.service.OrchestrationService;
import com.luban.security.appaccess.AppAccess;
import com.luban.security.appaccess.AppAction;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * API 编排端点。
 *
 * 权限（AppAccess 三态）：
 * - CRUD/lint/试运行：DEVELOP；
 * - 发布/下线：MANAGE（外部契约变更）；
 * - 外部 invoke：数据面白名单（ApiKeyAuthFilter），编排内部按 ApiKeyTool APPROVED 校验。
 */
@RestController
@RequestMapping("/api/v1/orchestrations")
@RequiredArgsConstructor
public class OrchestrationController {

    private final OrchestrationService orchestrationService;

    @PostMapping
    @AppAccess(action = AppAction.DEVELOP, from = AppAccess.Source.BODY, key = "applicationId")
    public ResponseEntity<ApiResponse<Map<String, Object>>> create(
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal User user) {
        OrchestrationDefinition def = orchestrationService.create(
                String.valueOf(body.get("name")),
                (String) body.getOrDefault("description", ""),
                ((Number) body.get("applicationId")).longValue(),
                String.valueOf(body.get("dsl")),
                user.getId());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(Map.of("id", def.getId(), "status", def.getStatus(),
                        "currentVersionId", def.getCurrentVersionId())));
    }

    @GetMapping
    @AppAccess(action = AppAction.VIEW, from = AppAccess.Source.PARAM, key = "applicationId")
    public ResponseEntity<ApiResponse<List<OrchestrationDefinition>>> list(
            @RequestParam Long applicationId) {
        return ResponseEntity.ok(ApiResponse.ok(
                orchestrationService.listByApplication(applicationId)));
    }

    @GetMapping("/{id}")
    @AppAccess(action = AppAction.VIEW, resource = "orchestration", key = "id")
    public ResponseEntity<ApiResponse<Map<String, Object>>> get(@PathVariable Long id) {
        OrchestrationDefinition def = orchestrationService.getById(id);
        var version = orchestrationService.getCurrentVersion(def);
        return ResponseEntity.ok(ApiResponse.ok(Map.of(
                "id", def.getId(),
                "name", def.getName(),
                "description", def.getDescription() == null ? "" : def.getDescription(),
                "status", def.getStatus(),
                "currentVersionId", def.getCurrentVersionId() == null ? 0 : def.getCurrentVersionId(),
                "publishedVersionId", def.getPublishedVersionId() == null ? 0 : def.getPublishedVersionId(),
                "dsl", version == null ? "" : version.getDsl())));
    }

    /** 保存新版本（幂等：返回新 versionId） */
    @PutMapping("/{id}")
    @AppAccess(action = AppAction.DEVELOP, resource = "orchestration", key = "id")
    public ResponseEntity<ApiResponse<Map<String, Object>>> save(
            @PathVariable Long id,
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal User user) {
        var version = orchestrationService.saveVersion(id, String.valueOf(body.get("dsl")), user.getId());
        return ResponseEntity.ok(ApiResponse.ok(Map.of("versionId", version.getId())));
    }

    /** lint（不落库，直接校验 DSL 文本） */
    @PostMapping("/lint")
    @AppAccess(action = AppAction.DEVELOP, from = AppAccess.Source.BODY, key = "applicationId")
    public ResponseEntity<ApiResponse<OrchestrationLinter.LintResult>> lint(
            @RequestBody Map<String, Object> body) {
        OrchestrationDsl.Dsl dsl = orchestrationService.parseDsl(String.valueOf(body.get("dsl")));
        var result = orchestrationService.lintDsl(dsl);
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    /** 试运行：DEVELOP 权限，样例输入 */
    @PostMapping("/{id}/test-run")
    @AppAccess(action = AppAction.DEVELOP, resource = "orchestration", key = "id")
    public ResponseEntity<ApiResponse<Map<String, Object>>> testRun(
            @PathVariable Long id,
            @RequestBody(required = false) Map<String, Object> body,
            @AuthenticationPrincipal User user) {
        Map<String, Object> inputs = body == null ? Map.of()
                : (Map<String, Object>) body.getOrDefault("inputs", Map.of());
        return ResponseEntity.ok(ApiResponse.ok(
                orchestrationService.execute(id, user.getId(),
                        OrchestrationExecution.TRIGGER_USER_TEST, null, inputs)));
    }

    /** 发布：MANAGE（外部契约变更） */
    @PostMapping("/{id}/publish")
    @AppAccess(action = AppAction.MANAGE, resource = "orchestration", key = "id")
    public ResponseEntity<ApiResponse<Map<String, Object>>> publish(
            @PathVariable Long id,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(ApiResponse.ok(orchestrationService.publish(id, user.getId())));
    }

    /**
     * 外部调用（数据面语义）：调用方必须已登录（JWT），且请求携带的 X-API-Key
     * 需对发布该编排的 ToolDefinition 持有 APPROVED 授权——
     * "申请-审批后可用"，同时禁止未登录直接凭 Key 调用。
     */
    @PostMapping("/{toolName}/invoke")
    public ResponseEntity<ApiResponse<Map<String, Object>>> invokeByApiKey(
            @PathVariable String toolName,
            @AuthenticationPrincipal User user,
            @RequestHeader(value = "X-API-Key", required = false) String apiKey,
            @RequestBody(required = false) Map<String, Object> body,
            jakarta.servlet.http.HttpServletRequest request) {
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(ApiResponse.error("未登录：外部调用需平台账号登录后携带 JWT 与已授权的 X-API-Key"));
        }
        Long apiKeyId = (Long) request.getAttribute("api_key_id");
        if (apiKeyId == null) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(ApiResponse.error("缺少有效 X-API-Key（需申请并获批编排调用权限）"));
        }
        try {
            return ResponseEntity.ok(ApiResponse.ok(orchestrationService.invokeByApiKey(
                    toolName, apiKeyId, body == null ? Map.of() : body)));
        } catch (SecurityException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiResponse.error(e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ApiResponse.error(e.getMessage()));
        }
    }

    /** 执行记录（审计） */
    @GetMapping("/{id}/executions")
    @AppAccess(action = AppAction.DEVELOP, resource = "orchestration", key = "id")
    public ResponseEntity<ApiResponse<List<OrchestrationExecution>>> executions(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(orchestrationService.executions(id)));
    }
}
