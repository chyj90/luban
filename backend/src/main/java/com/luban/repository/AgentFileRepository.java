package com.luban.repository;

import com.luban.entity.AgentFile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AgentFileRepository extends JpaRepository<AgentFile, Long> {

    Optional<AgentFile> findByFileKey(String fileKey);

    List<AgentFile> findByAppIdOrderByCreatedAtDesc(Long appId);

    List<AgentFile> findByOwnerUserIdOrderByCreatedAtDesc(Long ownerUserId);
}
