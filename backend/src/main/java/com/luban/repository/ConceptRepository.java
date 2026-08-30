package com.luban.repository;

import com.luban.entity.Concept;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ConceptRepository extends JpaRepository<Concept, Long> {
    List<Concept> findByGroupId(Long groupId);
    List<Concept> findByGroupIdOrGroupIdIsNull(Long groupId);
    List<Concept> findByName(String name);
    List<Concept> findByNameContaining(String keyword);
    List<Concept> findByIdIn(List<Long> ids);
    long countByGroupId(Long groupId);
    void deleteByGroupId(Long groupId);
    long countByEmbeddingIsNotNull();
}