package com.luban.repository;

import com.luban.entity.ToolDefinition;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface ToolDefinitionRepository extends JpaRepository<ToolDefinition, Long> {
    Optional<ToolDefinition> findByName(String name);
    List<ToolDefinition> findByGroupId(Long groupId);
    List<ToolDefinition> findByToolType(String toolType);
    List<ToolDefinition> findByStatus(String status);
    List<ToolDefinition> findByGroupIdAndStatus(Long groupId, String status);
    List<ToolDefinition> findByGroupIdAndToolType(Long groupId, String toolType);
}