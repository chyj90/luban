package com.luban.workflow.repository;

import com.luban.workflow.entity.WorkflowInstance;
import org.springframework.data.jpa.repository.JpaRepository;
import java.time.LocalDateTime;
import java.util.List;

public interface WorkflowInstanceRepository extends JpaRepository<WorkflowInstance, Long> {
    List<WorkflowInstance> findByInitiatorId(Long initiatorId);
    List<WorkflowInstance> findByInitiatorIdAndStatus(Long initiatorId, String status);
    List<WorkflowInstance> findByStatus(String status);
    long countByStatus(String status);
    List<WorkflowInstance> findByStatusAndDeadlineBefore(String status, LocalDateTime dateTime);
    List<WorkflowInstance> findByParentInstanceId(Long parentInstanceId);
}