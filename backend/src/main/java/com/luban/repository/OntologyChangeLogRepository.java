package com.luban.repository;

import com.luban.entity.OntologyChangeLog;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface OntologyChangeLogRepository extends JpaRepository<OntologyChangeLog, Long> {
    List<OntologyChangeLog> findBySessionIdOrderByCreatedAt(String sessionId);
    List<OntologyChangeLog> findBySessionIdAndStatus(String sessionId, String status);
    List<OntologyChangeLog> findByStatusOrderByCreatedAt(String status);
}