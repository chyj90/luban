package com.luban.repository;

import com.luban.entity.ConceptRelation;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ConceptRelationRepository extends JpaRepository<ConceptRelation, Long> {
    List<ConceptRelation> findBySourceConceptId(Long sourceConceptId);
    List<ConceptRelation> findByTargetConceptId(Long targetConceptId);
    List<ConceptRelation> findBySourceConceptIdAndRelationType(Long sourceConceptId, String relationType);
    List<ConceptRelation> findByTargetConceptIdAndRelationType(Long targetConceptId, String relationType);
}