package com.luban.repository;

import com.luban.entity.Datasource;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface DatasourceRepository extends JpaRepository<Datasource, Long> {
    List<Datasource> findBySlugAndOwnerId(String slug, Long ownerId);
    List<Datasource> findBySlug(String slug);
    void deleteByOwnerId(Long ownerId);
}