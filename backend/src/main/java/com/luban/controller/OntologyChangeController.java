package com.luban.controller;

import com.luban.entity.OntologyChangeLog;
import com.luban.entity.User;
import com.luban.service.OntologyChangeService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/v1/ontology/changes")
@RequiredArgsConstructor
public class OntologyChangeController {

    private final OntologyChangeService changeService;

    private User getCurrentUser() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof User user) {
            return user;
        }
        return null;
    }

    @GetMapping("/session/{sessionId}")
    public ResponseEntity<List<OntologyChangeLog>> listBySession(@PathVariable String sessionId) {
        return ResponseEntity.ok(changeService.getSessionChanges(sessionId));
    }

    @GetMapping("/pending")
    public ResponseEntity<List<OntologyChangeLog>> listPending(
            @RequestParam(required = false) String sessionId) {
        if (sessionId != null && !sessionId.isEmpty()) {
            return ResponseEntity.ok(changeService.getPendingChanges(sessionId));
        }
        return ResponseEntity.ok(changeService.getAllPendingChanges());
    }

    @PostMapping("/{changeId}/approve")
    public ResponseEntity<Map<String, Object>> approveChange(@PathVariable Long changeId) {
        User user = getCurrentUser();
        if (user == null) {
            return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        }
        changeService.approveChange(changeId);
        log.info("Ontology change {} approved by user {}", changeId, user.getId());
        return ResponseEntity.ok(Map.of("success", true, "status", "APPROVED"));
    }

    @PostMapping("/{changeId}/reject")
    public ResponseEntity<Map<String, Object>> rejectChange(@PathVariable Long changeId) {
        User user = getCurrentUser();
        if (user == null) {
            return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        }
        changeService.rejectChange(changeId);
        log.info("Ontology change {} rejected by user {}", changeId, user.getId());
        return ResponseEntity.ok(Map.of("success", true, "status", "REJECTED"));
    }

    @PostMapping("/batch")
    public ResponseEntity<Map<String, Object>> batchApprove(@RequestBody Map<String, Object> body) {
        User user = getCurrentUser();
        if (user == null) {
            return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        }
        @SuppressWarnings("unchecked")
        List<Integer> changeIds = (List<Integer>) body.get("changeIds");
        if (changeIds == null || changeIds.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "changeIds 不能为空"));
        }
        List<Long> ids = changeIds.stream().map(Integer::longValue).toList();
        changeService.batchApproveChanges(ids);
        log.info("Batch approved {} ontology changes by user {}", ids.size(), user.getId());
        return ResponseEntity.ok(Map.of("success", true, "approved", ids.size()));
    }

    @PostMapping("/batch/reject")
    public ResponseEntity<Map<String, Object>> batchReject(@RequestBody Map<String, Object> body) {
        User user = getCurrentUser();
        if (user == null) {
            return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        }
        @SuppressWarnings("unchecked")
        List<Integer> changeIds = (List<Integer>) body.get("changeIds");
        if (changeIds == null || changeIds.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "changeIds 不能为空"));
        }
        List<Long> ids = changeIds.stream().map(Integer::longValue).toList();
        changeService.batchRejectChanges(ids);
        log.info("Batch rejected {} ontology changes by user {}", ids.size(), user.getId());
        return ResponseEntity.ok(Map.of("success", true, "rejected", ids.size()));
    }
}