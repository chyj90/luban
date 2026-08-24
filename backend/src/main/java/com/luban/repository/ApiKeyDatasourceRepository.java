package com.luban.repository;

import com.luban.entity.ApiKeyDatasource;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import java.util.List;
import java.util.Optional;

public interface ApiKeyDatasourceRepository extends JpaRepository<ApiKeyDatasource, Long> {
    List<ApiKeyDatasource> findByApiKeyId(Long apiKeyId);
    List<ApiKeyDatasource> findByApiKeyIdAndStatus(Long apiKeyId, String status);
    Optional<ApiKeyDatasource> findByApiKeyIdAndDatasourceId(Long apiKeyId, Long datasourceId);
    List<ApiKeyDatasource> findByStatus(String status);
    Optional<ApiKeyDatasource> findByWorkflowInstanceId(Long workflowInstanceId);
    @Modifying
    void deleteByApiKeyId(Long apiKeyId);
}