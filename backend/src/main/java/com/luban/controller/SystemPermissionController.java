package com.luban.controller;

import com.luban.entity.SystemPermission;
import com.luban.entity.ToolGroup;
import com.luban.entity.User;
import com.luban.dto.ApiResponse;
import com.luban.repository.SystemPermissionRepository;
import com.luban.repository.ToolGroupRepository;
import com.luban.workflow.entity.WorkflowDefinition;
import com.luban.workflow.entity.WorkflowInstance;
import com.luban.workflow.entity.WorkflowTask;
import com.luban.workflow.repository.WorkflowDefinitionRepository;
import com.luban.workflow.repository.WorkflowInstanceRepository;
import com.luban.workflow.repository.WorkflowTaskRepository;
import com.luban.workflow.service.ProcessService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@RestController
@RequestMapping("/api/v1/permissions")
@RequiredArgsConstructor
public class SystemPermissionController {

    private final SystemPermissionRepository systemPermissionRepository;
    private final ToolGroupRepository toolGroupRepository;
    private final WorkflowDefinitionRepository workflowDefinitionRepository;
    private final WorkflowInstanceRepository workflowInstanceRepository;
    private final WorkflowTaskRepository workflowTaskRepository;
    private final ProcessService processService;

    @GetMapping("/systems")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> listSystems(@AuthenticationPrincipal User user) {
        List<ToolGroup> groups = toolGroupRepository.findByStatusOrderBySortOrderAsc("ENABLED");
        List<SystemPermission> userPerms = systemPermissionRepository.findByUserId(user.getId());
        Map<Long, SystemPermission> permMap = userPerms.stream()
                .collect(Collectors.toMap(SystemPermission::getGroupId, p -> p, (a, b) -> a));

        List<Map<String, Object>> systems = new ArrayList<>();
        for (ToolGroup group : groups) {
            Map<String, Object> sys = new LinkedHashMap<>();
            sys.put("groupId", group.getId());
            sys.put("name", group.getName());
            sys.put("code", group.getCode());
            sys.put("description", group.getDescription());
            sys.put("icon", group.getIcon());

            SystemPermission perm = permMap.get(group.getId());
            if (perm == null) {
                sys.put("status", "NONE");
            } else {
                sys.put("status", perm.getStatus());
                sys.put("reason", perm.getReason());
                if (perm.getRejectReason() != null) {
                    sys.put("rejectReason", perm.getRejectReason());
                }
            }
            systems.add(sys);
        }
        return ResponseEntity.ok(ApiResponse.ok(systems));
    }

    @PostMapping("/apply")
    public ResponseEntity<ApiResponse<Map<String, Object>>> apply(
            @RequestBody Map<String, Object> request,
            @AuthenticationPrincipal User user) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            Long groupId = request.get("groupId") != null
                    ? ((Number) request.get("groupId")).longValue() : null;
            String reason = (String) request.getOrDefault("reason", "");

            if (groupId == null) {
                result.put("error", "请选择申请的系统");
                return ResponseEntity.ok(ApiResponse.ok(result));
            }

            ToolGroup group = toolGroupRepository.findById(groupId).orElse(null);
            if (group == null) {
                result.put("error", "系统不存在");
                return ResponseEntity.ok(ApiResponse.ok(result));
            }

            Optional<SystemPermission> existing = systemPermissionRepository
                    .findByUserIdAndGroupId(user.getId(), groupId);
            if (existing.isPresent()) {
                SystemPermission perm = existing.get();
                if ("APPROVED".equals(perm.getStatus())) {
                    result.put("error", "您已拥有该系统的权限");
                    return ResponseEntity.ok(ApiResponse.ok(result));
                }
                if ("PENDING".equals(perm.getStatus())) {
                    result.put("error", "该权限申请正在审批中，请勿重复提交");
                    return ResponseEntity.ok(ApiResponse.ok(result));
                }
                if ("REJECTED".equals(perm.getStatus())) {
                    perm.setStatus("PENDING");
                    perm.setReason(reason);
                    perm.setRejectReason(null);
                    perm.setRejectedAt(null);
                    WorkflowInstance wfInstance = startApprovalWorkflow(user, group, reason, perm);
                    perm.setWorkflowInstanceId(wfInstance.getId());
                    systemPermissionRepository.save(perm);
                    result.put("status", "PENDING");
                    result.put("workflowInstanceId", wfInstance.getId());
                    result.put("message", "重新提交成功，等待审批");
                    return ResponseEntity.ok(ApiResponse.ok(result));
                }
            }

