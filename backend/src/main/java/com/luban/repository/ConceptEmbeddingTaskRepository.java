package com.luban.repository;

import com.luban.entity.ConceptEmbeddingTask;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ConceptEmbeddingTaskRepository extends JpaRepository<ConceptEmbeddingTask, Long> {
    List<ConceptEmbeddingTask> findByStatus(String status);
    List<ConceptEmbeddingTask> findByConceptId(Long conceptId);
    List<ConceptEmbeddingTask> findAllByOrderByCreatedAtDesc();
    void deleteByConceptIdIn(List<Long> conceptIds);
}