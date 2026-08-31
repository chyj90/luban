package com.luban.repository;

import com.luban.entity.JdbcDriver;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface JdbcDriverRepository extends JpaRepository<JdbcDriver, Long> {
    Optional<JdbcDriver> findByName(String name);
    List<JdbcDriver> findByEnabledTrue();
    List<JdbcDriver> findByInstalledTrue();
    boolean existsByName(String name);
}