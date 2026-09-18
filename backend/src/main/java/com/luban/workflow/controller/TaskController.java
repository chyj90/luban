package com.luban.workflow.controller;

import com.luban.entity.User;
import com.luban.workflow.entity.*;
import com.luban.workflow.service.PreviewAsService;
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
    private final PreviewAsService previewAsService;

    @GetMapping
    public List<WorkflowTask> list(
            @AuthenticationPrincipal User user,
            @RequestParam(required = false, defaultValue = "pending") String status,
            @RequestParam(required = false) Long applicationId,
            @RequestParam(required = false) Long previewAsUserId) {
        // 身份预览：设计器切到指定平台用户查看其在本应用内的待办（仅应用所有者可用）
        if (previewAsUserId != null && applicationId != null) {
            User preview = previewAsService.resolveForApp(applicationId, previewAsUserId, user);
            return "completed".equalsIgnoreCase(status)
                    ? processService.getCompletedTasks(preview.getId(), applicationId)
                    : processService.getPendingTasks(preview.getId(), applicationId);
        }
        return "completed".equalsIgnoreCase(status)
                ? processService.getCompletedTasks(user.getId(), applicationId)
                : processService.getPendingTasks(user.getId(), applicationId);
    }

    @GetMapping("/{id}")
    public WorkflowTask get(@PathVariable Long id, @AuthenticationPrincipal User user) {
        return processService.getTask(id, user.getId());
    }

    @GetMapping("/by-instance/{instanceId}")
    public WorkflowTask getByInstance(@PathVariable Long instanceId, @AuthenticationPrincipal User user) {
        return processService.getMyTaskForInstance(instanceId, user.getId());
    }

    @PutMapping("/{id}/approve")
    public WorkflowTask approve(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user,
                                @RequestParam(required = false) Long previewAsUserId) {
        String comment = params.getOrDefault("comment", "").toString();
        // 身份预览：以指定平台用户完成审批（assignee 校验原样生效——仅真实被指派人能通过）
        if (previewAsUserId != null) {
            User preview = previewAsService.resolveForTask(id, previewAsUserId, user);
            return processService.approveTask(id, comment, preview.getId(), preview.getAccount());
        }
        return processService.approveTask(id, comment, user.getId(), user.getAccount());
    }

    @PutMapping("/{id}/reject")
    public WorkflowTask reject(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user,
                               @RequestParam(required = false) Long previewAsUserId) {
        String comment = params.getOrDefault("comment", "").toString();
        if (previewAsUserId != null) {
            User preview = previewAsService.resolveForTask(id, previewAsUserId, user);
            return processService.rejectTask(id, comment, preview.getId(), preview.getAccount());
        }
        return processService.rejectTask(id, comment, user.getId(), user.getAccount());
    }

    @PutMapping("/{id}/transfer")
    public WorkflowTask transfer(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        Long targetUserId = Long.valueOf(params.get("targetUserId").toString());
        String targetUserName = params.getOrDefault("targetUserName", "").toString();
        String comment = params.getOrDefault("comment", "").toString();
        return processService.transferTask(id, targetUserId, targetUserName, comment, user.getId(), user.getAccount());
    }

    @PutMapping("/{id}/delegate")
    public WorkflowTask delegate(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        Long delegateUserId = Long.valueOf(params.get("delegateUserId").toString());
        String comment = params.getOrDefault("comment", "").toString();
        return processService.delegateTask(id, delegateUserId, comment, user.getId(), user.getAccount());
    }

    @PutMapping("/{id}/add-sign")
    public WorkflowTask addSign(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        Long addUserId = Long.valueOf(params.get("addUserId").toString());
        String addSignType = params.getOrDefault("addSignType", "AFTER").toString();
        String comment = params.getOrDefault("comment", "").toString();
        return processService.addSign(id, addUserId, addSignType, comment, user.getId(), user.getAccount());
    }

    @PostMapping("/{id}/reject-previous")
    public WorkflowTask rejectToPrevious(@PathVariable Long id, @RequestBody Map<String, Object> params, @AuthenticationPrincipal User user) {
        String comment = params.getOrDefault("comment", "").toString();
        return processService.rejectToPrevious(id, comment, user.getId(), user.getAccount());
    }
}