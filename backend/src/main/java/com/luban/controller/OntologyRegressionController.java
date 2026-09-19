package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.entity.User;
import com.luban.service.OntologyRegressionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 语义包典型问题集回归：跑真实问数链路评估内置本体质量。
 * POST /run 异步执行，报告写入异步任务（GET /api/v1/async-tasks/{id}）。
 */
@RestController
@RequestMapping("/api/v1/ontology/regression")
@RequiredArgsConstructor
@RequirePermission(Permissions.CONNECT_CONCEPTS)
public class OntologyRegressionController {

    private final OntologyRegressionService regressionService;

    @GetMapping("/packages")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> packages() {
        return ResponseEntity.ok(ApiResponse.ok(regressionService.listPackages()));
    }

    /**
     * 运行时追加回归问题（问数流量挖出的缺口问题随包一起回归验证）。
     * body: { packageName, questions: [...], mustHitConcepts?: [...] }
     */
    @PostMapping("/packages/cases")
    public ResponseEntity<ApiResponse<Map<String, Object>>> addCases(
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal User user) {
        String packageName = body.get("packageName") instanceof String s ? s : null;
        @SuppressWarnings("unchecked")
        List<String> questions = (List<String>) body.get("questions");
        @SuppressWarnings("unchecked")
        List<String> mustHitConcepts = (List<String>) body.get("mustHitConcepts");
        return ResponseEntity.ok(ApiResponse.ok(
                regressionService.addCases(packageName, questions, mustHitConcepts, "gap-insight", user.getName())));
    }

    @PostMapping("/run")
    public ResponseEntity<ApiResponse<Map<String, Object>>> run(
            @RequestBody Map<String, String> body,
            @AuthenticationPrincipal User user) {
        String packageName = body.get("packageName");
        if (packageName == null || packageName.isBlank()) {
            throw new IllegalArgumentException("缺少 packageName");
        }
        long taskId = regressionService.run(packageName, user.getId(), user.getName());
        return ResponseEntity.ok(ApiResponse.ok(Map.of("taskId", taskId)));
    }
}
