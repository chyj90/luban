package com.luban.workflow.controller;

import com.luban.entity.User;
import com.luban.workflow.entity.*;
import com.luban.workflow.service.ProcessService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/tasks")
@RequiredArgsConstructor
public class TaskController {

    private final ProcessService processService;

    @GetMapping
    public List<WorkflowTask> list(
            @AuthenticationPrincipal User user,
            @RequestParam(required = false, defaultValue = "pending") String status,
            @RequestParam(required = false) Long applicationId,
            @RequestParam(required = false) Boolean isTest) {
        return "completed".equalsIgnoreCase(status)
                ? processService.getCompletedTasks(user.getId(), applicationId, isTest)
                : processService.getPendingTasks(user.getId(), applicationId, isTest);
    }

    @GetMapping("/{id}")
    public WorkflowTask get(@PathVariable Long id) {
        return processService.getTask(id);
    }

    @GetMapping("/by-instance/{instanceId}")
    public WorkflowTask getByInstance(@PathVariable Long instanceId, @AuthenticationPrincipal User user) {
        return processService.getMyTaskForInstance(instanceId, user.getId());
    }

    @PutMapping("/{id}/approve")
    public WorkflowTask approve(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        String comment = params.getOrDefault("comment", "").toString();
        return processService.approveTask(id, comment, user.getId(), user.getName());
    }

    @PutMapping("/{id}/reject")
    public WorkflowTask reject(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        String comment = params.getOrDefault("comment", "").toString();
        return processService.rejectTask(id, comment, user.getId(), user.getName());
    }

    @PutMapping("/{id}/transfer")
    public WorkflowTask transfer(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        Long targetUserId = Long.valueOf(params.get("targetUserId").toString());
        String targetUserName = params.getOrDefault("targetUserName", "").toString();
        String comment = params.getOrDefault("comment", "").toString();
        return processService.transferTask(id, targetUserId, targetUserName, comment, user.getId(), user.getName());
    }

    @PutMapping("/{id}/delegate")
    public WorkflowTask delegate(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        Long delegateUserId = Long.valueOf(params.get("delegateUserId").toString());
        String comment = params.getOrDefault("comment", "").toString();
        return processService.delegateTask(id, delegateUserId, comment, user.getId(), user.getName());
    }

    @PutMapping("/{id}/add-sign")
    public WorkflowTask addSign(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        Long addUserId = Long.valueOf(params.get("addUserId").toString());
        String addSignType = params.getOrDefault("addSignType", "AFTER").toString();
        String comment = params.getOrDefault("comment", "").toString();
        return processService.addSign(id, addUserId, addSignType, comment, user.getId(), user.getName());
    }

    @PostMapping("/{id}/reject-previous")
    public WorkflowTask rejectToPrevious(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        String comment = params.getOrDefault("comment", "").toString();
        return processService.rejectToPrevious(id, comment, user.getId(), user.getName());
    }
}