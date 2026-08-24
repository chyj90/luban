package com.luban.repository;

import com.luban.entity.ConceptSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface ConceptSnapshotRepository extends JpaRepository<ConceptSnapshot, Long> {
    List<ConceptSnapshot> findByGroupIdOrderByCreatedAtDesc(Long groupId);
    Optional<ConceptSnapshot> findByGroupIdAndVersion(Long groupId, String version);
    List<ConceptSnapshot> findAllByOrderByCreatedAtDesc();
    long countByGroupId(Long groupId);
}