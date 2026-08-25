package com.luban.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.constant.WorkflowScope;
import com.luban.entity.ApiKey;
import com.luban.entity.ApiKeyTool;
import com.luban.entity.SystemPermission;
import com.luban.entity.ToolDefinition;
import com.luban.entity.ToolGroup;
import com.luban.entity.User;
import com.luban.dto.ApiResponse;
import com.luban.repository.ApiKeyRepository;
import com.luban.repository.ApiKeyToolRepository;
import com.luban.repository.SystemPermissionRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.repository.ToolGroupRepository;
import com.luban.repository.UserRepository;
import com.luban.workflow.entity.WorkflowDefinition;
import com.luban.workflow.entity.WorkflowHistory;
import com.luban.workflow.entity.WorkflowInstance;
import com.luban.workflow.entity.WorkflowTask;
import com.luban.workflow.repository.WorkflowDefinitionRepository;
import com.luban.workflow.repository.WorkflowHistoryRepository;
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
    private final WorkflowHistoryRepository workflowHistoryRepository;
    private final ProcessService processService;
    private final ApiKeyToolRepository apiKeyToolRepository;
    private final ApiKeyRepository apiKeyRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final UserRepository userRepository;
    private final ObjectMapper objectMapper;

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
            perm.setUserName(user.getAccount());
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
        processService.populateTaskNodeNames(tasks);

        List<Map<String, Object>> approvals = new ArrayList<>();
        for (WorkflowTask task : tasks) {
            SystemPermission perm = systemPermissionRepository
                    .findByWorkflowInstanceId(task.getInstanceId()).orElse(null);
            if (perm != null) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("type", "system");
                item.put("taskId", task.getId());
                item.put("permissionId", perm.getId());
                item.put("applicant", perm.getUserName());
                item.put("applicantId", perm.getUserId());
                item.put("systemName", perm.getGroupName());
                item.put("groupId", perm.getGroupId());
                item.put("reason", perm.getReason());
                item.put("nodeName", task.getNodeName());
                item.put("createdAt", task.getCreatedAt() != null ? task.getCreatedAt().toString() : null);
                if (task.getAssigneeId() != null) {
                    userRepository.findById(task.getAssigneeId()).ifPresent(assignee -> {
                        item.put("assigneeName", assignee.getAccount());
                    });
                }
                item.put("flowStatus", buildFlowStatus(task.getInstanceId()));
                approvals.add(item);
                continue;
            }

            ApiKeyTool keyTool = apiKeyToolRepository
                    .findByWorkflowInstanceId(task.getInstanceId()).orElse(null);
            if (keyTool != null) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("type", "tool");
                item.put("taskId", task.getId());
                item.put("permissionId", keyTool.getId());
                item.put("nodeName", task.getNodeName());
                item.put("createdAt", task.getCreatedAt() != null ? task.getCreatedAt().toString() : null);
                if (task.getAssigneeId() != null) {
                    userRepository.findById(task.getAssigneeId()).ifPresent(assignee -> {
                        item.put("assigneeName", assignee.getAccount());
                    });
                }
                item.put("flowStatus", buildFlowStatus(task.getInstanceId()));

                ApiKey apiKey = apiKeyRepository.findById(keyTool.getApiKeyId()).orElse(null);
                if (apiKey != null) {
                    item.put("keyName", apiKey.getName());
                    User owner = userRepository.findById(apiKey.getOwnerId()).orElse(null);
                    if (owner != null) {
                        item.put("applicant", owner.getAccount());
                        item.put("applicantName", owner.getAccount());
                    }
                }

                ToolDefinition tool = toolDefinitionRepository.findById(keyTool.getToolId()).orElse(null);
                if (tool != null) {
                    item.put("toolName", tool.getDisplayName() != null ? tool.getDisplayName() : tool.getName());
                    ToolGroup group = toolGroupRepository.findById(tool.getGroupId()).orElse(null);
                    if (group != null) {
                        item.put("systemName", group.getName());
                    }
                }
                approvals.add(item);
            }
        }
        return ResponseEntity.ok(ApiResponse.ok(approvals));
    }

    @GetMapping("/processed")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> processedApprovals(@AuthenticationPrincipal User user) {
        List<WorkflowTask> tasks = workflowTaskRepository.findByAssigneeIdAndStatus(user.getId(), "COMPLETED");
        tasks.addAll(workflowTaskRepository.findByAssigneeIdAndStatus(user.getId(), "CANCELLED"));
        processService.populateTaskNodeNames(tasks);

        List<Map<String, Object>> approvals = new ArrayList<>();
        for (WorkflowTask task : tasks) {
            SystemPermission perm = systemPermissionRepository
                    .findByWorkflowInstanceId(task.getInstanceId()).orElse(null);
            if (perm != null) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("type", "system");
                item.put("taskId", task.getId());
                item.put("permissionId", perm.getId());
                item.put("applicant", perm.getUserName());
                item.put("applicantId", perm.getUserId());
                item.put("systemName", perm.getGroupName());
                item.put("groupId", perm.getGroupId());
                item.put("reason", perm.getReason());
                item.put("nodeName", task.getNodeName());
                item.put("action", task.getAction());
                item.put("comment", task.getComment());
                item.put("completedAt", task.getCompletedAt() != null ? task.getCompletedAt().toString() : null);
                if (task.getAssigneeId() != null) {
                    userRepository.findById(task.getAssigneeId()).ifPresent(assignee -> {
                        item.put("assigneeName", assignee.getAccount());
                    });
                }
                List<WorkflowTask> pendingTasks = workflowTaskRepository
                        .findByInstanceId(task.getInstanceId()).stream()
                        .filter(t -> "PENDING".equals(t.getStatus()) || "PROCESSING".equals(t.getStatus()))
                        .collect(Collectors.toList());
                if (!pendingTasks.isEmpty()) {
                    processService.populateTaskNodeNames(pendingTasks);
                    item.put("nextNodeName", pendingTasks.get(0).getNodeName());
                    userRepository.findById(pendingTasks.get(0).getAssigneeId()).ifPresent(a -> {
                        item.put("nextApprover", a.getAccount());
                    });
                }
                item.put("flowStatus", buildFlowStatus(task.getInstanceId()));
                approvals.add(item);
                continue;
            }

            ApiKeyTool keyTool = apiKeyToolRepository
                    .findByWorkflowInstanceId(task.getInstanceId()).orElse(null);
            if (keyTool != null) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("type", "tool");
                item.put("taskId", task.getId());
                item.put("permissionId", keyTool.getId());
                item.put("nodeName", task.getNodeName());
                item.put("action", task.getAction());
                item.put("comment", task.getComment());
                item.put("completedAt", task.getCompletedAt() != null ? task.getCompletedAt().toString() : null);
                if (task.getAssigneeId() != null) {
                    userRepository.findById(task.getAssigneeId()).ifPresent(assignee -> {
                        item.put("assigneeName", assignee.getAccount());
                    });
                }
                List<WorkflowTask> pendingTasks = workflowTaskRepository
                        .findByInstanceId(task.getInstanceId()).stream()
                        .filter(t -> "PENDING".equals(t.getStatus()) || "PROCESSING".equals(t.getStatus()))
                        .collect(Collectors.toList());
                if (!pendingTasks.isEmpty()) {
                    processService.populateTaskNodeNames(pendingTasks);
                    item.put("nextNodeName", pendingTasks.get(0).getNodeName());
                    userRepository.findById(pendingTasks.get(0).getAssigneeId()).ifPresent(a -> {
                        item.put("nextApprover", a.getAccount());
                    });
                }
                item.put("flowStatus", buildFlowStatus(task.getInstanceId()));

                ApiKey apiKey = apiKeyRepository.findById(keyTool.getApiKeyId()).orElse(null);
                if (apiKey != null) {
                    item.put("keyName", apiKey.getName());
                    User owner = userRepository.findById(apiKey.getOwnerId()).orElse(null);
                    if (owner != null) {
                        item.put("applicant", owner.getAccount());
                        item.put("applicantName", owner.getAccount());
                    }
                }

                ToolDefinition tool = toolDefinitionRepository.findById(keyTool.getToolId()).orElse(null);
                if (tool != null) {
                    item.put("toolName", tool.getDisplayName() != null ? tool.getDisplayName() : tool.getName());
                    ToolGroup group = toolGroupRepository.findById(tool.getGroupId()).orElse(null);
                    if (group != null) {
                        item.put("systemName", group.getName());
                    }
                }
                approvals.add(item);
            }
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
        if (perm != null) {
            if (!"PENDING".equals(perm.getStatus())) {
                result.put("error", "该申请状态为 " + perm.getStatus() + "，无法审批");
                return ResponseEntity.ok(ApiResponse.ok(result));
            }
            String comment = (String) request.getOrDefault("comment", "同意");
            Long taskId = request.get("taskId") != null
                    ? ((Number) request.get("taskId")).longValue() : null;
            if (taskId != null) {
                processService.approveTask(taskId, comment, user.getId(), user.getAccount());
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

        ApiKeyTool keyTool = apiKeyToolRepository.findById(id).orElse(null);
        if (keyTool != null) {
            if (!"PENDING".equals(keyTool.getStatus())) {
                result.put("error", "该申请状态为 " + keyTool.getStatus() + "，无法审批");
                return ResponseEntity.ok(ApiResponse.ok(result));
            }
            String comment = (String) request.getOrDefault("comment", "同意");
            Long taskId = request.get("taskId") != null
                    ? ((Number) request.get("taskId")).longValue() : null;
            if (taskId != null) {
                processService.approveTask(taskId, comment, user.getId(), user.getAccount());
            }
            WorkflowInstance wfInstance = keyTool.getWorkflowInstanceId() != null
                    ? workflowInstanceRepository.findById(keyTool.getWorkflowInstanceId()).orElse(null) : null;
            if (wfInstance != null && "COMPLETED".equals(wfInstance.getStatus())) {
                keyTool.setStatus("APPROVED");
                apiKeyToolRepository.save(keyTool);
                result.put("status", "APPROVED");
                result.put("message", "审批通过，权限已生效");
            } else {
                result.put("status", "PENDING");
                result.put("message", "已审批，等待下一节点");
            }
            return ResponseEntity.ok(ApiResponse.ok(result));
        }

        result.put("error", "申请不存在");
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    @PostMapping("/{id}/reject")
    public ResponseEntity<ApiResponse<Map<String, Object>>> reject(
            @PathVariable Long id,
            @RequestBody Map<String, Object> request,
            @AuthenticationPrincipal User user) {
        Map<String, Object> result = new LinkedHashMap<>();
        String comment = (String) request.getOrDefault("comment", "驳回");
        if (comment.isEmpty()) {
            result.put("error", "驳回必须填写原因");
            return ResponseEntity.ok(ApiResponse.ok(result));
        }
        Long taskId = request.get("taskId") != null
                ? ((Number) request.get("taskId")).longValue() : null;

        SystemPermission perm = systemPermissionRepository.findById(id).orElse(null);
        if (perm != null) {
            if (taskId != null) {
                processService.rejectTask(taskId, comment, user.getId(), user.getAccount());
            }
            perm.setStatus("REJECTED");
            perm.setRejectReason(comment);
            perm.setRejectedAt(LocalDateTime.now());
            systemPermissionRepository.save(perm);
            result.put("status", "REJECTED");
            result.put("message", "已驳回");
            return ResponseEntity.ok(ApiResponse.ok(result));
        }

        ApiKeyTool keyTool = apiKeyToolRepository.findById(id).orElse(null);
        if (keyTool != null) {
            if (taskId != null) {
                processService.rejectTask(taskId, comment, user.getId(), user.getAccount());
            }
            keyTool.setStatus("REJECTED");
            apiKeyToolRepository.save(keyTool);
            result.put("status", "REJECTED");
            result.put("message", "已驳回");
            return ResponseEntity.ok(ApiResponse.ok(result));
        }

        result.put("error", "申请不存在");
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    private WorkflowInstance startApprovalWorkflow(User user, ToolGroup group, String reason,
                                                    SystemPermission perm) {
        List<WorkflowDefinition> platformDefs = workflowDefinitionRepository.findByScope(WorkflowScope.PLATFORM);
        WorkflowDefinition sysPermWf = platformDefs.stream()
                .filter(d -> "系统权限审批".equals(d.getName()) && "PUBLISHED".equals(d.getStatus()))
                .findFirst()
                .orElseThrow(() -> new RuntimeException("系统权限审批流程未配置"));

        String formData = "{"
                + "\"systemName\":\"" + group.getName() + "\","
                + "\"systemCode\":\"" + group.getCode() + "\","
                + "\"groupId\":" + group.getId() + ","
                + "\"reason\":\"" + reason.replace("\"", "\\\"") + "\","
                + "\"applicant\":\"" + user.getAccount() + "\""
                + "}";

        return processService.startProcess(
                sysPermWf.getId(), formData, user.getId(), user.getAccount());
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

    private Map<String, Object> buildFlowStatus(Long instanceId) {
        Map<String, Object> result = new LinkedHashMap<>();
        WorkflowInstance instance = workflowInstanceRepository.findById(instanceId).orElse(null);
        if (instance == null) return result;

        WorkflowDefinition definition = workflowDefinitionRepository.findById(instance.getWorkflowId()).orElse(null);
        if (definition == null) return result;

        try {
            List<Map<String, Object>> nodes = objectMapper.readValue(
                    definition.getNodes(),
                    new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, Object>>>() {});
            List<Map<String, Object>> edges = objectMapper.readValue(
                    definition.getEdges(),
                    new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, Object>>>() {});

            List<Map<String, Object>> flowNodes = new ArrayList<>();
            for (Map<String, Object> node : nodes) {
                Map<String, Object> fn = new LinkedHashMap<>();
                fn.put("nodeId", node.get("nodeId"));
                fn.put("nodeType", node.get("nodeType"));
                @SuppressWarnings("unchecked")
                Map<String, Object> data = (Map<String, Object>) node.get("data");
                if (data != null) {
                    fn.put("nodeName", data.get("label"));
                } else {
                    fn.put("nodeName", node.get("label"));
                }
                flowNodes.add(fn);
            }
            result.put("nodes", flowNodes);

            List<Map<String, Object>> flowEdges = new ArrayList<>();
            for (Map<String, Object> edge : edges) {
                Map<String, Object> fe = new LinkedHashMap<>();
                fe.put("id", edge.getOrDefault("source", "") + "-" + edge.getOrDefault("target", ""));
                fe.put("source", edge.get("source"));
                fe.put("target", edge.get("target"));
                flowEdges.add(fe);
            }
            result.put("edges", flowEdges);

            List<WorkflowHistory> histories = workflowHistoryRepository
                    .findByInstanceIdOrderByCreatedAtAsc(instanceId);
            List<WorkflowTask> tasks = workflowTaskRepository.findByInstanceId(instanceId);

            Set<String> completedNodeIds = new HashSet<>();
            Set<String> activeNodeIds = new HashSet<>();

            for (WorkflowTask task : tasks) {
                if ("PENDING".equals(task.getStatus()) || "PROCESSING".equals(task.getStatus())) {
                    activeNodeIds.add(task.getNodeId());
                } else if ("COMPLETED".equals(task.getStatus())) {
                    completedNodeIds.add(task.getNodeId());
                }
            }

            for (WorkflowHistory h : histories) {
                if (h.getNodeId() != null && ("START".equals(h.getAction()) || "SUB_PROCESS_START".equals(h.getAction()))) {
                    completedNodeIds.add(h.getNodeId());
                }
            }

            List<Map<String, Object>> historyList = new ArrayList<>();
            for (String nodeId : completedNodeIds) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("nodeId", nodeId);
                item.put("status", "COMPLETED");
                historyList.add(item);
            }
            for (String nodeId : activeNodeIds) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("nodeId", nodeId);
                item.put("status", "ACTIVE");
                historyList.add(item);
            }

            Set<String> reachableCompleted = new HashSet<>(completedNodeIds);
            boolean changed = true;
            while (changed) {
                changed = false;
                for (Map<String, Object> edge : edges) {
                    String target = (String) edge.get("target");
                    String source = (String) edge.get("source");
                    if (reachableCompleted.contains(target) && !reachableCompleted.contains(source)) {
                        reachableCompleted.add(source);
                        changed = true;
                    }
                }
            }
            for (String nodeId : reachableCompleted) {
                if (!completedNodeIds.contains(nodeId) && !activeNodeIds.contains(nodeId)) {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("nodeId", nodeId);
                    item.put("status", "COMPLETED");
                    historyList.add(item);
                }
            }

            Set<String> forwardCompleted = new HashSet<>(reachableCompleted);
            changed = true;
            while (changed) {
                changed = false;
                for (Map<String, Object> edge : edges) {
                    String source = (String) edge.get("source");
                    String target = (String) edge.get("target");
                    if (forwardCompleted.contains(source) && !forwardCompleted.contains(target)
                            && !activeNodeIds.contains(target)) {
                        forwardCompleted.add(target);
                        changed = true;
                    }
                }
            }
            for (String nodeId : forwardCompleted) {
                if (!reachableCompleted.contains(nodeId) && !activeNodeIds.contains(nodeId)) {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("nodeId", nodeId);
                    item.put("status", "COMPLETED");
                    historyList.add(item);
                }
            }
            result.put("history", historyList);
        } catch (Exception e) {
            log.warn("Failed to build flow status for instance {}: {}", instanceId, e.getMessage());
        }
        return result;
    }
}