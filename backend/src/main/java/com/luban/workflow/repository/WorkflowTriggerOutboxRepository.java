package com.luban.workflow.repository;

import com.luban.workflow.entity.WorkflowTriggerOutbox;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;

public interface WorkflowTriggerOutboxRepository extends JpaRepository<WorkflowTriggerOutbox, Long> {

    List<WorkflowTriggerOutbox> findTop20ByStatusAndNextRetryAtBeforeOrderByIdAsc(
            String status, LocalDateTime before);
}
