package com.luban.repository;

import com.luban.entity.ApiKey;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface ApiKeyRepository extends JpaRepository<ApiKey, Long> {
    Optional<ApiKey> findByKeyHash(String keyHash);
    List<ApiKey> findByOwnerId(Long ownerId);
    List<ApiKey> findByStatus(String status);
    List<ApiKey> findByOwnerIdAndStatus(Long ownerId, String status);
}