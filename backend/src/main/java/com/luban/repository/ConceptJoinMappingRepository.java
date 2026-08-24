package com.luban.repository;

import com.luban.entity.ConceptJoinMapping;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ConceptJoinMappingRepository extends JpaRepository<ConceptJoinMapping, Long> {
    List<ConceptJoinMapping> findByConceptId(Long conceptId);
    List<ConceptJoinMapping> findByConceptIdIn(List<Long> conceptIds);
    List<ConceptJoinMapping> findByConceptIdAndDatasourceId(Long conceptId, Long datasourceId);
    List<ConceptJoinMapping> findByDatasourceId(Long datasourceId);
    List<ConceptJoinMapping> findByConceptIdInAndJoinTable(List<Long> conceptIds, String joinTable);
    List<ConceptJoinMapping> findByConceptIdInAndDatasourceIdIn(List<Long> conceptIds, List<Long> datasourceIds);
    void deleteByConceptIdIn(List<Long> conceptIds);
}