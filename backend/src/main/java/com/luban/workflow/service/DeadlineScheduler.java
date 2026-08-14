package com.luban.workflow.service;

import com.luban.workflow.entity.WorkflowInstance;
import com.luban.workflow.entity.WorkflowTask;
import com.luban.workflow.repository.WorkflowInstanceRepository;
import com.luban.workflow.repository.WorkflowTaskRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import java.time.LocalDateTime;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class DeadlineScheduler {

    private final WorkflowTaskRepository workflowTaskRepository;
    private final WorkflowInstanceRepository workflowInstanceRepository;
    private final ProcessEngine processEngine;

    @Scheduled(fixedRate = 60000)
    public void checkDeadlines() {
        List<WorkflowTask> overdueTasks = workflowTaskRepository
                .findByStatusAndDeadlineBefore("PENDING", LocalDateTime.now());

        if (!overdueTasks.isEmpty()) {
            log.warn("发现 {} 个超时任务", overdueTasks.size());
            for (WorkflowTask task : overdueTasks) {
                log.warn("任务超时: taskId={}, nodeId={}, deadline={}",
                        task.getId(), task.getNodeId(), task.getDeadline());
            }
            // 触发 SLA 升级逻辑
            processEngine.escalateOverdueTasks();
        }

        // 检查流程实例是否超时
        List<WorkflowInstance> overdueInstances = workflowInstanceRepository
                .findByStatusAndDeadlineBefore("RUNNING", LocalDateTime.now());

        if (!overdueInstances.isEmpty()) {
            log.warn("发现 {} 个超时流程实例", overdueInstances.size());
            for (WorkflowInstance instance : overdueInstances) {
                log.warn("流程实例超时: instanceId={}, deadline={}, 自动冻结",
                        instance.getId(), instance.getDeadline());
                instance.setStatus("FROZEN");
                instance.setCompletedAt(LocalDateTime.now());
                workflowInstanceRepository.save(instance);
            }
        }
    }
}