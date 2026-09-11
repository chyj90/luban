package com.luban.orchestration.repository;

import com.luban.orchestration.entity.OrchestrationExecution;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface OrchestrationExecutionRepository extends JpaRepository<OrchestrationExecution, Long> {
    List<OrchestrationExecution> findTop50ByDefinitionIdOrderByCreatedAtDesc(Long definitionId);
    void deleteAllByDefinitionId(Long definitionId);
}