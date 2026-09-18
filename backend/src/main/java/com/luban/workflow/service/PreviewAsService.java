package com.luban.workflow.service;

import com.luban.entity.Application;
import com.luban.entity.User;
import com.luban.exception.BusinessException;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.UserRepository;
import com.luban.workflow.entity.WorkflowDefinition;
import com.luban.workflow.entity.WorkflowInstance;
import com.luban.workflow.entity.WorkflowTask;
import com.luban.workflow.repository.WorkflowDefinitionRepository;
import com.luban.workflow.repository.WorkflowInstanceRepository;
import com.luban.workflow.repository.WorkflowTaskRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * 设计器"身份预览"的服务端闸门（preview-as）：仅应用所有者可把本次操作
 * （发起流程/审批/查待办）以指定真实平台用户身份执行，每次使用留审计日志。
 *
 * 安全语义（威胁模型同 selftest 引擎）：
 *  - 目标身份必须是真实平台用户；
 *  - 被操作资源必须属于操作者拥有的应用（definition/instance/task → applicationId 反查）；
 *  - 审批的 assignee 校验在引擎内原样生效——所有者无法替非审批人完成任务；
 *  - 不签发任何令牌，身份只作为服务层参数存在，HTTP 会话仍是操作者本人。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PreviewAsService {

    private final WorkflowDefinitionRepository definitionRepository;
    private final WorkflowInstanceRepository instanceRepository;
    private final WorkflowTaskRepository taskRepository;
    private final ApplicationRepository applicationRepository;
    private final UserRepository userRepository;

    /** 以预览身份发起流程（definition → application 归属校验） */
    public User resolveForDefinition(Long definitionId, Long previewAsUserId, User operator) {
        WorkflowDefinition def = definitionRepository.findById(definitionId)
                .orElseThrow(() -> new BusinessException("流程定义不存在"));
        checkAppOwner(def.getApplicationId(), operator);
        return resolve(previewAsUserId, operator, "workflow.start definition=" + definitionId);
    }

    /** 以预览身份处理审批任务（task → instance → application 归属校验） */
    public User resolveForTask(Long taskId, Long previewAsUserId, User operator) {
        WorkflowTask task = taskRepository.findById(taskId)
                .orElseThrow(() -> new BusinessException("任务不存在"));
        WorkflowInstance instance = instanceRepository.findById(task.getInstanceId())
                .orElseThrow(() -> new BusinessException("流程实例不存在"));
        checkAppOwner(instance.getApplicationId(), operator);
        return resolve(previewAsUserId, operator, "task.complete task=" + taskId);
    }

    /** 以预览身份查询应用内待办（applicationId 显式给出） */
    public User resolveForApp(Long applicationId, Long previewAsUserId, User operator) {
        checkAppOwner(applicationId, operator);
        return resolve(previewAsUserId, operator, "task.list app=" + applicationId);
    }

    private User resolve(Long previewAsUserId, User operator, String scope) {
        User target = userRepository.findById(previewAsUserId)
                .orElseThrow(() -> new BusinessException("预览身份不可用"));
        log.info("[preview-as] operator={} acts as {} (scope: {})", operator.getId(), target.getId(), scope);
        return target;
    }

    private void checkAppOwner(Long applicationId, User operator) {
        Application app = applicationRepository.findById(applicationId)
                .orElseThrow(() -> new BusinessException("应用不存在"));
        if (!app.getCreatedBy().equals(operator.getId())) {
            throw new BusinessException("仅应用所有者可使用身份预览");
        }
    }
}
