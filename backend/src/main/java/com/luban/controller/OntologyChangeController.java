package com.luban.controller;

import com.luban.entity.OntologyChangeLog;
import com.luban.entity.User;
import com.luban.service.OntologyChangeService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/ontology/changes")
@RequiredArgsConstructor
public class OntologyChangeController {

    private final OntologyChangeService changeService;

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
    public ResponseEntity<Map<String, Object>> approveChange(
            @PathVariable Long changeId,
            HttpServletRequest request) {
        User user = (User) request.getAttribute("user");
        if (user == null) {
            return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        }
        changeService.approveChange(changeId);
        log.info("Ontology change {} approved by user {}", changeId, user.getId());
        return ResponseEntity.ok(Map.of("success", true, "status", "APPROVED"));
    }

    @PostMapping("/{changeId}/reject")
    public ResponseEntity<Map<String, Object>> rejectChange(
            @PathVariable Long changeId,
            HttpServletRequest request) {
        User user = (User) request.getAttribute("user");
        if (user == null) {
            return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        }
        changeService.rejectChange(changeId);
        log.info("Ontology change {} rejected by user {}", changeId, user.getId());
        return ResponseEntity.ok(Map.of("success", true, "status", "REJECTED"));
    }

    @PostMapping("/batch")
    public ResponseEntity<Map<String, Object>> batchApprove(
            @RequestBody Map<String, Object> body,
            HttpServletRequest request) {
        User user = (User) request.getAttribute("user");
        if (user == null) {
            return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        }
        @SuppressWarnings("unchecked")
        List<Integer> changeIds = (List<Integer>) body.get("changeIds");
        if (changeIds == null || changeIds.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "changeIds 不能为空"));
        }
        int count = 0;
        for (Integer id : changeIds) {
            changeService.approveChange(id.longValue());
            count++;
        }
        log.info("Batch approved {} ontology changes by user {}", count, user.getId());
        return ResponseEntity.ok(Map.of("success", true, "approved", count));
    }
}