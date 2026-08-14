package com.luban.workflow.controller;

import com.luban.entity.User;
import com.luban.workflow.entity.*;
import com.luban.workflow.service.ProcessService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin")
@RequiredArgsConstructor
public class AdminController {

    private final ProcessService processService;

    @PutMapping("/instances/{id}/force-jump")
    public ResponseEntity<Void> forceJump(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        String targetNodeId = params.get("targetNodeId").toString();
        String comment = params.getOrDefault("comment", "").toString();
        processService.forceJump(id, targetNodeId, comment, user.getId(), user.getName());
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/instances/{id}/force-stop")
    public ResponseEntity<Void> forceStop(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        String comment = params.getOrDefault("comment", "").toString();
        processService.forceStop(id, comment, user.getId(), user.getName());
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/instances/{id}/force-withdraw")
    public ResponseEntity<Void> forceWithdraw(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        String comment = params.getOrDefault("comment", "").toString();
        processService.forceWithdraw(id, comment, user.getId(), user.getName());
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/tasks/{id}/reassign")
    public WorkflowTask reassign(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        Long newAssigneeId = Long.valueOf(params.get("newAssigneeId").toString());
        String comment = params.getOrDefault("comment", "").toString();
        return processService.reassignTask(id, newAssigneeId, comment, user.getId(), user.getName());
    }
}