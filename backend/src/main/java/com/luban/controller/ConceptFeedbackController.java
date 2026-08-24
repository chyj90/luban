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

    @PostMapping
    public ResponseEntity<ApiResponse<ConceptFeedback>> create(@RequestBody ConceptFeedback feedback) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(feedbackService.create(feedback)));
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

    @PostMapping("/quick")
    public ResponseEntity<ApiResponse<ConceptFeedback>> quickFeedback(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(feedbackService.createQuickFeedback(body)));
    }
}