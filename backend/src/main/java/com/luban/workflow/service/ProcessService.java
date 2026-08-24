package com.luban.workflow.service;

import com.luban.workflow.entity.*;
import com.luban.workflow.repository.*;
import com.luban.repository.ApplicationRepository;
import com.luban.util.AgentLogger;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class ProcessService {

    private final ApplicationRepository applicationRepository;
    private final WorkflowDefinitionRepository workflowDefinitionRepository;
    private final WorkflowInstanceRepository workflowInstanceRepository;
    private final WorkflowTaskRepository workflowTaskRepository;
    private final WorkflowHistoryRepository workflowHistoryRepository;
    private final MemberRepository memberRepository;
    private final RoleRepository roleRepository;
    private final DepartmentRepository departmentRepository;
    private final FormWorkflowBindingRepository formWorkflowBindingRepository;
    private final ProcessEngine processEngine;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public List<WorkflowDefinition> listDefinitionsByApp(Long applicationId) {
        return workflowDefinitionRepository.findByApplicationId(applicationId);
    }

    public List<WorkflowDefinition> listDefinitionsByApp(Long applicationId, String status) {
        if (status != null && !status.isEmpty()) {
            return workflowDefinitionRepository.findByApplicationIdAndStatus(applicationId, status);
        }
        return workflowDefinitionRepository.findByApplicationId(applicationId);
    }

    public WorkflowDefinition getDefinition(Long id) {
        return workflowDefinitionRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("流程定义不存在: " + id));
    }

    @Transactional
    public WorkflowDefinition createDefinition(WorkflowDefinition definition) {
        validateNodeConfig(definition.getNodes());
        definition.setVersion(1);
        definition.setStatus("DRAFT");
        return workflowDefinitionRepository.save(definition);
    }

    @Transactional
    public WorkflowDefinition updateDefinition(Long id, WorkflowDefinition updated) {
        WorkflowDefinition existing = getDefinition(id);
        validateNodeConfig(updated.getNodes());
        existing.setName(updated.getName());
        existing.setDescription(updated.getDescription());
        existing.setNodes(updated.getNodes());
        existing.setEdges(updated.getEdges());
        return workflowDefinitionRepository.save(existing);
    }

    @Transactional
    public WorkflowDefinition publishDefinition(Long id) {
        WorkflowDefinition draft = getDefinition(id);
        if (!"DRAFT".equals(draft.getStatus())) {
            throw new RuntimeException("只有草稿版本的流程定义可以发布");
        }
        validateNodeConfig(draft.getNodes());

        Long oldPublishedId = draft.getPublishedVersionId();
        if (oldPublishedId != null) {
            workflowDefinitionRepository.findById(oldPublishedId)
                    .ifPresent(prev -> {
                        prev.setStatus("ARCHIVED");
                        workflowDefinitionRepository.save(prev);
                    });
        }

        int publishedVersion = draft.getVersion();
        draft.setStatus("PUBLISHED");
        draft.setPublishedVersionId(null);
        draft = workflowDefinitionRepository.save(draft);

        List<FormWorkflowBinding> bindings = new ArrayList<>();
        bindings.addAll(formWorkflowBindingRepository.findByWorkflowId(id));
        if (oldPublishedId != null) {
            bindings.addAll(formWorkflowBindingRepository.findByWorkflowId(oldPublishedId));
        }
        for (FormWorkflowBinding binding : bindings) {
            binding.setWorkflowId(draft.getId());
            formWorkflowBindingRepository.save(binding);
        }

        WorkflowDefinition newDraft = new WorkflowDefinition();
        newDraft.setName(draft.getName());
        newDraft.setDescription(draft.getDescription());
        newDraft.setApplicationId(draft.getApplicationId());
        newDraft.setVersion(publishedVersion + 1);
        newDraft.setStatus("DRAFT");
        newDraft.setNodes(draft.getNodes());
        newDraft.setEdges(draft.getEdges());
        newDraft.setCreatedBy(draft.getCreatedBy());
        newDraft.setPublishedVersionId(draft.getId());
        newDraft = workflowDefinitionRepository.save(newDraft);

        log.info("流程定义发布成功: v{} 已发布(id={}), 新草稿 v{} 已创建(id={})",
                publishedVersion, draft.getId(), newDraft.getVersion(), newDraft.getId());
        return draft;
    }

    private void populateAppNames(List<WorkflowInstance> instances) {
        if (instances == null || instances.isEmpty()) return;
        for (WorkflowInstance inst : instances) {
            WorkflowDefinition def = workflowDefinitionRepository.findById(inst.getWorkflowId()).orElse(null);
            if (def != null && "PLATFORM".equals(def.getScope())) continue;
            if (inst.getApplicationId() != null) {
                applicationRepository.findById(inst.getApplicationId())
                        .ifPresent(app -> inst.setApplicationName(app.getName()));
            }
        }
    }

    private void populateInitiatorNames(List<WorkflowInstance> instances) {
        if (instances == null || instances.isEmpty()) return;
        for (WorkflowInstance inst : instances) {
            memberRepository.findById(inst.getInitiatorId())
                    .ifPresent(member -> inst.setInitiatorName(member.getName()));
        }
    }

    private void populateTaskAppNames(List<WorkflowTask> tasks) {
        if (tasks == null || tasks.isEmpty()) return;
        for (WorkflowTask task : tasks) {
            applicationRepository.findById(task.getApplicationId())
                    .ifPresent(app -> task.setApplicationName(app.getName()));
        }
    }

    public void populateTaskNodeNames(List<WorkflowTask> tasks) {
        if (tasks == null || tasks.isEmpty()) return;
        for (WorkflowTask task : tasks) {
            try {
                WorkflowInstance instance = workflowInstanceRepository.findById(task.getInstanceId()).orElse(null);
                if (instance == null) continue;
                WorkflowDefinition definition = workflowDefinitionRepository.findById(instance.getWorkflowId()).orElse(null);
                if (definition == null) continue;
                List<Map<String, Object>> nodes = objectMapper.readValue(
                        definition.getNodes(),
                        new TypeReference<List<Map<String, Object>>>() {});
                for (Map<String, Object> node : nodes) {
                    if (task.getNodeId().equals(node.get("nodeId"))) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> data = (Map<String, Object>) node.get("data");
                        if (data != null) {
                            task.setNodeName((String) data.get("label"));
                        } else {
                            task.setNodeName((String) node.get("label"));
                        }
                        break;
                    }
                }
            } catch (Exception ignored) {
            }
        }
    }

    @Transactional
    public WorkflowDefinition unpublishDefinition(Long id) {
        WorkflowDefinition definition = getDefinition(id);
        if (!"PUBLISHED".equals(definition.getStatus())) {
            throw new RuntimeException("只能下线已发布的流程");
        }

        WorkflowDefinition draft = getDraftForPublished(definition);
        if (draft != null) {
            draft.setPublishedVersionId(null);
            workflowDefinitionRepository.save(draft);
        }

        definition.setStatus("DRAFT");
        return workflowDefinitionRepository.save(definition);
    }

    private WorkflowDefinition getDraftForPublished(WorkflowDefinition published) {
        List<WorkflowDefinition> drafts = workflowDefinitionRepository
                .findByApplicationIdAndStatus(published.getApplicationId(), "DRAFT");
        return drafts.stream()
                .filter(d -> published.getId().equals(d.getPublishedVersionId()))
                .findFirst()
                .orElse(null);
    }

    @Transactional
    public void deleteDefinition(Long id) {
        WorkflowDefinition definition = getDefinition(id);
        if ("PUBLISHED".equals(definition.getStatus())) {
            throw new RuntimeException("已发布的流程不能删除，请先下线");
        }

        if (definition.getPublishedVersionId() != null) {
            WorkflowDefinition published = workflowDefinitionRepository
                    .findById(definition.getPublishedVersionId()).orElse(null);
            if (published != null) {
                published.setPublishedVersionId(null);
                workflowDefinitionRepository.save(published);
            }
        }

        workflowDefinitionRepository.deleteById(id);
    }

    public List<WorkflowInstance> listMyInstances(Long userId) {
        List<WorkflowInstance> instances = workflowInstanceRepository.findByInitiatorId(userId);
        instances = filterPlatformInstances(instances);
        populateAppNames(instances);
        return instances;
    }

    public List<WorkflowInstance> listMyInstances(Long userId, Boolean isTest) {
        List<WorkflowInstance> instances;
        if (isTest != null) {
            instances = workflowInstanceRepository.findByInitiatorIdAndIsTest(userId, isTest);
        } else {
            instances = workflowInstanceRepository.findByInitiatorIdAndIsTest(userId, false);
        }
        instances = filterPlatformInstances(instances);
        populateAppNames(instances);
        return instances;
    }

    public List<WorkflowInstance> listMyInstances(Long userId, Boolean isTest, Long applicationId) {
        List<WorkflowInstance> instances;
        if (applicationId != null) {
            instances = workflowInstanceRepository.findByInitiatorIdAndIsTestAndApplicationId(userId, isTest != null ? isTest : false, applicationId);
        } else {
            instances = listMyInstances(userId, isTest);
        }
        populateAppNames(instances);
        return instances;
    }

    private List<WorkflowInstance> filterPlatformInstances(List<WorkflowInstance> instances) {
        if (instances == null || instances.isEmpty()) return instances;
        return instances.stream().filter(inst -> {
            WorkflowDefinition def = workflowDefinitionRepository.findById(inst.getWorkflowId()).orElse(null);
            return def == null || !"PLATFORM".equals(def.getScope());
        }).collect(Collectors.toList());
    }

    public List<WorkflowInstance> listInstancesByApp(Long applicationId) {
        List<WorkflowInstance> instances = workflowInstanceRepository.findByWorkflowIdIn(
                workflowDefinitionRepository.findByApplicationId(applicationId)
                        .stream().map(WorkflowDefinition::getId).toList());
        populateInitiatorNames(instances);
        return instances;
    }

    public WorkflowInstance getInstance(Long id) {
        WorkflowInstance instance = workflowInstanceRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("流程实例不存在: " + id));
        populateInitiatorNames(List.of(instance));
        AgentLogger.bug("bug-formId-zero.log",
            String.format("getInstance id=%d, workflowId=%d, formId=%d, formData=%s",
                id, instance.getWorkflowId(), instance.getFormId(), instance.getFormData()));
        return instance;
    }

    public List<WorkflowHistory> getInstanceHistory(Long instanceId) {
        List<WorkflowHistory> histories = workflowHistoryRepository.findByInstanceIdOrderByCreatedAtAsc(instanceId);
        populateHistoryOperatorNames(histories);
        return histories;
    }

    private void populateHistoryOperatorNames(List<WorkflowHistory> histories) {
        if (histories == null || histories.isEmpty()) return;
        for (WorkflowHistory h : histories) {
            memberRepository.findById(h.getOperatorId())
                    .ifPresent(member -> h.setOperatorName(member.getName()));
        }
    }

    public List<WorkflowTask> getPendingTasks(Long userId) {
        List<WorkflowTask> tasks = workflowTaskRepository.findByAssigneeIdAndStatus(userId, "PENDING");
        populateTaskAppNames(tasks);
        populateTaskNodeNames(tasks);
        return tasks;
    }

    public List<WorkflowTask> getPendingTasks(Long userId, Long applicationId) {
        List<WorkflowTask> tasks;
        if (applicationId != null) {
            tasks = workflowTaskRepository.findByAssigneeIdAndStatusAndApplicationId(userId, "PENDING", applicationId);
        } else {
            tasks = getPendingTasks(userId);
        }
        populateTaskAppNames(tasks);
        populateTaskNodeNames(tasks);
        return tasks;
    }

    public List<WorkflowTask> getPendingTasks(Long userId, Long applicationId, Boolean isTest) {
        List<WorkflowTask> tasks;
        if (isTest != null) {
            if (applicationId != null) {
                tasks = workflowTaskRepository.findByAssigneeIdAndStatusAndApplicationIdAndIsTest(userId, "PENDING", applicationId, isTest);
            } else {
                tasks = workflowTaskRepository.findByAssigneeIdAndStatusAndIsTest(userId, "PENDING", isTest);
            }
        } else {
            tasks = getPendingTasks(userId, applicationId);
        }
        populateTaskAppNames(tasks);
        populateTaskNodeNames(tasks);
        return tasks;
    }

    public List<WorkflowTask> getCompletedTasks(Long userId) {
        List<WorkflowTask> tasks = workflowTaskRepository.findByAssigneeId(userId);
        populateTaskAppNames(tasks);
        populateTaskNodeNames(tasks);
        return tasks;
    }

    public List<WorkflowTask> getCompletedTasks(Long userId, Long applicationId) {
        List<WorkflowTask> tasks;
        if (applicationId != null) {
            tasks = workflowTaskRepository.findByAssigneeIdAndApplicationId(userId, applicationId);
        } else {
            tasks = getCompletedTasks(userId);
        }
        populateTaskAppNames(tasks);
        populateTaskNodeNames(tasks);
        return tasks;
    }

    public List<WorkflowTask> getCompletedTasks(Long userId, Long applicationId, Boolean isTest) {
        List<WorkflowTask> tasks;
        if (isTest != null) {
            if (applicationId != null) {
                tasks = workflowTaskRepository.findCompletedByAssigneeIdAndApplicationIdAndIsTest(userId, applicationId, isTest);
            } else {
                tasks = workflowTaskRepository.findCompletedByAssigneeIdAndIsTest(userId, isTest);
            }
        } else {
            tasks = getCompletedTasks(userId, applicationId);
        }
        populateTaskAppNames(tasks);
        populateTaskNodeNames(tasks);
        return tasks;
    }

    public long getPendingTaskCount(Long userId) {
        return workflowTaskRepository.countByAssigneeIdAndStatus(userId, "PENDING");
    }

    @Transactional
    public WorkflowInstance startProcess(Long definitionId, String formData, Long userId, String userName) {
        return startProcess(definitionId, formData, userId, userName, false);
    }

    @Transactional
    public WorkflowInstance startProcess(Long definitionId, String formData, Long userId, String userName, boolean isTest) {
        WorkflowDefinition definition = getDefinition(definitionId);

        if (!isTest && !"PUBLISHED".equals(definition.getStatus())) {
            throw new RuntimeException("流程定义未发布，无法发起正式流程");
        }

        if (isTest && "PUBLISHED".equals(definition.getStatus())) {
            throw new RuntimeException("已发布流程不能发起测试，请使用草稿版本");
        }

        Long effectiveDefinitionId = definitionId;
        if (!isTest && definition.getPublishedVersionId() != null) {
            WorkflowDefinition published = workflowDefinitionRepository
                    .findById(definition.getPublishedVersionId()).orElse(null);
            if (published != null) {
                effectiveDefinitionId = published.getId();
            }
        }

        return processEngine.startProcess(effectiveDefinitionId, formData, userId, userName, isTest);
    }

    @Transactional
    public WorkflowTask approveTask(Long taskId, String comment, Long userId, String userName) {
        return processEngine.completeTask(taskId, "APPROVE", comment, userId, userName);
    }

    @Transactional
    public WorkflowTask rejectTask(Long taskId, String comment, Long userId, String userName) {
        return processEngine.completeTask(taskId, "REJECT", comment, userId, userName);
    }

    @Transactional
    public void rejectToNode(Long instanceId, String targetNodeId, String comment, Long userId, String userName) {
        processEngine.rejectToNode(instanceId, targetNodeId, comment, userId, userName);
    }

    @Transactional
    public WorkflowTask transferTask(Long taskId, Long targetUserId, String targetUserName,
                                      String comment, Long userId, String userName) {
        return processEngine.transferTask(taskId, targetUserId, targetUserName, comment, userId, userName);
    }

    @Transactional
    public WorkflowTask addSign(Long taskId, Long addUserId, String addSignType,
                                 String comment, Long userId, String userName) {
        return processEngine.addSign(taskId, addUserId, addSignType, comment, userId, userName);
    }

    @Transactional
    public WorkflowTask delegateTask(Long taskId, Long delegateUserId, String comment,
                                      Long userId, String userName) {
        return processEngine.delegateTask(taskId, delegateUserId, comment, userId, userName);
    }

    @Transactional
    public void forceJump(Long instanceId, String targetNodeId, String comment, Long userId, String userName) {
        processEngine.forceJump(instanceId, targetNodeId, comment, userId, userName);
    }

    @Transactional
    public void cancelProcess(Long instanceId, Long userId, String userName) {
        processEngine.cancelProcess(instanceId, userId, userName);
    }

    @Transactional
    public void freezeProcess(Long instanceId, Long userId, String userName) {
        processEngine.freezeProcess(instanceId, userId, userName);
    }

    @Transactional
    public void unfreezeProcess(Long instanceId, Long userId, String userName) {
        processEngine.unfreezeProcess(instanceId, userId, userName);
    }

    @Transactional
    public void forceStop(Long instanceId, String comment, Long userId, String userName) {
        processEngine.forceStop(instanceId, comment, userId, userName);
    }

    @Transactional
    public void forceWithdraw(Long instanceId, String comment, Long userId, String userName) {
        processEngine.forceWithdraw(instanceId, comment, userId, userName);
    }

    @Transactional
    public WorkflowTask reassignTask(Long taskId, Long newAssigneeId, String comment, Long userId, String userName) {
        return processEngine.reassignTask(taskId, newAssigneeId, comment, userId, userName);
    }

    public WorkflowTask getTask(Long taskId) {
        return processEngine.getTask(taskId);
    }

    public WorkflowTask getMyTaskForInstance(Long instanceId, Long userId) {
        List<WorkflowTask> tasks = workflowTaskRepository.findByAssigneeIdAndInstanceId(userId, instanceId);
        return tasks.stream().filter(t -> "PENDING".equals(t.getStatus())).findFirst().orElse(null);
    }

    public Map<String, Object> validateWorkflow(Long definitionId) {
        return processEngine.validateWorkflow(definitionId);
    }

    @Transactional
    public WorkflowDefinition copyDefinition(Long id) {
        return processEngine.copyDefinition(id);
    }

    public List<WorkflowDefinition> getVersions(Long id) {
        return processEngine.getVersions(id);
    }

    @Transactional
    public WorkflowTask rejectToPrevious(Long taskId, String comment, Long userId, String userName) {
        return processEngine.rejectToPrevious(taskId, comment, userId, userName);
    }

    @Transactional
    public WorkflowInstance resubmitInstance(Long instanceId, String formDataJson, Long userId, String userName) {
        return processEngine.resubmitInstance(instanceId, formDataJson, userId, userName);
    }

    public Map<String, String> getFieldPermissions(Long workflowId, String nodeId) {
        return processEngine.getFieldPermissions(workflowId, nodeId);
    }

    public List<String> getVisibleFields(Long workflowId, String nodeId, List<String> allFields) {
        return processEngine.getVisibleFields(workflowId, nodeId, allFields);
    }

    public List<String> getEditableFields(Long workflowId, String nodeId, List<String> allFields) {
        return processEngine.getEditableFields(workflowId, nodeId, allFields);
    }

    public List<WorkflowInstance> getSubProcessInstances(Long parentInstanceId) {
        return processEngine.getSubProcessInstances(parentInstanceId);
    }

    /**
     * 校验流程节点中的成员/角色/部门 ID 是否存在
     */
    @SuppressWarnings("unchecked")
    private void validateNodeConfig(String nodesJson) {
        if (nodesJson == null || nodesJson.trim().isEmpty()) return;
        try {
            List<Map<String, Object>> nodes = objectMapper.readValue(nodesJson, new TypeReference<List<Map<String, Object>>>() {});
            List<String> errors = new ArrayList<>();

            for (Map<String, Object> node : nodes) {
                String nodeType = (String) node.get("nodeType");
                String nodeName = (String) node.getOrDefault("nodeName", node.get("nodeId"));
                Map<String, Object> config = (Map<String, Object>) node.get("config");
                if (config == null) continue;

                if ("approval".equals(nodeType)) {
                    String approverType = (String) config.get("approverType");
                    if ("member".equals(approverType)) {
                        List<Object> memberIds = (List<Object>) config.get("approverIds");
                        if (memberIds != null) {
                            for (Object id : memberIds) {
                                Long memberId = Long.valueOf(id.toString());
                                if (!memberRepository.existsById(memberId)) {
                                    errors.add("节点「" + nodeName + "」中的人员 ID " + memberId + " 不存在");
                                }
                            }
                        }
                    }
                    if ("role".equals(approverType)) {
                        List<Object> roleIds = (List<Object>) config.get("roleIds");
                        if (roleIds != null) {
                            for (Object id : roleIds) {
                                Long roleId = Long.valueOf(id.toString());
                                if (!roleRepository.existsById(roleId)) {
                                    errors.add("节点「" + nodeName + "」中的角色 ID " + roleId + " 不存在");
                                }
                            }
                        }
                    }
                    if ("department_head".equals(approverType)) {
                        String source = (String) config.getOrDefault("departmentSource", "");
                        if ("specified".equals(source)) {
                            List<Object> deptIds = (List<Object>) config.get("departmentIds");
                            if (deptIds != null) {
                                for (Object id : deptIds) {
                                    Long deptId = Long.valueOf(id.toString());
                                    if (!departmentRepository.existsById(deptId)) {
                                        errors.add("节点「" + nodeName + "」中的部门 ID " + deptId + " 不存在");
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (!errors.isEmpty()) {
                throw new RuntimeException("流程配置校验失败:\n" + String.join("\n", errors));
            }
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            log.warn("节点配置校验跳过（JSON 解析失败）: {}", e.getMessage());
        }
    }
}