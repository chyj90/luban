package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.entity.ConceptEmbeddingTask;
import com.luban.entity.User;
import com.luban.service.ConceptEmbeddingService;
import com.luban.service.ConceptEmbeddingTaskService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/concept-embeddings")
@RequiredArgsConstructor
public class ConceptEmbeddingController {

    private final ConceptEmbeddingService embeddingService;
    private final ConceptEmbeddingTaskService taskService;

    @PostMapping("/rebuild")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> rebuild() {
        Long userId = getCurrentUserId();
        long taskId = embeddingService.rebuildIndexAsync(userId);
        return ResponseEntity.ok(ApiResponse.ok(Map.of("taskId", taskId, "status", "ok", "message", "索引重建任务已提交")));
    }

    @PostMapping("/regenerate-all")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> regenerateAll() {
        Long userId = getCurrentUserId();
        long taskId = embeddingService.regenerateAllAsync(userId);
        return ResponseEntity.ok(ApiResponse.ok(Map.of("taskId", taskId, "status", "ok", "message", "全量重新生成任务已提交")));
    }

    @PostMapping("/concepts/{conceptId}/regenerate")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> regenerateConcept(@PathVariable Long conceptId) {
        embeddingService.regenerateForConcept(conceptId);
        return ResponseEntity.ok(ApiResponse.ok(Map.of("status", "ok", "message", "概念 embedding 重新生成完成")));
    }

    @GetMapping("/tasks")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<List<ConceptEmbeddingTask>>> listTasks() {
        return ResponseEntity.ok(ApiResponse.ok(taskService.listTasks()));
    }

    @GetMapping("/health")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> health() {
        return ResponseEntity.ok(ApiResponse.ok(embeddingService.getHealth()));
    }

    private Long getCurrentUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof User user) {
            return user.getId();
        }
        return null;
    }
}