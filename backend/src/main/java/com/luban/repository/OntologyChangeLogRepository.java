package com.luban.repository;

import com.luban.entity.OntologyChangeLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;

public interface OntologyChangeLogRepository extends JpaRepository<OntologyChangeLog, Long> {
    List<OntologyChangeLog> findBySessionIdOrderByCreatedAt(String sessionId);
    List<OntologyChangeLog> findBySessionIdAndStatus(String sessionId, String status);
    List<OntologyChangeLog> findByStatusOrderByCreatedAt(String status);

    /** 本体图对账指纹用 */
    @Query("select max(l.id) from OntologyChangeLog l")
    Long maxId();
}