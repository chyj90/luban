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

@RestController
@RequestMapping("/api/v1/concept-feedback")
@RequiredArgsConstructor
public class ConceptFeedbackController {

    private final ConceptFeedbackService feedbackService;

    @GetMapping
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<List<ConceptFeedback>>> list(
            @RequestParam(required = false) String sessionId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String feedbackType) {
        if (sessionId != null) {
            return ResponseEntity.ok(ApiResponse.ok(feedbackService.listBySession(sessionId)));
        }
        if (status != null || feedbackType != null) {
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
        String pipelineId = (String) body.get("pipelineId");
        String userDescription = (String) body.get("userDescription");
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(feedbackService.createProblemFeedback(
                        sessionId, messageId, pipelineId, userDescription)));
    }

    @PutMapping("/{id}/confirm")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<ConceptFeedback>> confirm(
            @PathVariable Long id, @RequestBody Map<String, Object> body) {
        boolean confirmed = Boolean.TRUE.equals(body.get("confirmed"));
        return ResponseEntity.ok(ApiResponse.ok(feedbackService.confirm(id, confirmed)));
    }

    @PostMapping("/{id}/locate")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> locate(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(feedbackService.locate(id)));
    }

    @PutMapping("/{id}/ignore")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<ConceptFeedback>> ignore(
            @PathVariable Long id, @RequestBody Map<String, String> body) {
        return ResponseEntity.ok(ApiResponse.ok(
                feedbackService.ignore(id, body.get("reviewedBy"), body.get("reviewComment"))));
    }

    @PostMapping("/{id}/analyze")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> analyze(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(feedbackService.analyzeByLlm(id)));
    }

    @PostMapping("/{id}/preview-suggestion")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> previewSuggestion(
            @PathVariable Long id, @RequestBody Map<String, Integer> body) {
        int index = body.getOrDefault("suggestionIndex", 0);
        return ResponseEntity.ok(ApiResponse.ok(feedbackService.previewSuggestion(id, index)));
    }

    @PostMapping("/{id}/apply-suggestion")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> applySuggestion(
            @PathVariable Long id, @RequestBody Map<String, Object> body) {
        int index = ((Number) body.getOrDefault("suggestionIndex", 0)).intValue();
        String reviewedBy = (String) body.get("reviewedBy");
        return ResponseEntity.ok(ApiResponse.ok(feedbackService.applySuggestion(id, index, reviewedBy)));
    }

    @PostMapping("/batch-analyze")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> batchAnalyze(
            @RequestBody Map<String, Object> body) {
        @SuppressWarnings("unchecked")
        List<Number> ids = (List<Number>) body.get("feedbackIds");
        List<Long> feedbackIds = ids.stream().map(Number::longValue).toList();
        return ResponseEntity.ok(ApiResponse.ok(feedbackService.batchAnalyze(feedbackIds)));
    }

    @GetMapping("/stats")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> stats(
            @RequestParam(required = false) Long conceptId,
            @RequestParam(required = false) Long industryId) {
        return ResponseEntity.ok(ApiResponse.ok(feedbackService.stats(conceptId, industryId)));
    }

    @GetMapping("/dashboard")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> dashboard(
            @RequestParam(required = false) Long industryId) {
        return ResponseEntity.ok(ApiResponse.ok(feedbackService.dashboard(industryId)));
    }
}