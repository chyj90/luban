package com.luban.repository;

import com.luban.entity.ApplicationApiKey;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import java.util.List;
import java.util.Optional;

public interface ApplicationApiKeyRepository extends JpaRepository<ApplicationApiKey, Long> {
    List<ApplicationApiKey> findByApplicationId(Long applicationId);
    List<ApplicationApiKey> findByApplicationIdAndStatus(Long applicationId, String status);
    List<ApplicationApiKey> findByApiKeyId(Long apiKeyId);
    Optional<ApplicationApiKey> findByApplicationIdAndApiKeyId(Long applicationId, Long apiKeyId);
    @Modifying
    void deleteByApplicationIdAndApiKeyId(Long applicationId, Long apiKeyId);
}