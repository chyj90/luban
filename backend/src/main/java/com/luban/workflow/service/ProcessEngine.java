package com.luban.workflow.service;

import com.luban.constant.TaskOperation;
import com.luban.constant.WorkflowScope;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.User;
import com.luban.entity.UserDept;
import com.luban.repository.UserRepository;
import com.luban.repository.UserDeptRepository;
import com.luban.workflow.entity.*;
import com.luban.workflow.repository.*;
import com.luban.workflow.entity.FormWorkflowBinding;
import com.luban.util.AgentLogger;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.script.ScriptEngine;
import javax.script.ScriptEngineManager;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class ProcessEngine {

    private final WorkflowInstanceRepository workflowInstanceRepository;
    private final WorkflowTaskRepository workflowTaskRepository;
    private final WorkflowHistoryRepository workflowHistoryRepository;
    private final WorkflowDefinitionRepository workflowDefinitionRepository;
    private final FormDefinitionRepository formDefinitionRepository;
    private final FormWorkflowBindingRepository formWorkflowBindingRepository;
    private final UserRepository userRepository;
    private final UserDeptRepository userDeptRepository;
    private final RoleRepository roleRepository;
    private final RoleUserRepository roleUserRepository;
    private final DepartmentRepository departmentRepository;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    // ============================================================
    // 内部数据结构
    // ============================================================

    @SuppressWarnings("unused")
    private static class NodeDef {
        public String nodeId;
        public String nodeType;
        public String nodeName;
        public Map<String, Object> position;
        public Map<String, Object> config;
    }

    @SuppressWarnings("unused")
    private static class EdgeDef {
        public String id;
        public String source;
        public String target;
        public String label;
        public String condition;
    }

    // ============================================================
    // 1. 发起流程
    // ============================================================

    @Transactional
    public WorkflowInstance startProcess(Long workflowDefinitionId, String formDataJson,
                                          Long initiatorId, String initiatorName) {
        WorkflowDefinition definition = workflowDefinitionRepository.findById(workflowDefinitionId)
                .orElseThrow(() -> new RuntimeException("流程定义不存在: " + workflowDefinitionId));

        if (!"PUBLISHED".equals(definition.getStatus())) {
            throw new RuntimeException("流程定义未发布，无法发起");
        }

        WorkflowInstance instance = new WorkflowInstance();
        instance.setWorkflowId(definition.getId());
        instance.setApplicationId(definition.getApplicationId());
        instance.setWorkflowVersion(definition.getVersion());
        instance.setDefinitionVersion(definition.getVersion());

        Long bindingWorkflowId = "DRAFT".equals(definition.getStatus())
                ? definition.getPublishedVersionId() : definition.getId();
        List<FormWorkflowBinding> bindings = formWorkflowBindingRepository.findByWorkflowId(bindingWorkflowId);
        AgentLogger.bug("bug-formId-zero.log",
            String.format("startProcess defId=%d, defVersion=%d, publishedVersionId=%d, bindingWorkflowId=%d, bindingsCount=%d, bindings=%s",
                definition.getId(), definition.getVersion(), definition.getPublishedVersionId(),
                bindingWorkflowId, bindings.size(), bindings));
        if (!bindings.isEmpty()) {
            instance.setFormId(bindings.get(0).getFormId());
            AgentLogger.bug("bug-formId-zero.log",
                String.format("formId set from binding: %d", bindings.get(0).getFormId()));
        } else {
            instance.setFormId(0L);
            AgentLogger.bug("bug-formId-zero.log", "WARN: no binding found, formId set to 0");
        }

        instance.setStatus("RUNNING");
        instance.setFormData(formDataJson);
        instance.setInitiatorId(initiatorId);
        instance.setStartedAt(LocalDateTime.now());

        workflowInstanceRepository.save(instance);

        recordHistory(instance.getId(), null, "START", "SUBMIT", initiatorId,
                "发起流程", null, null, null);

        // 找到开始节点后的第一个节点，创建任务
        createTasksForNextNodes(definition, instance, "start", formDataJson);

        return instance;
    }

    // ============================================================
    // 2. 完成任务（审批通过/驳回）
    // ============================================================

    @Transactional
    public WorkflowTask completeTask(Long taskId, String action, String comment,
                                      Long operatorId, String operatorName) {
        WorkflowTask task = workflowTaskRepository.findById(taskId)
                .orElseThrow(() -> new RuntimeException("任务不存在: " + taskId));

        if (!"PENDING".equals(task.getStatus()) && !"PROCESSING".equals(task.getStatus())) {
            throw new RuntimeException("任务已被处理");
        }

        checkTaskAssignee(task, operatorId, TaskOperation.APPROVE);

        WorkflowInstance instance = workflowInstanceRepository.findById(task.getInstanceId())
                .orElseThrow(() -> new RuntimeException("流程实例不存在: " + task.getInstanceId()));

        // 一票否决：会签模式下，任一审批人驳回，立即驳回整个流程
        if ("REJECT".equals(action) && "all_pass".equals(task.getCollaborationMode())) {
            task.setStatus("COMPLETED");
            task.setAction(action);
            task.setComment(comment);
            task.setCompletedAt(LocalDateTime.now());
            workflowTaskRepository.save(task);
            recordHistory(instance.getId(), task.getId(), task.getNodeId(), action,
                    operatorId, comment, null, null, null);

            // 取消其他待处理任务
            cancelAllPendingTasks(instance.getId());
            rejectToStart(instance, task.getNodeId(), comment, operatorId);
            return task;
        }

        // 处理协作模式：记录当前审批人完成
        if ("all_pass".equals(task.getCollaborationMode()) || "ratio_pass".equals(task.getCollaborationMode())) {
            Set<Long> completed = parseIdSet(task.getCompletedAssigneeIds());
            completed.add(operatorId);
            String completedJson = objectMapper.valueToTree(new ArrayList<>(completed)).toString();
            task.setCompletedAssigneeIds(completedJson);

            Set<Long> allAssignees = parseIdSet(task.getAllAssigneeIds());
            if ("all_pass".equals(task.getCollaborationMode())) {
                List<WorkflowTask> siblings = workflowTaskRepository.findByInstanceIdAndNodeId(instance.getId(), task.getNodeId());
                if (completed.size() < allAssignees.size()) {
                    task.setStatus("PROCESSING");
                    for (WorkflowTask s : siblings) {
                        if (!s.getId().equals(task.getId())) {
                            s.setCompletedAssigneeIds(completedJson);
                        }
                    }
                    workflowTaskRepository.saveAll(siblings);
                    recordHistory(instance.getId(), task.getId(), task.getNodeId(), action,
                            operatorId, comment, null, null, null);
                    return task;
                }
                // 所有人都完成了，同步所有兄弟任务为 COMPLETED
                WorkflowDefinition definition = workflowDefinitionRepository.findById(instance.getWorkflowId())
                        .orElseThrow(() -> new RuntimeException("流程定义不存在"));
                for (WorkflowTask s : siblings) {
                    s.setCompletedAssigneeIds(completedJson);
                    s.setStatus("COMPLETED");
                    s.setAction(action);
                    s.setCompletedAt(LocalDateTime.now());
                }
                workflowTaskRepository.saveAll(siblings);
                recordHistory(instance.getId(), task.getId(), task.getNodeId(), action,
                        operatorId, comment, null, null, null);
                createTasksForNextNodes(definition, instance, task.getNodeId(), instance.getFormData());
                checkAndCompleteInstance(instance);
                return task;
            }
            if ("ratio_pass".equals(task.getCollaborationMode())) {
                WorkflowDefinition definition = workflowDefinitionRepository.findById(instance.getWorkflowId())
                        .orElse(null);
                double ratio = getApprovalRatio(definition, task.getNodeId());
                if ((double) completed.size() / allAssignees.size() < ratio) {
                    task.setStatus("PROCESSING");
                    workflowTaskRepository.save(task);
                    recordHistory(instance.getId(), task.getId(), task.getNodeId(), action,
                            operatorId, comment, null, null, null);
                    return task;
                }
            }
        }

        task.setStatus("COMPLETED");
        task.setAction(action);
        task.setComment(comment);
        task.setCompletedAt(LocalDateTime.now());
        workflowTaskRepository.save(task);

        recordHistory(instance.getId(), task.getId(), task.getNodeId(), action,
                operatorId, comment, null, null, null);

        if ("APPROVE".equals(action)) {
            WorkflowDefinition definition = workflowDefinitionRepository.findById(instance.getWorkflowId())
                    .orElseThrow(() -> new RuntimeException("流程定义不存在"));

            // 依次审批：检查是否有下一个审批人需要创建任务
            List<Long> allAssignees = new ArrayList<>(parseIdSet(task.getAllAssigneeIds()));
            if (!allAssignees.isEmpty() && "sequential".equals(task.getCollaborationMode())) {
                int currentIndex = allAssignees.indexOf(operatorId);
                if (currentIndex >= 0 && currentIndex < allAssignees.size() - 1) {
                    Long nextAssignee = allAssignees.get(currentIndex + 1);
                    WorkflowTask nextTask = buildTask(instance, task.getNodeId(), nextAssignee,
                            "NORMAL", null, "sequential");
                    nextTask.setAllAssigneeIds(task.getAllAssigneeIds());
                    workflowTaskRepository.save(nextTask);
                    return task;
                }
            }

            createTasksForNextNodes(definition, instance, task.getNodeId(), instance.getFormData());
            checkAndCompleteInstance(instance);
        } else if ("REJECT".equals(action)) {
            rejectToStart(instance, task.getNodeId(), comment, operatorId);
        }

        return task;
    }

    // ============================================================
    // 3. 驳回至指定节点
    // ============================================================

    @Transactional
    public void rejectToNode(Long instanceId, String targetNodeId, String comment,
                              Long operatorId, String operatorName) {
        WorkflowInstance instance = workflowInstanceRepository.findById(instanceId)
                .orElseThrow(() -> new RuntimeException("流程实例不存在: " + instanceId));

        if (!"RUNNING".equals(instance.getStatus())) {
            throw new RuntimeException("只有运行中的流程可以驳回");
        }

        WorkflowDefinition definition = workflowDefinitionRepository.findById(instance.getWorkflowId())
                .orElseThrow(() -> new RuntimeException("流程定义不存在"));

        // 取消当前所有待处理任务
        List<WorkflowTask> pendingTasks = workflowTaskRepository.findByInstanceId(instanceId)
                .stream()
                .filter(t -> "PENDING".equals(t.getStatus()) || "PROCESSING".equals(t.getStatus()))
                .collect(Collectors.toList());

        for (WorkflowTask t : pendingTasks) {
            t.setStatus("CANCELLED");
            t.setCompletedAt(LocalDateTime.now());
            workflowTaskRepository.save(t);
        }

        // 记录驳回历史
        recordHistory(instanceId, null, targetNodeId, "REJECT", operatorId,
                comment, null, targetNodeId, null);

        // 在目标节点创建新任务
        createTasksForNextNodes(definition, instance, targetNodeId, instance.getFormData());
    }

    // ============================================================
    // 3.1 逐级驳回：只能退回上一级处理人
    // ============================================================

    @Transactional
    public WorkflowTask rejectToPrevious(Long taskId, String comment, Long operatorId, String operatorName) {
        WorkflowTask task = workflowTaskRepository.findById(taskId)
                .orElseThrow(() -> new RuntimeException("任务不存在: " + taskId));

        checkTaskAssignee(task, operatorId, TaskOperation.REJECT);

        WorkflowInstance instance = workflowInstanceRepository.findById(task.getInstanceId())
                .orElseThrow(() -> new RuntimeException("流程实例不存在: " + task.getInstanceId()));

        // 找到当前节点的上一个节点（从历史记录中查找）
        List<WorkflowHistory> histories = workflowHistoryRepository
                .findByInstanceIdOrderByCreatedAtDesc(task.getInstanceId());
        String previousNodeId = null;
        for (WorkflowHistory h : histories) {
            if (!h.getNodeId().equals(task.getNodeId()) && !"START".equals(h.getNodeId())) {
                previousNodeId = h.getNodeId();
                break;
            }
        }

        if (previousNodeId == null) {
            throw new RuntimeException("无可退回的上一节点");
        }

        task.setStatus("COMPLETED");
        task.setAction("REJECT");
        task.setComment(comment);
        task.setCompletedAt(LocalDateTime.now());
        workflowTaskRepository.save(task);

        cancelAllPendingTasks(instance.getId());

        recordHistory(instance.getId(), task.getId(), task.getNodeId(), "REJECT",
                operatorId, comment, null, previousNodeId, null);

        WorkflowDefinition definition = workflowDefinitionRepository.findById(instance.getWorkflowId())
                .orElseThrow(() -> new RuntimeException("流程定义不存在"));
        createTasksForNextNodes(definition, instance, previousNodeId, instance.getFormData());

        return task;
    }

    // ============================================================
    // 3.2 驳回后重新提交
    // ============================================================

    @Transactional
    public WorkflowInstance resubmitInstance(Long instanceId, String formDataJson,
                                              Long operatorId, String operatorName) {
        WorkflowInstance instance = workflowInstanceRepository.findById(instanceId)
                .orElseThrow(() -> new RuntimeException("流程实例不存在: " + instanceId));

        if (!"REJECTED".equals(instance.getStatus())) {
            throw new RuntimeException("只有驳回状态的流程可以重新提交");
        }

        WorkflowDefinition definition = workflowDefinitionRepository.findById(instance.getWorkflowId())
                .orElseThrow(() -> new RuntimeException("流程定义不存在"));

        // 更新表单数据
        instance.setFormData(formDataJson);
        instance.setStatus("RUNNING");
        workflowInstanceRepository.save(instance);

        recordHistory(instanceId, null, null, "RESUBMIT", operatorId,
                "驳回后重新提交", null, null, null);

        // 找到被驳回的节点，从该节点重新创建任务（原路返回）
        List<WorkflowHistory> histories = workflowHistoryRepository
                .findByInstanceIdOrderByCreatedAtDesc(instanceId);
        String lastRejectNodeId = null;
        for (WorkflowHistory h : histories) {
            if ("REJECT".equals(h.getAction()) && h.getToNodeId() != null) {
                lastRejectNodeId = h.getToNodeId();
                break;
            }
        }

        // 如果没有指定目标节点，从开始节点开始
        if (lastRejectNodeId == null) {
            createTasksForNextNodes(definition, instance, "start", formDataJson);
        } else {
            createTasksForNextNodes(definition, instance, lastRejectNodeId, formDataJson);
        }

        return instance;
    }

    // ============================================================
    // 4. 转办
    // ============================================================

    @Transactional
    public WorkflowTask transferTask(Long taskId, Long targetUserId, String targetUserName,
                                      String comment, Long operatorId, String operatorName) {
        WorkflowTask task = workflowTaskRepository.findById(taskId)
                .orElseThrow(() -> new RuntimeException("任务不存在: " + taskId));

        if (!"PENDING".equals(task.getStatus()) && !"PROCESSING".equals(task.getStatus())) {
            throw new RuntimeException("只能转办待处理的任务");
        }

        checkTaskAssignee(task, operatorId, TaskOperation.TRANSFER);

        // 取消原任务
        task.setStatus("CANCELLED");
        task.setCompletedAt(LocalDateTime.now());
        workflowTaskRepository.save(task);

        recordHistory(task.getInstanceId(), task.getId(), task.getNodeId(), "TRANSFER",
                operatorId, comment, task.getNodeId(), null,
                objectMapper.createObjectNode()
                        .put("targetUserId", targetUserId)
                        .put("targetUserName", targetUserName)
                        .toString());

        // 创建新任务给转办目标
        WorkflowTask newTask = new WorkflowTask();
        newTask.setInstanceId(task.getInstanceId());
        newTask.setApplicationId(task.getApplicationId());
        newTask.setNodeId(task.getNodeId());
        newTask.setAssigneeId(targetUserId);
        newTask.setAssigneeType("TRANSFER");
        newTask.setOriginalAssigneeId(task.getAssigneeId());
        newTask.setStatus("PENDING");
        newTask.setCollaborationMode("any_pass");
        newTask.setAllAssigneeIds(objectMapper.createArrayNode().add(targetUserId).toString());
        newTask.setStartedAt(LocalDateTime.now());
        return workflowTaskRepository.save(newTask);
    }

    // ============================================================
    // 5. 加签（前加签/后加签）
    // ============================================================

    @Transactional
    public WorkflowTask addSign(Long taskId, Long addUserId, String addSignType,
                                 String comment, Long operatorId, String operatorName) {
        WorkflowTask task = workflowTaskRepository.findById(taskId)
                .orElseThrow(() -> new RuntimeException("任务不存在: " + taskId));

        if (!"PENDING".equals(task.getStatus()) && !"PROCESSING".equals(task.getStatus())) {
            throw new RuntimeException("只能对待处理任务进行加签");
        }

        checkTaskAssignee(task, operatorId, TaskOperation.ADD_SIGN);

        if ("BEFORE".equals(addSignType)) {
            // 前加签：加签人先审批，原审批人最后审批
            // 将原审批人暂停，创建新任务给加签人
            task.setStatus("PROCESSING");
            workflowTaskRepository.save(task);

            WorkflowTask newTask = new WorkflowTask();
            newTask.setInstanceId(task.getInstanceId());
            newTask.setApplicationId(task.getApplicationId());
            newTask.setNodeId(task.getNodeId());
            newTask.setAssigneeId(addUserId);
            newTask.setAssigneeType("ADD_SIGN");
            newTask.setOriginalAssigneeId(task.getAssigneeId());
            newTask.setStatus("PENDING");
            newTask.setCollaborationMode("any_pass");
            newTask.setAllAssigneeIds(objectMapper.createArrayNode().add(addUserId).toString());
            newTask.setStartedAt(LocalDateTime.now());
            WorkflowTask saved = workflowTaskRepository.save(newTask);

            recordHistory(task.getInstanceId(), task.getId(), task.getNodeId(), "ADD_SIGN",
                    operatorId, "前加签: " + comment, null, null,
                    objectMapper.createObjectNode()
                            .put("addUserId", addUserId)
                            .put("addSignType", "BEFORE")
                            .toString());

            return saved;
        } else {
            // 后加签：当前人处理完后，加签人再审批
            task.setCollaborationMode("all_pass");
            Set<Long> allAssignees = parseIdSet(task.getAllAssigneeIds());
            allAssignees.add(addUserId);
            task.setAllAssigneeIds(objectMapper.valueToTree(new ArrayList<>(allAssignees)).toString());
            workflowTaskRepository.save(task);

            recordHistory(task.getInstanceId(), task.getId(), task.getNodeId(), "ADD_SIGN",
                    operatorId, "后加签: " + comment, null, null,
                    objectMapper.createObjectNode()
                            .put("addUserId", addUserId)
                            .put("addSignType", "AFTER")
                            .toString());

            return task;
        }
    }

    // ============================================================
    // 6. 委派
    // ============================================================

    @Transactional
    public WorkflowTask delegateTask(Long taskId, Long delegateUserId, String comment,
                                      Long operatorId, String operatorName) {
        WorkflowTask task = workflowTaskRepository.findById(taskId)
                .orElseThrow(() -> new RuntimeException("任务不存在: " + taskId));

        if (!"PENDING".equals(task.getStatus()) && !"PROCESSING".equals(task.getStatus())) {
            throw new RuntimeException("只能委派待处理的任务");
        }

        checkTaskAssignee(task, operatorId, TaskOperation.DELEGATE);

        // 原任务标记为委派
        task.setStatus("CANCELLED");
        task.setCompletedAt(LocalDateTime.now());
        workflowTaskRepository.save(task);

        // 创建委派任务，记录归属原处理人
        WorkflowTask newTask = new WorkflowTask();
        newTask.setInstanceId(task.getInstanceId());
        newTask.setApplicationId(task.getApplicationId());
        newTask.setNodeId(task.getNodeId());
        newTask.setAssigneeId(delegateUserId);
        newTask.setAssigneeType("DELEGATE");
        newTask.setOriginalAssigneeId(task.getAssigneeId());
        newTask.setStatus("PENDING");
        newTask.setCollaborationMode("any_pass");
        newTask.setAllAssigneeIds(objectMapper.createArrayNode().add(delegateUserId).toString());
        newTask.setStartedAt(LocalDateTime.now());
        WorkflowTask saved = workflowTaskRepository.save(newTask);

        recordHistory(task.getInstanceId(), task.getId(), task.getNodeId(), "DELEGATE",
                operatorId, comment, null, null,
                objectMapper.createObjectNode()
                        .put("delegateUserId", delegateUserId)
                        .toString());

        return saved;
    }

    // ============================================================
    // 7. 强制跳转（管理员）
    // ============================================================

    @Transactional
    public void forceJump(Long instanceId, String targetNodeId, String comment,
                           Long operatorId, String operatorName) {
        WorkflowInstance instance = workflowInstanceRepository.findById(instanceId)
                .orElseThrow(() -> new RuntimeException("流程实例不存在: " + instanceId));

        if (!"RUNNING".equals(instance.getStatus())) {
            throw new RuntimeException("只有运行中的流程可以强制跳转");
        }

        WorkflowDefinition definition = workflowDefinitionRepository.findById(instance.getWorkflowId())
                .orElseThrow(() -> new RuntimeException("流程定义不存在"));

        // 取消所有待处理任务
        List<WorkflowTask> pendingTasks = workflowTaskRepository.findByInstanceId(instanceId)
                .stream()
                .filter(t -> "PENDING".equals(t.getStatus()) || "PROCESSING".equals(t.getStatus()))
                .collect(Collectors.toList());

        for (WorkflowTask t : pendingTasks) {
            t.setStatus("CANCELLED");
            t.setCompletedAt(LocalDateTime.now());
            workflowTaskRepository.save(t);
        }

        recordHistory(instanceId, null, targetNodeId, "FORCE_JUMP", operatorId,
                comment, null, targetNodeId, null);

        // 在目标节点创建新任务
        createTasksForNextNodes(definition, instance, targetNodeId, instance.getFormData());
    }

    // ============================================================
    // 8. 撤回流程
    // ============================================================

    @Transactional
    public void cancelProcess(Long instanceId, Long operatorId, String operatorName) {
        WorkflowInstance instance = workflowInstanceRepository.findById(instanceId)
                .orElseThrow(() -> new RuntimeException("流程实例不存在: " + instanceId));

        if (!"RUNNING".equals(instance.getStatus())) {
            throw new RuntimeException("只有运行中的流程可以撤回");
        }

        instance.setStatus("CANCELLED");
        instance.setCompletedAt(LocalDateTime.now());
        workflowInstanceRepository.save(instance);

        List<WorkflowTask> pendingTasks = workflowTaskRepository.findByInstanceId(instanceId)
                .stream()
                .filter(t -> "PENDING".equals(t.getStatus()) || "PROCESSING".equals(t.getStatus()))
                .collect(Collectors.toList());

        for (WorkflowTask task : pendingTasks) {
            task.setStatus("CANCELLED");
            task.setCompletedAt(LocalDateTime.now());
            workflowTaskRepository.save(task);
        }

        recordHistory(instanceId, null, "CANCEL", "FORCE_STOP", operatorId,
                "撤回流程", null, null, null);
    }

    // ============================================================
    // 9. SLA 自动升级
    // ============================================================

    @Transactional
    public void escalateOverdueTasks() {
        List<WorkflowTask> overdueTasks = workflowTaskRepository
                .findByStatusAndDeadlineBefore("PENDING", LocalDateTime.now());

        for (WorkflowTask task : overdueTasks) {
            if (Boolean.TRUE.equals(task.getSlaBreached())) {
                // 已经标记过 SLA 超时，检查是否需要自动升级
                if (task.getRemindedAt() != null &&
                        task.getRemindedAt().plusHours(48).isBefore(LocalDateTime.now())) {
                    // 超过48小时未处理，自动升级给上级
                    autoEscalate(task);
                }
            } else {
                // 首次超时，标记并记录
                task.setSlaBreached(true);
                task.setRemindedAt(LocalDateTime.now());
                workflowTaskRepository.save(task);

                recordHistory(task.getInstanceId(), task.getId(), task.getNodeId(),
                        "AUTO_ESCALATE", 0L,
                        "SLA超时提醒", null, null,
                        objectMapper.createObjectNode()
                                .put("deadline", task.getDeadline().toString())
                                .put("type", "REMIND")
                                .toString());
            }
        }
    }

    private void autoEscalate(WorkflowTask task) {
        Long leaderId = userDeptRepository.findByUserIdAndIsPrimaryTrue(task.getAssigneeId())
                .map(UserDept::getLeaderId).orElse(null);
        if (leaderId == null) return;

        // 取消原任务
        task.setStatus("CANCELLED");
        task.setCompletedAt(LocalDateTime.now());
        workflowTaskRepository.save(task);

        // 创建新任务给上级
        WorkflowTask newTask = new WorkflowTask();
        newTask.setInstanceId(task.getInstanceId());
        newTask.setApplicationId(task.getApplicationId());
        newTask.setNodeId(task.getNodeId());
        newTask.setAssigneeId(leaderId);
        newTask.setAssigneeType("DELEGATE");
        newTask.setOriginalAssigneeId(task.getAssigneeId());
        newTask.setStatus("PENDING");
        newTask.setCollaborationMode("any_pass");
        newTask.setAllAssigneeIds(objectMapper.createArrayNode().add(leaderId).toString());
        newTask.setDeadline(task.getDeadline());
        newTask.setStartedAt(LocalDateTime.now());
        workflowTaskRepository.save(newTask);

        recordHistory(task.getInstanceId(), task.getId(), task.getNodeId(),
                "AUTO_ESCALATE", 0L,
                "SLA超时自动升级至上级", task.getNodeId(), null,
                objectMapper.createObjectNode()
                        .put("fromAssigneeId", task.getAssigneeId())
                        .put("toAssigneeId", leaderId)
                        .put("type", "ESCALATE")
                        .toString());
    }

    // ============================================================
    // 10. 冻结/解冻流程
    // ============================================================

    @Transactional
    public void freezeProcess(Long instanceId, Long operatorId, String operatorName) {
        WorkflowInstance instance = workflowInstanceRepository.findById(instanceId)
                .orElseThrow(() -> new RuntimeException("流程实例不存在: " + instanceId));
        if (!"RUNNING".equals(instance.getStatus())) {
            throw new RuntimeException("只有运行中的流程可以冻结");
        }
        instance.setStatus("FROZEN");
        instance.setCompletedAt(LocalDateTime.now());
        workflowInstanceRepository.save(instance);
        cancelAllPendingTasks(instanceId);
        recordHistory(instanceId, null, null, "FREEZE", operatorId, "管理员冻结流程", null, null, null);
    }

    @Transactional
    public void unfreezeProcess(Long instanceId, Long operatorId, String operatorName) {
        WorkflowInstance instance = workflowInstanceRepository.findById(instanceId)
                .orElseThrow(() -> new RuntimeException("流程实例不存在: " + instanceId));
        if (!"FROZEN".equals(instance.getStatus())) {
            throw new RuntimeException("只有冻结状态的流程可以解冻");
        }
        instance.setStatus("RUNNING");
        instance.setCompletedAt(null);
        workflowInstanceRepository.save(instance);
        recordHistory(instanceId, null, null, "UNFREEZE", operatorId, "管理员解冻流程", null, null, null);
    }

    // ============================================================
    // 11. 强制终止/撤回
    // ============================================================

    @Transactional
    public void forceStop(Long instanceId, String comment, Long operatorId, String operatorName) {
        WorkflowInstance instance = workflowInstanceRepository.findById(instanceId)
                .orElseThrow(() -> new RuntimeException("流程实例不存在: " + instanceId));
        if ("COMPLETED".equals(instance.getStatus()) || "CANCELLED".equals(instance.getStatus())) {
            throw new RuntimeException("已结束的流程不可强制终止");
        }
        instance.setStatus("CANCELLED");
        instance.setCompletedAt(LocalDateTime.now());
        workflowInstanceRepository.save(instance);
        cancelAllPendingTasks(instanceId);
        recordHistory(instanceId, null, null, "FORCE_STOP", operatorId, comment, null, null, null);
    }

    @Transactional
    public void forceWithdraw(Long instanceId, String comment, Long operatorId, String operatorName) {
        WorkflowInstance instance = workflowInstanceRepository.findById(instanceId)
                .orElseThrow(() -> new RuntimeException("流程实例不存在: " + instanceId));
        if (!"COMPLETED".equals(instance.getStatus())) {
            throw new RuntimeException("只能强制撤回已完成的流程");
        }
        instance.setStatus("CANCELLED");
        instance.setCompletedAt(LocalDateTime.now());
        workflowInstanceRepository.save(instance);
        recordHistory(instanceId, null, null, "FORCE_WITHDRAW", operatorId, comment, null, null, null);
    }

    // ============================================================
    // 12. 修改处理人
    // ============================================================

    @Transactional
    public WorkflowTask reassignTask(Long taskId, Long newAssigneeId, String comment,
                                      Long operatorId, String operatorName) {
        WorkflowTask task = workflowTaskRepository.findById(taskId)
                .orElseThrow(() -> new RuntimeException("任务不存在: " + taskId));
        if (!"PENDING".equals(task.getStatus()) && !"PROCESSING".equals(task.getStatus())) {
            throw new RuntimeException("只能修改待处理任务的处理人");
        }

        checkTaskAssignee(task, operatorId, TaskOperation.REASSIGN);

        Long oldAssigneeId = task.getAssigneeId();
        task.setAssigneeId(newAssigneeId);
        task.setOriginalAssigneeId(oldAssigneeId);
        task.setAssigneeType("REASSIGN");
        workflowTaskRepository.save(task);
        recordHistory(task.getInstanceId(), taskId, task.getNodeId(), "REASSIGN",
                operatorId, comment, null, null,
                objectMapper.createObjectNode()
                        .put("oldAssigneeId", oldAssigneeId)
                        .put("newAssigneeId", newAssigneeId)
                        .toString());
        return task;
    }

    // ============================================================
    // 13. 获取任务详情
    // ============================================================

    public WorkflowTask getTask(Long taskId) {
        return workflowTaskRepository.findById(taskId)
                .orElseThrow(() -> new RuntimeException("任务不存在: " + taskId));
    }

    // ============================================================
    // 14. 流程校验
    // ============================================================

    public Map<String, Object> validateWorkflow(Long definitionId) {
        WorkflowDefinition definition = workflowDefinitionRepository.findById(definitionId)
                .orElseThrow(() -> new RuntimeException("流程定义不存在: " + definitionId));

        List<Map<String, Object>> errors = new ArrayList<>();
        List<Map<String, Object>> warnings = new ArrayList<>();

        List<NodeDef> nodes = parseNodes(definition.getNodes());
        List<EdgeDef> edges = parseEdges(definition.getEdges());

        Set<String> nodeIds = new HashSet<>();
        boolean hasStart = false, hasEnd = false;

        for (NodeDef node : nodes) {
            nodeIds.add(node.nodeId);
            if ("start".equals(node.nodeType)) hasStart = true;
            if ("end".equals(node.nodeType)) hasEnd = true;
        }

        if (!hasStart) errors.add(Map.of("category", "Workflow", "message", "缺少开始节点", "severity", "ERROR"));
        if (!hasEnd) errors.add(Map.of("category", "Workflow", "message", "缺少结束节点", "severity", "ERROR"));
        if (nodes.isEmpty()) errors.add(Map.of("category", "Workflow", "message", "流程无节点", "severity", "ERROR"));

        for (EdgeDef edge : edges) {
            if (!nodeIds.contains(edge.source)) {
                errors.add(Map.of("category", "Workflow", "message",
                    "边引用了不存在的源节点: " + edge.source, "severity", "ERROR"));
            }
            if (!nodeIds.contains(edge.target)) {
                errors.add(Map.of("category", "Workflow", "message",
                    "边引用了不存在的目标节点: " + edge.target, "severity", "ERROR"));
            }
        }

        Set<String> connectedNodes = new HashSet<>();
        for (EdgeDef edge : edges) {
            connectedNodes.add(edge.source);
            connectedNodes.add(edge.target);
        }
        for (String nodeId : nodeIds) {
            if (!connectedNodes.contains(nodeId)) {
                warnings.add(Map.of("category", "Workflow", "message",
                    "孤立节点: " + nodeId, "severity", "WARNING"));
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("passed", errors.isEmpty());
        result.put("errors", errors);
        result.put("warnings", warnings);
        return result;
    }

    // ============================================================
    // 15. 复制流程定义
    // ============================================================

    @Transactional
    public WorkflowDefinition copyDefinition(Long id) {
        WorkflowDefinition source = workflowDefinitionRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("流程定义不存在: " + id));

        WorkflowDefinition copy = new WorkflowDefinition();
        copy.setApplicationId(source.getApplicationId());
        copy.setName(source.getName() + " (副本)");
        copy.setDescription(source.getDescription());
        copy.setNodes(source.getNodes());
        copy.setEdges(source.getEdges());
        copy.setVersion(1);
        copy.setStatus("DRAFT");
        copy.setCreatedBy(source.getCreatedBy());
        return workflowDefinitionRepository.save(copy);
    }

    // ============================================================
    // 16. 获取版本列表
    // ============================================================

    public List<WorkflowDefinition> getVersions(Long id) {
        WorkflowDefinition current = workflowDefinitionRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("流程定义不存在: " + id));
        return workflowDefinitionRepository.findByNameAndApplicationIdOrderByVersionDesc(
                current.getName(), current.getApplicationId());
    }

    // ============================================================
    // 核心路由逻辑
    // ============================================================

    /**
     * 从指定节点出发，找到下一个节点并创建任务
     */
    private void createTasksForNextNodes(WorkflowDefinition definition, WorkflowInstance instance,
                                          String fromNodeId, String formDataJson) {
        List<NodeDef> nodes = parseNodes(definition.getNodes());
        List<EdgeDef> edges = parseEdges(definition.getEdges());

        // 找到从 fromNodeId 出发的边
        List<EdgeDef> outgoingEdges = edges.stream()
                .filter(e -> e.source.equals(fromNodeId))
                .collect(Collectors.toList());

        if (outgoingEdges.isEmpty()) {
            // 没有出边，流程结束
            return;
        }

        // 获取表单数据用于条件判断
        Map<String, Object> formData = parseFormData(formDataJson);

        // 过滤满足条件的边（条件分支）
        List<EdgeDef> matchedEdges = outgoingEdges.stream()
                .filter(e -> evaluateCondition(e.condition, formData))
                .collect(Collectors.toList());

        if (matchedEdges.isEmpty()) {
            // 没有满足条件的边，取默认第一条
            if (!outgoingEdges.isEmpty()) {
                matchedEdges = Collections.singletonList(outgoingEdges.get(0));
            }
        }

        Set<String> visitedNodes = new HashSet<>();
        for (EdgeDef edge : matchedEdges) {
            String targetNodeId = edge.target;

            if ("end".equals(targetNodeId)) {
                continue; // 到达结束节点
            }

            if (visitedNodes.contains(targetNodeId)) continue;
            visitedNodes.add(targetNodeId);

            NodeDef targetNode = nodes.stream()
                    .filter(n -> n.nodeId.equals(targetNodeId))
                    .findFirst()
                    .orElse(null);

            if (targetNode == null) continue;

            if ("parallel".equals(targetNode.nodeType)) {
                // 并行分支：找到所有并行分支的下一节点
                List<EdgeDef> parallelEdges = edges.stream()
                        .filter(e -> e.source.equals(targetNodeId))
                        .collect(Collectors.toList());
                for (EdgeDef pe : parallelEdges) {
                    createTaskForNode(instance, targetNode, pe.target, formData);
                }
            } else {
                createTaskForNode(instance, targetNode, targetNodeId, formData);
            }
        }
    }

    /**
     * 为指定节点创建任务
     */
    private void createTaskForNode(WorkflowInstance instance, NodeDef node, String nodeId,
                                    Map<String, Object> formData) {
        Map<String, Object> config = node.config != null ? node.config : Collections.emptyMap();

        // 子流程节点：启动子流程实例
        if ("sub_process".equals(node.nodeType)) {
            startSubProcess(instance, node, config, formData);
            return;
        }

        String approverType = (String) config.getOrDefault("approverType", "member");
        String collaborationMode = (String) config.getOrDefault("collaborationMode", "any_pass");

        // 获取流程定义，用于判断平台级/应用级流程
        WorkflowDefinition definition = workflowDefinitionRepository.findById(instance.getWorkflowId())
                .orElse(null);
        WorkflowScope scope = definition != null ? definition.getScope() : WorkflowScope.APPLICATION;
        Long defAppId = definition != null ? definition.getApplicationId() : null;

        // 解析审批人列表：平台级流程不过滤 applicationId，应用级流程按 definition.applicationId 过滤
        List<Long> assigneeIds = resolveAssignees(approverType, config, formData, instance.getInitiatorId(), scope, defAppId);

        if (assigneeIds.isEmpty()) {
            // 没有审批人，跳过该节点，继续找下一个
            if (definition != null) {
                createTasksForNextNodes(definition, instance, nodeId, instance.getFormData());
            }
            return;
        }

        // 依次审批：只为第一个人创建任务
        if ("sequential".equals(collaborationMode)) {
            Long firstAssignee = assigneeIds.get(0);
            WorkflowTask task = buildTask(instance, nodeId, firstAssignee, "NORMAL", null, collaborationMode);
            task.setAllAssigneeIds(objectMapper.valueToTree(assigneeIds).toString());
            if (assigneeIds.size() > 1) {
                task.setAllAssigneeIds(objectMapper.valueToTree(assigneeIds).toString());
            }
            workflowTaskRepository.save(task);
            return;
        }

        // 为每个审批人创建任务
        for (Long assigneeId : assigneeIds) {
            WorkflowTask task = buildTask(instance, nodeId, assigneeId, "NORMAL", null, collaborationMode);
            if ("all_pass".equals(collaborationMode) || "ratio_pass".equals(collaborationMode)) {
                task.setAllAssigneeIds(objectMapper.valueToTree(assigneeIds).toString());
                task.setCompletedAssigneeIds(objectMapper.createArrayNode().toString());
            }
            workflowTaskRepository.save(task);
        }
    }

    private WorkflowTask buildTask(WorkflowInstance instance, String nodeId, Long assigneeId,
                                    String assigneeType, Long originalAssigneeId, String collaborationMode) {
        WorkflowTask task = new WorkflowTask();
        task.setInstanceId(instance.getId());
        task.setApplicationId(instance.getApplicationId());
        task.setNodeId(nodeId);
        task.setAssigneeId(assigneeId);
        task.setAssigneeType(assigneeType);
        task.setOriginalAssigneeId(originalAssigneeId);
        task.setStatus("PENDING");
        task.setCollaborationMode(collaborationMode);
        task.setSlaBreached(false);
        task.setStartedAt(LocalDateTime.now());
        return task;
    }

    /**
     * 启动子流程
     */
    private void startSubProcess(WorkflowInstance parentInstance, NodeDef node,
                                  Map<String, Object> config, Map<String, Object> formData) {
        Object subDefIdObj = config.get("subProcessDefinitionId");
        if (subDefIdObj == null) {
            throw new RuntimeException("子流程节点缺少 subProcessDefinitionId 配置");
        }
        Long subDefinitionId = Long.valueOf(subDefIdObj.toString());

        WorkflowDefinition subDefinition = workflowDefinitionRepository.findById(subDefinitionId)
                .orElseThrow(() -> new RuntimeException("子流程定义不存在: " + subDefinitionId));

        // 动态多实例：根据参与部门数量生成多个子流程
        Object multiInstanceField = config.get("multiInstanceField");
        if (multiInstanceField != null) {
            String fieldName = multiInstanceField.toString();
            Object fieldValue = formData.get(fieldName);
            if (fieldValue instanceof List) {
                @SuppressWarnings("unchecked")
                List<Object> items = (List<Object>) fieldValue;
                for (int i = 0; i < items.size(); i++) {
                    WorkflowInstance subInstance = buildSubInstance(parentInstance, subDefinition,
                            formData, i + 1, items.size());
                    workflowInstanceRepository.save(subInstance);
                    recordHistory(parentInstance.getId(), null, node.nodeId, "SUB_PROCESS_START",
                            parentInstance.getInitiatorId(),
                            "启动子流程: " + subDefinition.getName() + " (" + (i + 1) + "/" + items.size() + ")",
                            null, null, objectMapper.createObjectNode()
                                    .put("subInstanceId", subInstance.getId())
                                    .put("subDefinitionId", subDefinitionId)
                                    .toString());
                }
                return;
            }
        }

        // 单个子流程
        WorkflowInstance subInstance = buildSubInstance(parentInstance, subDefinition, formData, 1, 1);
        workflowInstanceRepository.save(subInstance);
        recordHistory(parentInstance.getId(), null, node.nodeId, "SUB_PROCESS_START",
                parentInstance.getInitiatorId(),
                "启动子流程: " + subDefinition.getName(),
                null, null, objectMapper.createObjectNode()
                        .put("subInstanceId", subInstance.getId())
                        .put("subDefinitionId", subDefinitionId)
                        .toString());
    }

    private WorkflowInstance buildSubInstance(WorkflowInstance parent, WorkflowDefinition subDef,
                                               Map<String, Object> formData, int index, int total) {
        WorkflowInstance sub = new WorkflowInstance();
        sub.setWorkflowId(subDef.getId());
        sub.setApplicationId(subDef.getApplicationId());
        sub.setWorkflowVersion(subDef.getVersion());
        sub.setFormId(parent.getFormId());
        sub.setStatus("RUNNING");
        sub.setFormData(objectMapper.valueToTree(formData).toString());
        sub.setInitiatorId(parent.getInitiatorId());
        sub.setParentInstanceId(parent.getId());
        sub.setSubProcessDefinitionId(subDef.getId());
        sub.setStartedAt(LocalDateTime.now());
        return sub;
    }

    /**
     * 获取子流程实例列表
     */
    public List<WorkflowInstance> getSubProcessInstances(Long parentInstanceId) {
        return workflowInstanceRepository.findByParentInstanceId(parentInstanceId);
    }

    /**
     * 解析审批人列表
     */
    private List<Long> resolveAssignees(String approverType, Map<String, Object> config,
                                         Map<String, Object> formData, Long initiatorId,
                                         WorkflowScope scope, Long defAppId) {
        switch (approverType) {
            case "member": {
                @SuppressWarnings("unchecked")
                List<Object> ids = (List<Object>) config.getOrDefault("approverIds",
                        config.getOrDefault("memberIds", Collections.emptyList()));
                return ids.stream().map(id -> Long.valueOf(id.toString())).collect(Collectors.toList());
            }
            case "role": {
                @SuppressWarnings("unchecked")
                List<Object> roleSlugs = (List<Object>) config.getOrDefault("roleSlugs", Collections.emptyList());
                boolean isPlatform = WorkflowScope.PLATFORM == scope;
                if (roleSlugs.isEmpty()) {
                    @SuppressWarnings("unchecked")
                    List<Object> roleIds = (List<Object>) config.getOrDefault("roleIds", Collections.emptyList());
                    return roleIds.stream()
                            .flatMap(id -> roleRepository.findById(Long.valueOf(id.toString()))
                                    .filter(role -> isPlatform || role.getApplicationId() == null
                                            || role.getApplicationId().equals(defAppId))
                                    .map(role -> roleUserRepository.findByRoleId(role.getId()).stream()
                                            .map(RoleUser::getUserId)
                                            .collect(Collectors.toList()))
                                    .orElse(Collections.emptyList()).stream())
                            .collect(Collectors.toList());
                }
                return roleSlugs.stream()
                        .flatMap(slug -> {
                            if (!isPlatform && defAppId != null) {
                                return roleRepository.findBySlugAndApplicationId(slug.toString(), defAppId)
                                        .map(role -> roleUserRepository.findByRoleId(role.getId()).stream()
                                                .map(RoleUser::getUserId)
                                                .collect(Collectors.toList()))
                                        .orElse(Collections.emptyList()).stream();
                            }
                            return roleRepository.findBySlug(slug.toString())
                                    .map(role -> roleUserRepository.findByRoleId(role.getId()).stream()
                                            .map(RoleUser::getUserId)
                                            .collect(Collectors.toList()))
                                    .orElse(Collections.emptyList()).stream();
                        })
                        .collect(Collectors.toList());
            }
            case "department_head": {
                UserDept ud = userDeptRepository.findByUserIdAndIsPrimaryTrue(initiatorId).orElse(null);
                if (ud != null && ud.getDepartmentId() != null) {
                    Department dept = departmentRepository.findById(ud.getDepartmentId())
                            .orElse(null);
                    if (dept != null && dept.getManagerId() != null) {
                        return Collections.singletonList(dept.getManagerId());
                    }
                }
                return Collections.emptyList();
            }
            case "leader": {
                UserDept ud = userDeptRepository.findByUserIdAndIsPrimaryTrue(initiatorId).orElse(null);
                if (ud != null && ud.getLeaderId() != null) {
                    return Collections.singletonList(ud.getLeaderId());
                }
                return Collections.emptyList();
            }
            case "form_field": {
                String fieldKey = (String) config.get("formFieldKey");
                if (fieldKey != null && formData.containsKey(fieldKey)) {
                    Object value = formData.get(fieldKey);
                    if (value instanceof Number) {
                        return Collections.singletonList(((Number) value).longValue());
                    }
                }
                return Collections.emptyList();
            }
            case "script": {
                String script = (String) config.get("script");
                if (script == null || script.trim().isEmpty()) {
                    log.warn("审批人脚本为空，节点配置: {}", config);
                    return Collections.emptyList();
                }
                try {
                    ScriptEngine groovyEngine = new ScriptEngineManager().getEngineByName("groovy");
                    ScriptEngine engine = groovyEngine != null ? groovyEngine
                            : new ScriptEngineManager().getEngineByName("JavaScript");
                    if (engine == null) {
                        log.error("无可用的脚本引擎，无法解析审批人");
                        return Collections.emptyList();
                    }

                    // 注入上下文变量
                    engine.put("formData", formData);
                    engine.put("initiatorId", initiatorId);
                    if (initiatorId != null) {
                        userRepository.findById(initiatorId).ifPresent(u -> {
                            engine.put("initiator", u);
                        });
                    }
                    engine.put("userRepository", userRepository);
                    engine.put("roleRepository", roleRepository);

                    Object result = engine.eval(script);
                    if (result instanceof List) {
                        @SuppressWarnings("unchecked")
                        List<Object> list = (List<Object>) result;
                        return list.stream()
                                .map(id -> {
                                    if (id instanceof Number) {
                                        return ((Number) id).longValue();
                                    }
                                    return Long.valueOf(id.toString());
                                })
                                .collect(Collectors.toList());
                    }
                    if (result instanceof Number) {
                        return Collections.singletonList(((Number) result).longValue());
                    }
                    log.warn("脚本返回了非预期的类型: {}", result != null ? result.getClass().getName() : "null");
                    return Collections.emptyList();
                } catch (Exception e) {
                    log.error("审批人脚本执行失败: {}", e.getMessage(), e);
                    return Collections.emptyList();
                }
            }
            default:
                return Collections.emptyList();
        }
    }

    /**
     * 评估边上的条件表达式
     */
    private boolean evaluateCondition(String condition, Map<String, Object> formData) {
        if (condition == null || condition.trim().isEmpty()) {
            return true; // 无条件，始终通过
        }

        try {
            ScriptEngine engine = new ScriptEngineManager().getEngineByName("JavaScript");
            if (engine == null) return true;

            // 将表单数据注入脚本上下文
            for (Map.Entry<String, Object> entry : formData.entrySet()) {
                engine.put(entry.getKey(), entry.getValue());
            }

            Object result = engine.eval(condition);
            return Boolean.TRUE.equals(result);
        } catch (Exception e) {
            // 条件解析失败，默认通过
            return true;
        }
    }

    /**
     * 驳回至发起人
     */
    private void rejectToStart(WorkflowInstance instance, String fromNodeId, String comment, Long operatorId) {
        instance.setStatus("REJECTED");
        instance.setCompletedAt(LocalDateTime.now());
        workflowInstanceRepository.save(instance);

        // 取消所有待处理任务
        List<WorkflowTask> pendingTasks = workflowTaskRepository.findByInstanceId(instance.getId())
                .stream()
                .filter(t -> "PENDING".equals(t.getStatus()) || "PROCESSING".equals(t.getStatus()))
                .collect(Collectors.toList());

        for (WorkflowTask t : pendingTasks) {
            t.setStatus("CANCELLED");
            t.setCompletedAt(LocalDateTime.now());
            workflowTaskRepository.save(t);
        }
    }

    /**
     * 检查并完成流程实例
     */
    private void checkAndCompleteInstance(WorkflowInstance instance) {
        List<WorkflowTask> allTasks = workflowTaskRepository.findByInstanceId(instance.getId());
        boolean allCompleted = allTasks.stream()
                .allMatch(t -> "COMPLETED".equals(t.getStatus()) || "CANCELLED".equals(t.getStatus()));

        if (allCompleted && !allTasks.isEmpty()) {
            // 检查是否到达了结束节点
            boolean hasEndNode = false;
            WorkflowDefinition definition = workflowDefinitionRepository.findById(instance.getWorkflowId())
                    .orElse(null);
            if (definition != null) {
                List<NodeDef> nodes = parseNodes(definition.getNodes());
                hasEndNode = nodes.stream().anyMatch(n -> "end".equals(n.nodeType));
            }

            if (hasEndNode) {
                instance.setStatus("COMPLETED");
                instance.setCompletedAt(LocalDateTime.now());
                workflowInstanceRepository.save(instance);
            }
        }
    }

    /**
     * 获取审批比例
     */
    private double getApprovalRatio(WorkflowDefinition definition, String nodeId) {
        List<NodeDef> nodes = parseNodes(definition.getNodes());
        return nodes.stream()
                .filter(n -> n.nodeId.equals(nodeId))
                .findFirst()
                .map(n -> {
                    Map<String, Object> config = n.config;
                    if (config != null && config.containsKey("approvalRatio")) {
                        return ((Number) config.get("approvalRatio")).doubleValue();
                    }
                    return 0.5;
                })
                .orElse(0.5);
    }

    // ============================================================
    // JSON 解析工具方法
    // ============================================================

    private List<NodeDef> parseNodes(String nodesJson) {
        try {
            if (nodesJson == null || nodesJson.isEmpty()) return Collections.emptyList();
            List<Map<String, Object>> rawNodes = objectMapper.readValue(nodesJson,
                    new TypeReference<List<Map<String, Object>>>() {});
            List<NodeDef> result = rawNodes.stream().map(raw -> {
                NodeDef node = new NodeDef();
                node.nodeId = (String) raw.getOrDefault("id", raw.get("nodeId"));
                node.position = castMap(raw.get("position"));
                @SuppressWarnings("unchecked")
                Map<String, Object> data = (Map<String, Object>) raw.get("data");
                if (data != null) {
                    node.nodeType = (String) data.getOrDefault("nodeType", raw.get("type"));
                    node.nodeName = (String) data.get("label");
                    node.config = castMap(data.get("config"));
                }
                if (node.nodeType == null) {
                    node.nodeType = (String) raw.get("type");
                }
                if (node.nodeType == null) {
                    node.nodeType = (String) raw.get("nodeType");
                }
                if (node.nodeName == null) {
                    node.nodeName = (String) raw.get("label");
                }
                if (node.config == null) {
                    node.config = castMap(raw.get("config"));
                }
                return node;
            }).collect(Collectors.toList());

            return result;
        } catch (Exception e) {
            log.warn("Failed to parse nodes: {}", e.getMessage());
            return Collections.emptyList();
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> castMap(Object obj) {
        return obj instanceof Map ? (Map<String, Object>) obj : null;
    }

    private List<EdgeDef> parseEdges(String edgesJson) {
        try {
            if (edgesJson == null || edgesJson.isEmpty()) return Collections.emptyList();
            return objectMapper.readValue(edgesJson, new TypeReference<List<EdgeDef>>() {});
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseFormData(String formDataJson) {
        try {
            if (formDataJson == null || formDataJson.isEmpty()) return Collections.emptyMap();
            return objectMapper.readValue(formDataJson, Map.class);
        } catch (Exception e) {
            return Collections.emptyMap();
        }
    }

    private Set<Long> parseIdSet(String json) {
        try {
            if (json == null || json.isEmpty()) return new HashSet<>();
            List<Long> list = objectMapper.readValue(json, new TypeReference<List<Long>>() {});
            return new HashSet<>(list);
        } catch (Exception e) {
            return new HashSet<>();
        }
    }

    private void checkTaskAssignee(WorkflowTask task, Long operatorId, TaskOperation operation) {
        Set<Long> allAssignees = parseIdSet(task.getAllAssigneeIds());

        if (allAssignees.isEmpty()) {
            if (task.getAssigneeId() != null && task.getAssigneeId().equals(operatorId)) {
                return;
            }
            throw new RuntimeException("您不是该任务的审批人，无权进行" + operation.getLabel() + "操作");
        }

        if (allAssignees.contains(operatorId)) {
            return;
        }

        throw new RuntimeException("您不是该任务的审批人，无权进行" + operation.getLabel() + "操作");
    }

    private List<Long> parseIdList(String json) {
        try {
            if (json == null || json.isEmpty()) return Collections.emptyList();
            return objectMapper.readValue(json, new TypeReference<List<Long>>() {});
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }

    // ============================================================
    // 取消待处理任务
    // ============================================================

    private void cancelAllPendingTasks(Long instanceId) {
        List<WorkflowTask> pendingTasks = workflowTaskRepository.findByInstanceId(instanceId)
                .stream()
                .filter(t -> "PENDING".equals(t.getStatus()) || "PROCESSING".equals(t.getStatus()))
                .collect(Collectors.toList());
        for (WorkflowTask t : pendingTasks) {
            t.setStatus("CANCELLED");
            t.setCompletedAt(LocalDateTime.now());
            workflowTaskRepository.save(t);
        }
    }

    // ============================================================
    // 字段级显隐：根据节点配置返回字段权限
    // ============================================================

    /**
     * 获取指定节点的字段权限配置
     * @return Map<字段名, 权限> 其中权限为: visible|hidden|readonly|editable
     */
    public Map<String, String> getFieldPermissions(Long workflowId, String nodeId) {
        WorkflowDefinition definition = workflowDefinitionRepository.findById(workflowId).orElse(null);
        if (definition == null) return Collections.emptyMap();

        List<NodeDef> nodes = parseNodes(definition.getNodes());
        return nodes.stream()
                .filter(n -> n.nodeId.equals(nodeId))
                .findFirst()
                .map(n -> {
                    Map<String, Object> config = n.config != null ? n.config : Collections.emptyMap();
                    @SuppressWarnings("unchecked")
                    Map<String, Object> fp = (Map<String, Object>) config.getOrDefault(
                            "fieldPermissions", Collections.emptyMap());
                    Map<String, String> result = new LinkedHashMap<>();
                    fp.forEach((k, v) -> result.put(k, v.toString()));
                    return result;
                })
                .orElse(Collections.emptyMap());
    }

    /**
     * 获取展示给用户的字段列表（过滤掉隐藏字段）
     */
    public List<String> getVisibleFields(Long workflowId, String nodeId, List<String> allFields) {
        Map<String, String> permissions = getFieldPermissions(workflowId, nodeId);
        if (permissions.isEmpty()) return allFields;

        return allFields.stream()
                .filter(f -> !"hidden".equals(permissions.getOrDefault(f, "visible")))
                .collect(Collectors.toList());
    }

    /**
     * 获取可编辑字段列表
     */
    public List<String> getEditableFields(Long workflowId, String nodeId, List<String> allFields) {
        Map<String, String> permissions = getFieldPermissions(workflowId, nodeId);
        if (permissions.isEmpty()) return allFields;

        return allFields.stream()
                .filter(f -> {
                    String perm = permissions.getOrDefault(f, "editable");
                    return "editable".equals(perm);
                })
                .collect(Collectors.toList());
    }

    // ============================================================
    // 历史记录
    // ============================================================

    private void recordHistory(Long instanceId, Long taskId, String nodeId,
                                String action, Long operatorId,
                                String comment, String fromNodeId, String toNodeId,
                                String detail) {
        WorkflowHistory history = new WorkflowHistory();
        history.setInstanceId(instanceId);
        history.setTaskId(taskId);
        history.setNodeId(nodeId != null ? nodeId : "START");
        history.setOperatorId(operatorId);
        history.setAction(action);
        history.setFromNodeId(fromNodeId);
        history.setToNodeId(toNodeId);
        history.setComment(comment);
        history.setDetail(detail);
        workflowHistoryRepository.save(history);
    }
}