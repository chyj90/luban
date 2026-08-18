package com.luban.repository;

import com.luban.entity.ToolConcept;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ToolConceptRepository extends JpaRepository<ToolConcept, Long> {
    List<ToolConcept> findByToolId(Long toolId);
    List<ToolConcept> findByConceptId(Long conceptId);
    List<ToolConcept> findByToolIdAndRelation(Long toolId, String relation);
    List<ToolConcept> findByConceptIdAndRelation(Long conceptId, String relation);
    void deleteByToolIdAndConceptIdAndRelation(Long toolId, Long conceptId, String relation);
}