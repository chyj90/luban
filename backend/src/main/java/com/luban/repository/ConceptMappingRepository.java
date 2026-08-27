package com.luban.repository;

import com.luban.entity.ConceptMapping;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;

public interface ConceptMappingRepository extends JpaRepository<ConceptMapping, Long> {
    List<ConceptMapping> findByConceptId(Long conceptId);
    List<ConceptMapping> findByConceptIdAndDatasourceId(Long conceptId, Long datasourceId);
    List<ConceptMapping> findByDatasourceId(Long datasourceId);
    List<ConceptMapping> findByConceptIdAndColumnNameAndDatasourceId(Long conceptId, String columnName, Long datasourceId);
    void deleteByConceptIdAndDatasourceId(Long conceptId, Long datasourceId);

    @Query("SELECT m FROM ConceptMapping m WHERE m.conceptId IN :conceptIds")
    List<ConceptMapping> findByConceptIdIn(List<Long> conceptIds);

    @Query("SELECT m FROM ConceptMapping m WHERE m.conceptId IN :conceptIds AND m.datasourceId IN :datasourceIds")
    List<ConceptMapping> findByConceptIdInAndDatasourceIdIn(List<Long> conceptIds, List<Long> datasourceIds);

    @Query("SELECT DISTINCT m.conceptId FROM ConceptMapping m")
    List<Long> findDistinctConceptIds();

    void deleteByConceptIdIn(List<Long> conceptIds);

    List<ConceptMapping> findByTableNameIn(List<String> tableNames);
}