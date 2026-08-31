package com.luban.repository;

import com.luban.entity.JdbcDriverJar;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface JdbcDriverJarRepository extends JpaRepository<JdbcDriverJar, Long> {
    List<JdbcDriverJar> findByDriverId(Long driverId);
    void deleteByDriverId(Long driverId);
}