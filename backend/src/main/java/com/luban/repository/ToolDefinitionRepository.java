package com.luban.repository;

import com.luban.constant.ToolType;
import com.luban.entity.ToolDefinition;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;

public interface ToolDefinitionRepository extends JpaRepository<ToolDefinition, Long> {
    Optional<ToolDefinition> findByName(String name);
    List<ToolDefinition> findByGroupId(Long groupId);
    List<ToolDefinition> findByToolType(ToolType toolType);
    List<ToolDefinition> findByGroupIdAndToolType(Long groupId, ToolType toolType);
    List<ToolDefinition> findByGroupIdAndScope(Long groupId, String scope);
    Optional<ToolDefinition> findByNameAndScope(String name, String scope);
    List<ToolDefinition> findByToolTypeAndScope(ToolType toolType, String scope);
    List<ToolDefinition> findByScope(String scope);
    Page<ToolDefinition> findByScope(String scope, Pageable pageable);
    void deleteByGroupIdAndScope(Long groupId, String scope);

    @Query("SELECT t FROM ToolDefinition t WHERE LOWER(t.name) LIKE LOWER(CONCAT('%', :name, '%'))")
    List<ToolDefinition> findByNameIlike(@Param("name") String name);

    @Query("SELECT t FROM ToolDefinition t WHERE t.scope = :scope AND (LOWER(t.name) LIKE LOWER(CONCAT('%', :search, '%')) OR LOWER(t.displayName) LIKE LOWER(CONCAT('%', :search, '%')) OR LOWER(t.description) LIKE LOWER(CONCAT('%', :search, '%')))")
    Page<ToolDefinition> findByScopeAndSearch(@Param("scope") String scope, @Param("search") String search, Pageable pageable);
}