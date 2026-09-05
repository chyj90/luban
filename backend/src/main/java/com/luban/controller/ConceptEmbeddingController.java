package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.service.ConceptEmbeddingService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/concept-embeddings")
@RequiredArgsConstructor
public class ConceptEmbeddingController {

    private final ConceptEmbeddingService embeddingService;

    @PostMapping("/rebuild")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> rebuild() {
        int count = embeddingService.rebuildIndex();
        return ResponseEntity.ok(ApiResponse.ok(Map.of("status", "ok", "message", "FAISS 索引重建完成，共 " + count + " 个概念")));
    }

    @PostMapping("/regenerate-all")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> regenerateAll() {
        int count = embeddingService.regenerateAll();
        return ResponseEntity.ok(ApiResponse.ok(Map.of("status", "ok", "message", "全量 Embedding 生成完成，共 " + count + " 个概念")));
    }

    @PostMapping("/concepts/{conceptId}/regenerate")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> regenerateConcept(@PathVariable Long conceptId) {
        embeddingService.regenerateForConcept(conceptId);
        return ResponseEntity.ok(ApiResponse.ok(Map.of("status", "ok", "message", "概念 embedding 重新生成完成")));
    }

    @GetMapping("/health")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> health() {
        return ResponseEntity.ok(ApiResponse.ok(embeddingService.getHealth()));
    }
}