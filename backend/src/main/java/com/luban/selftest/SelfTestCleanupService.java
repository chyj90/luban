package com.luban.selftest;

import com.luban.workflow.repository.WorkflowHistoryRepository;
import com.luban.workflow.repository.WorkflowInstanceRepository;
import com.luban.workflow.repository.WorkflowTaskRepository;
import com.luban.workflow.repository.WorkflowTriggerOutboxRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 自检测试的流程实例清除（决策 3：物理清除，避免测试审批记录留在 history 中污染审计——威胁模型 T7）。
 * 独立 Bean 保证 @Transactional 代理生效（引擎主流程非事务，清理需原子）。
 */
@Service
public class SelfTestCleanupService {

    private final WorkflowInstanceRepository workflowInstanceRepository;
    private final WorkflowTaskRepository workflowTaskRepository;
    private final WorkflowHistoryRepository workflowHistoryRepository;
    private final WorkflowTriggerOutboxRepository outboxRepository;

    public SelfTestCleanupService(
            WorkflowInstanceRepository workflowInstanceRepository,
            WorkflowTaskRepository workflowTaskRepository,
            WorkflowHistoryRepository workflowHistoryRepository,
            WorkflowTriggerOutboxRepository outboxRepository) {
        this.workflowInstanceRepository = workflowInstanceRepository;
        this.workflowTaskRepository = workflowTaskRepository;
        this.workflowHistoryRepository = workflowHistoryRepository;
        this.outboxRepository = outboxRepository;
    }

    /** 删除流程实例及其任务/审批历史/触发器派发行（owner 已在入口校验） */
    @Transactional
    public void purgeInstance(Long instanceId) {
        outboxRepository.deleteByInstanceId(instanceId);
        workflowTaskRepository.deleteByInstanceIdIn(List.of(instanceId));
        workflowHistoryRepository.deleteByInstanceIdIn(List.of(instanceId));
        workflowInstanceRepository.deleteById(instanceId);
    }
}