            SystemPermission perm = new SystemPermission();
            perm.setUserId(user.getId());
            perm.setUserName(user.getName());
            perm.setGroupId(groupId);
            perm.setGroupName(group.getName());
            perm.setReason(reason);
            perm.setStatus("PENDING");
            perm.setCreatedAt(LocalDateTime.now());

            WorkflowInstance wfInstance = startApprovalWorkflow(user, group, reason, perm);
            perm.setWorkflowInstanceId(wfInstance.getId());
            systemPermissionRepository.save(perm);

            result.put("status", "PENDING");
            result.put("workflowInstanceId", wfInstance.getId());
            result.put("message", "申请已提交，等待审批");

        } catch (Exception e) {
            log.error("权限申请失败", e);
            result.put("error", e.getMessage());
        }
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    @GetMapping("/my")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> myPermissions(@AuthenticationPrincipal User user) {
        List<SystemPermission> perms = systemPermissionRepository.findByUserId(user.getId());
        List<Map<String, Object>> list = new ArrayList<>();
        for (SystemPermission perm : perms) {
            Map<String, Object> item = buildPermissionMap(perm);
            if (perm.getWorkflowInstanceId() != null) {
                workflowInstanceRepository.findById(perm.getWorkflowInstanceId())
                        .ifPresent(wi -> {
                            item.put("workflowStatus", wi.getStatus());
                            item.put("workflowId", wi.getId());
                            List<WorkflowTask> tasks = workflowTaskRepository
                                    .findByInstanceId(wi.getId());
                            for (WorkflowTask task : tasks) {
                                if ("PENDING".equals(task.getStatus())) {
                                    item.put("currentNode", task.getNodeName());
                                    break;
                                }
                            }
                        });
            }
            list.add(item);
        }
        return ResponseEntity.ok(ApiResponse.ok(list));
    }

    @GetMapping("/pending")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> pendingApprovals(@AuthenticationPrincipal User user) {
        List<WorkflowTask> tasks = workflowTaskRepository.findByAssigneeIdAndStatus(user.getId(), "PENDING");
        tasks.addAll(workflowTaskRepository.findByAssigneeIdAndStatus(user.getId(), "PROCESSING"));

        List<Map<String, Object>> approvals = new ArrayList<>();
        for (WorkflowTask task : tasks) {
            SystemPermission perm = systemPermissionRepository
                    .findByWorkflowInstanceId(task.getInstanceId()).orElse(null);
            if (perm == null) continue;

            Map<String, Object> item = new LinkedHashMap<>();
            item.put("taskId", task.getId());
            item.put("permissionId", perm.getId());
            item.put("applicant", perm.getUserName());
            item.put("applicantId", perm.getUserId());
            item.put("systemName", perm.getGroupName());
            item.put("groupId", perm.getGroupId());
            item.put("reason", perm.getReason());
            item.put("nodeName", task.getNodeName());
            item.put("createdAt", task.getCreatedAt() != null ? task.getCreatedAt().toString() : null);
            approvals.add(item);
        }
        return ResponseEntity.ok(ApiResponse.ok(approvals));
    }

    @PostMapping("/{id}/approve")
    public ResponseEntity<ApiResponse<Map<String, Object>>> approve(
            @PathVariable Long id,
            @RequestBody Map<String, Object> request,
            @AuthenticationPrincipal User user) {
        Map<String, Object> result = new LinkedHashMap<>();
        SystemPermission perm = systemPermissionRepository.findById(id).orElse(null);
        if (perm == null) {
            result.put("error", "申请不存在");
            return ResponseEntity.ok(ApiResponse.ok(result));
        }
        if (!"PENDING".equals(perm.getStatus())) {
            result.put("error", "该申请状态为 " + perm.getStatus() + "，无法审批");
            return ResponseEntity.ok(ApiResponse.ok(result));
        }

        String comment = (String) request.getOrDefault("comment", "同意");
        Long taskId = request.get("taskId") != null
                ? ((Number) request.get("taskId")).longValue() : null;

        if (taskId != null) {
            processService.approveTask(taskId, comment, user.getId(), user.getName());
        }

        WorkflowInstance wfInstance = perm.getWorkflowInstanceId() != null
                ? workflowInstanceRepository.findById(perm.getWorkflowInstanceId()).orElse(null) : null;

        if (wfInstance != null && "COMPLETED".equals(wfInstance.getStatus())) {
            perm.setStatus("APPROVED");
            perm.setApprovedAt(LocalDateTime.now());
            systemPermissionRepository.save(perm);
            result.put("status", "APPROVED");
            result.put("message", "审批通过，权限已生效");
        } else {
            result.put("status", "PENDING");
            result.put("message", "已审批，等待下一节点");
        }
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    @PostMapping("/{id}/reject")
    public ResponseEntity<ApiResponse<Map<String, Object>>> reject(
            @PathVariable Long id,
            @RequestBody Map<String, Object> request,
            @AuthenticationPrincipal User user) {
        Map<String, Object> result = new LinkedHashMap<>();
        SystemPermission perm = systemPermissionRepository.findById(id).orElse(null);
        if (perm == null) {
            result.put("error", "申请不存在");
            return ResponseEntity.ok(ApiResponse.ok(result));
        }

        String comment = (String) request.getOrDefault("comment", "驳回");
        if (comment.isEmpty()) {
            result.put("error", "驳回必须填写原因");
            return ResponseEntity.ok(ApiResponse.ok(result));
        }

        Long taskId = request.get("taskId") != null
                ? ((Number) request.get("taskId")).longValue() : null;

        if (taskId != null) {
            processService.rejectTask(taskId, comment, user.getId(), user.getName());
        }

        perm.setStatus("REJECTED");
        perm.setRejectReason(comment);
        perm.setRejectedAt(LocalDateTime.now());
        systemPermissionRepository.save(perm);

        result.put("status", "REJECTED");
        result.put("message", "已驳回");
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    private WorkflowInstance startApprovalWorkflow(User user, ToolGroup group, String reason,
                                                    SystemPermission perm) {
        List<WorkflowDefinition> platformDefs = workflowDefinitionRepository.findByScope("PLATFORM");
        WorkflowDefinition sysPermWf = platformDefs.stream()
                .filter(d -> "系统权限审批".equals(d.getName()) && "PUBLISHED".equals(d.getStatus()))
                .findFirst()
                .orElseThrow(() -> new RuntimeException("系统权限审批流程未配置"));

        String formData = "{"
                + "\"systemName\":\"" + group.getName() + "\","
                + "\"systemCode\":\"" + group.getCode() + "\","
                + "\"groupId\":" + group.getId() + ","
                + "\"reason\":\"" + reason.replace("\"", "\\\"") + "\","
                + "\"applicant\":\"" + user.getName() + "\""
                + "}";

        return processService.startProcess(
                sysPermWf.getId(), formData, user.getId(), user.getName());
    }

    private Map<String, Object> buildPermissionMap(SystemPermission perm) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", perm.getId());
        map.put("groupId", perm.getGroupId());
        map.put("groupName", perm.getGroupName());
        map.put("status", perm.getStatus());
        map.put("reason", perm.getReason());
        map.put("createdAt", perm.getCreatedAt() != null ? perm.getCreatedAt().toString() : null);
        map.put("approvedAt", perm.getApprovedAt() != null ? perm.getApprovedAt().toString() : null);
        if (perm.getRejectReason() != null) {
            map.put("rejectReason", perm.getRejectReason());
        }
        return map;
    }
}