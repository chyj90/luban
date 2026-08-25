package com.luban.workflow.repository;

import com.luban.workflow.entity.WorkflowHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface WorkflowHistoryRepository extends JpaRepository<WorkflowHistory, Long> {
    List<WorkflowHistory> findByInstanceIdOrderByCreatedAtAsc(Long instanceId);
    List<WorkflowHistory> findByInstanceIdOrderByCreatedAtDesc(Long instanceId);
    List<WorkflowHistory> findByTaskId(Long taskId);
    List<WorkflowHistory> findByOperatorId(Long operatorId);
    void deleteByInstanceIdIn(List<Long> instanceIds);
}