package com.luban.workflow.repository;

import com.luban.constant.WorkflowScope;
import com.luban.workflow.entity.WorkflowDefinition;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface WorkflowDefinitionRepository extends JpaRepository<WorkflowDefinition, Long> {
    List<WorkflowDefinition> findByApplicationId(Long applicationId);
    List<WorkflowDefinition> findByApplicationIdAndStatus(Long applicationId, String status);
    List<WorkflowDefinition> findByNameAndApplicationIdOrderByVersionDesc(String name, Long applicationId);
    List<WorkflowDefinition> findByScope(WorkflowScope scope);
    boolean existsByApplicationIdAndStatus(Long applicationId, String status);
    long countByApplicationId(Long applicationId);
    long countByApplicationIdAndStatus(Long applicationId, String status);
    void deleteByApplicationId(Long applicationId);
}