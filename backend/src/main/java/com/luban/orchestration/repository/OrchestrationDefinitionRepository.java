package com.luban.orchestration.repository;

import com.luban.orchestration.entity.OrchestrationDefinition;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface OrchestrationDefinitionRepository extends JpaRepository<OrchestrationDefinition, Long> {
    List<OrchestrationDefinition> findByApplicationIdAndStatusNotOrderByUpdatedAtDesc(Long applicationId, String status);
}