package com.luban.repository;

import com.luban.entity.BindingProfile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface BindingProfileRepository extends JpaRepository<BindingProfile, Long> {
    Optional<BindingProfile> findByDatasourceId(Long datasourceId);
    boolean existsByDatasourceId(Long datasourceId);
}
