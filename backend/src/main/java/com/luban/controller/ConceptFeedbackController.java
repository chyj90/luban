package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.entity.ConceptFeedback;
import com.luban.service.ConceptFeedbackService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 回答反馈（轻量采集）：问数页 👎 反馈的采集与人工处理。
 * LLM 分析/变更建议/应用链路已废弃——本体变更统一走 /ontology/changes/propose → 变更审核。
 */
@RestController
@RequestMapping("/api/v1/concept-feedback")
@RequiredArgsConstructor
public class ConceptFeedbackController {

    private final ConceptFeedbackService feedbackService;

    @GetMapping
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<List<ConceptFeedback>>> list(
            @RequestParam(required = false) String sessionId,
            @RequestParam(required = false) String status) {
        if (sessionId != null) {
            return ResponseEntity.ok(ApiResponse.ok(feedbackService.listBySession(sessionId)));
        }
        if (status != null) {
            return ResponseEntity.ok(ApiResponse.ok(feedbackService.listByStatus(status)));
        }
        return ResponseEntity.ok(ApiResponse.ok(feedbackService.listAll()));
    }

    @GetMapping("/{id}")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<ConceptFeedback>> getById(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(feedbackService.getById(id)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<ConceptFeedback>> createProblemFeedback(
            @RequestBody Map<String, Object> body) {
        String sessionId = (String) body.get("sessionId");
        String messageId = (String) body.get("messageId");
        String userDescription = (String) body.get("userDescription");
        String userQuestion = (String) body.get("userQuestion");
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(feedbackService.createProblemFeedback(
                        sessionId, messageId, userDescription, userQuestion)));
    }

    @PutMapping("/{id}/ignore")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<ConceptFeedback>> ignore(
            @PathVariable Long id, @RequestBody Map<String, String> body) {
        return ResponseEntity.ok(ApiResponse.ok(
                feedbackService.ignore(id, body.get("reviewedBy"), body.get("reviewComment"))));
    }

    @DeleteMapping("/{id}")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        feedbackService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}
