package com.luban.workflow.repository;

import com.luban.workflow.entity.WorkflowDefinition;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface WorkflowDefinitionRepository extends JpaRepository<WorkflowDefinition, Long> {
    List<WorkflowDefinition> findByApplicationId(Long applicationId);
    List<WorkflowDefinition> findByApplicationIdAndStatus(Long applicationId, String status);
    List<WorkflowDefinition> findByNameAndApplicationIdOrderByVersionDesc(String name, Long applicationId);
}