package com.luban.repository;

import com.luban.entity.ConceptImportLog;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ConceptImportLogRepository extends JpaRepository<ConceptImportLog, Long> {
    List<ConceptImportLog> findByTargetGroupIdOrderByCreatedAtDesc(Long targetGroupId);
    List<ConceptImportLog> findAllByOrderByCreatedAtDesc();
}