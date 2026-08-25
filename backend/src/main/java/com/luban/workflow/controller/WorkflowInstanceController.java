package com.luban.workflow.controller;

import com.luban.entity.User;
import com.luban.workflow.entity.*;
import com.luban.workflow.service.ProcessService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/workflow-instances")
@RequiredArgsConstructor
public class WorkflowInstanceController {

    private final ProcessService processService;

    @PostMapping
    public WorkflowInstance start(@RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        Long definitionId = Long.valueOf(params.get("definitionId").toString());
        String formData = params.getOrDefault("formData", "{}").toString();
        return processService.startProcess(definitionId, formData, user.getId(), user.getAccount());
    }

    @GetMapping
    public List<WorkflowInstance> list(@AuthenticationPrincipal User user,
                                        @RequestParam(required = false) Long applicationId) {
        return processService.listMyInstances(user.getId(), applicationId);
    }

    @GetMapping("/{id}")
    public WorkflowInstance get(@PathVariable Long id, @AuthenticationPrincipal User user) {
        return processService.getInstance(id, user.getId());
    }

    @GetMapping("/{id}/history")
    public List<WorkflowHistory> getHistory(@PathVariable Long id, @AuthenticationPrincipal User user) {
        return processService.getInstanceHistory(id, user.getId());
    }

    @PutMapping("/{id}/cancel")
    public ResponseEntity<Void> cancel(@PathVariable Long id, @AuthenticationPrincipal User user) {
        processService.cancelProcess(id, user.getId(), user.getAccount());
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/{id}/freeze")
    public ResponseEntity<Void> freeze(@PathVariable Long id, @AuthenticationPrincipal User user) {
        processService.freezeProcess(id, user.getId(), user.getAccount());
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/{id}/unfreeze")
    public ResponseEntity<Void> unfreeze(@PathVariable Long id, @AuthenticationPrincipal User user) {
        processService.unfreezeProcess(id, user.getId(), user.getAccount());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/reject-to")
    public ResponseEntity<Void> rejectTo(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        String targetNodeId = params.get("targetNodeId").toString();
        String comment = params.getOrDefault("comment", "").toString();
        processService.rejectToNode(id, targetNodeId, comment, user.getId(), user.getAccount());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/force-jump")
    public ResponseEntity<Void> forceJump(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        String targetNodeId = params.get("targetNodeId").toString();
        String comment = params.getOrDefault("comment", "").toString();
        processService.forceJump(id, targetNodeId, comment, user.getId(), user.getAccount());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/resubmit")
    public WorkflowInstance resubmit(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        String formData = params.getOrDefault("formData", "{}").toString();
        return processService.resubmitInstance(id, formData, user.getId(), user.getAccount());
    }

    @GetMapping("/{id}/sub-processes")
    public List<WorkflowInstance> getSubProcesses(@PathVariable Long id) {
        return processService.getSubProcessInstances(id);
    }
}