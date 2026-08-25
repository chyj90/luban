package com.luban.workflow.repository;

import com.luban.workflow.entity.FormDefinition;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface FormDefinitionRepository extends JpaRepository<FormDefinition, Long> {
    List<FormDefinition> findByApplicationId(Long applicationId);
    void deleteByApplicationId(Long applicationId);
}