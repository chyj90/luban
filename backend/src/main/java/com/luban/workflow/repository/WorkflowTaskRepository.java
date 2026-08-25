package com.luban.workflow.repository;

import com.luban.workflow.entity.WorkflowTask;
import org.springframework.data.jpa.repository.JpaRepository;
import java.time.LocalDateTime;
import java.util.List;

public interface WorkflowTaskRepository extends JpaRepository<WorkflowTask, Long> {
    List<WorkflowTask> findByInstanceId(Long instanceId);
    List<WorkflowTask> findByAssigneeId(Long assigneeId);
    List<WorkflowTask> findByAssigneeIdAndStatus(Long assigneeId, String status);
    List<WorkflowTask> findByAssigneeIdAndApplicationId(Long assigneeId, Long applicationId);
    List<WorkflowTask> findByAssigneeIdAndStatusAndApplicationId(Long assigneeId, String status, Long applicationId);
    List<WorkflowTask> findByInstanceIdAndNodeId(Long instanceId, String nodeId);
    List<WorkflowTask> findByInstanceIdAndStatus(Long instanceId, String status);
    List<WorkflowTask> findByAssigneeIdAndInstanceId(Long assigneeId, Long instanceId);
    List<WorkflowTask> findByStatusAndDeadlineBefore(String status, LocalDateTime deadline);
    long countByAssigneeIdAndStatus(Long assigneeId, String status);
    void deleteByApplicationId(Long applicationId);
    void deleteByInstanceIdIn(List<Long> instanceIds);
}