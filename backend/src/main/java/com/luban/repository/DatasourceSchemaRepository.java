package com.luban.repository;

import com.luban.entity.DatasourceSchema;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface DatasourceSchemaRepository extends JpaRepository<DatasourceSchema, Long> {
    Optional<DatasourceSchema> findByDatasourceId(Long datasourceId);
    void deleteByDatasourceId(Long datasourceId);
}
