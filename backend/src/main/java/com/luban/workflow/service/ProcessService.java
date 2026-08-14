package com.luban.workflow.service;

import com.luban.workflow.entity.*;
import com.luban.workflow.repository.*;
import com.luban.repository.ApplicationRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class ProcessService {

    private final ApplicationRepository applicationRepository;
    private final WorkflowDefinitionRepository workflowDefinitionRepository;
    private final WorkflowInstanceRepository workflowInstanceRepository;
    private final WorkflowTaskRepository workflowTaskRepository;
    private final WorkflowHistoryRepository workflowHistoryRepository;
    private final FormDefinitionRepository formDefinitionRepository;
    private final FormWorkflowBindingRepository formWorkflowBindingRepository;
    private final MemberRepository memberRepository;
    private final RoleRepository roleRepository;
    private final DepartmentRepository departmentRepository;
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

        int publishedVersion = draft.getVersion();
        draft.setStatus("PUBLISHED");
        draft.setFormSnapshot(snapshotForm(draft.getId()));
        draft = workflowDefinitionRepository.save(draft);

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

    private String snapshotForm(Long workflowId) {
        List<FormWorkflowBinding> bindings = formWorkflowBindingRepository.findByWorkflowId(workflowId);
        if (bindings.isEmpty()) return null;
        Long formId = bindings.get(0).getFormId();
        return formDefinitionRepository.findById(formId)
                .map(form -> {
                    try {
                        Map<String, Object> snapshot = new LinkedHashMap<>();
                        snapshot.put("id", form.getId());
                        snapshot.put("name", form.getName());
                        snapshot.put("fields", form.getFields());
                        return objectMapper.writeValueAsString(snapshot);
                    } catch (Exception e) {
                        log.warn("表单快照创建失败: workflowId={}, formId={}", workflowId, formId, e);
                        return null;
                    }
                })
                .orElse(null);
    }

    private void populateAppNames(List<WorkflowInstance> instances) {
        if (instances == null || instances.isEmpty()) return;
        for (WorkflowInstance inst : instances) {
            applicationRepository.findById(inst.getApplicationId())
                    .ifPresent(app -> inst.setApplicationName(app.getName()));
        }
    }

    private void populateTaskAppNames(List<WorkflowTask> tasks) {
        if (tasks == null || tasks.isEmpty()) return;
        for (WorkflowTask task : tasks) {
            applicationRepository.findById(task.getApplicationId())
                    .ifPresent(app -> task.setApplicationName(app.getName()));
        }
    }

    @Transactional
    public WorkflowDefinition unpublishDefinition(Long id) {
        WorkflowDefinition definition = getDefinition(id);
        if (!"PUBLISHED".equals(definition.getStatus())) {
            throw new RuntimeException("只能下线已发布的流程");
        }

        WorkflowDefinition draft = getDraftForPublished(definition);
        draft.setPublishedVersionId(null);
        workflowDefinitionRepository.save(draft);

        definition.setStatus("ARCHIVED");
        return workflowDefinitionRepository.save(definition);
    }

    private WorkflowDefinition getDraftForPublished(WorkflowDefinition published) {
        List<WorkflowDefinition> drafts = workflowDefinitionRepository
                .findByApplicationIdAndStatus(published.getApplicationId(), "DRAFT");
        return drafts.stream()
                .filter(d -> published.getId().equals(d.getPublishedVersionId()))
                .findFirst()
                .orElseThrow(() -> new RuntimeException("找不到已发布流程对应的草稿版本"));
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

    public List<WorkflowInstance> listInstancesByApp(Long applicationId) {
        return workflowInstanceRepository.findByWorkflowIdIn(
                workflowDefinitionRepository.findByApplicationId(applicationId)
                        .stream().map(WorkflowDefinition::getId).toList());
    }

    public WorkflowInstance getInstance(Long id) {
        return workflowInstanceRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("流程实例不存在: " + id));
    }

    public List<WorkflowHistory> getInstanceHistory(Long instanceId) {
        return workflowHistoryRepository.findByInstanceIdOrderByCreatedAtAsc(instanceId);
    }

    public List<WorkflowTask> getPendingTasks(Long userId) {
        List<WorkflowTask> tasks = workflowTaskRepository.findByAssigneeIdAndStatus(userId, "PENDING");
        populateTaskAppNames(tasks);
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
        return tasks;
    }

    public List<WorkflowTask> getCompletedTasks(Long userId) {
        List<WorkflowTask> tasks = workflowTaskRepository.findByAssigneeId(userId);
        populateTaskAppNames(tasks);
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
        return tasks;
    }

    public List<WorkflowTask> getCompletedTasks(Long userId, Long applicationId, Boolean isTest) {
        List<WorkflowTask> tasks;
        if (isTest != null) {
            if (applicationId != null) {
                tasks = workflowTaskRepository.findByAssigneeIdAndApplicationIdAndIsTest(userId, applicationId, isTest);
            } else {
                tasks = workflowTaskRepository.findByAssigneeIdAndIsTest(userId, isTest);
            }
        } else {
            tasks = getCompletedTasks(userId, applicationId);
        }
        populateTaskAppNames(tasks);
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