package com.luban.repository;

import com.luban.entity.AgentConfig;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface AgentConfigRepository extends JpaRepository<AgentConfig, Long> {
    Optional<AgentConfig> findByIsDefaultTrue();
    Optional<AgentConfig> findByName(String name);
}