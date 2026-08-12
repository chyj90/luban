package com.luban.repository;

import com.luban.entity.Datasource;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface DatasourceRepository extends JpaRepository<Datasource, Long> {
    List<Datasource> findByApplicationId(Long applicationId);
}