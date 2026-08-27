package com.luban.repository;

import com.luban.entity.ConceptRelation;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ConceptRelationRepository extends JpaRepository<ConceptRelation, Long> {
    List<ConceptRelation> findBySourceConceptId(Long sourceConceptId);
    List<ConceptRelation> findByTargetConceptId(Long targetConceptId);
    List<ConceptRelation> findBySourceConceptIdAndRelationType(Long sourceConceptId, String relationType);
    List<ConceptRelation> findByTargetConceptIdAndRelationType(Long targetConceptId, String relationType);
    List<ConceptRelation> findBySourceConceptIdIn(List<Long> sourceConceptIds);
    List<ConceptRelation> findByTargetConceptIdIn(List<Long> targetConceptIds);
    List<ConceptRelation> findBySourceConceptIdAndTargetConceptIdAndRelationType(
            Long sourceConceptId, Long targetConceptId, String relationType);
    void deleteBySourceConceptIdIn(List<Long> sourceConceptIds);
    void deleteByTargetConceptIdIn(List<Long> targetConceptIds);
}