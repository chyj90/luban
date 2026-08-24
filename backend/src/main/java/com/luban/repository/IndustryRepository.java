package com.luban.repository;

import com.luban.entity.Industry;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface IndustryRepository extends JpaRepository<Industry, Long> {
    Optional<Industry> findByName(String name);
    boolean existsByName(String name);
}