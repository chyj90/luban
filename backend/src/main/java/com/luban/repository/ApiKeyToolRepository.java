package com.luban.repository;

import com.luban.entity.ApiKeyTool;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import java.util.List;
import java.util.Optional;

public interface ApiKeyToolRepository extends JpaRepository<ApiKeyTool, Long> {
    List<ApiKeyTool> findByApiKeyId(Long apiKeyId);
    List<ApiKeyTool> findByApiKeyIdAndStatus(Long apiKeyId, String status);
    Optional<ApiKeyTool> findByApiKeyIdAndToolId(Long apiKeyId, Long toolId);
    List<ApiKeyTool> findByStatus(String status);
    Optional<ApiKeyTool> findByWorkflowInstanceId(Long workflowInstanceId);
    @Modifying
    void deleteByApiKeyId(Long apiKeyId);
}