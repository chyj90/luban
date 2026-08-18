package com.luban.repository;

import com.luban.entity.McpServerRegistry;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface McpServerRegistryRepository extends JpaRepository<McpServerRegistry, Long> {
    List<McpServerRegistry> findByStatus(String status);
}