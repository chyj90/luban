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

    /**
     * 语义缺口回流入口：建模 agent（DBA）开发过程中发现概念/映射缺失时，
     * 将变更草稿提交到此进入 PENDING 审批队列，与问数 agent 的 ontology_action 同链路。
     * 变更在审批通过时才执行，执行期校验失败会标记 FAILED，不会污染本体。
     */
    @PostMapping("/propose")
    public ResponseEntity<Map<String, Object>> propose(@RequestBody Map<String, Object> body) {
        User user = getCurrentUser();
        if (user == null) {
            return ResponseEntity.status(401).body(Map.of("error", "未登录"));
        }
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> changes = (List<Map<String, Object>>) body.get("changes");
        if (changes == null || changes.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "changes 不能为空"));
        }
        String sessionId = (String) body.getOrDefault("sessionId", "dba-agent");
        String reasoning = (String) body.getOrDefault("reasoning", "建模 agent 语义缺口回流");
        List<Map<String, Object>> recorded = new java.util.ArrayList<>();
        for (Map<String, Object> change : changes) {
            String operation = (String) change.getOrDefault("operation", change.getOrDefault("type", "UNKNOWN"));
            com.luban.constant.OntologyOperationType opType =
                    com.luban.constant.OntologyOperationType.from(operation);
            String entityType = (String) change.getOrDefault("entity_type",
                    opType != null ? opType.entityType() : "UNKNOWN");
            String before = change.containsKey("before") && change.get("before") != null
                    ? change.get("before").toString() : null;
            String after = change.containsKey("after") && change.get("after") != null
                    ? change.get("after").toString() : writeJson(change);
            OntologyChangeLog logEntry = changeService.recordChange(sessionId, operation, entityType, null,
                    before, after, user.getId(), user.getAccount(), "agent_proposal", reasoning);
            recorded.add(Map.of("changeId", logEntry.getChangeId(), "operation", operation,
                    "status", logEntry.getStatus()));
        }
        log.info("DBA agent proposed {} ontology changes by user {}", recorded.size(), user.getId());
        return ResponseEntity.ok(Map.of("success", true, "recorded", recorded));
    }

    private static String writeJson(Object obj) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(obj);
        } catch (Exception e) {
            return String.valueOf(obj);
        }
    }
}