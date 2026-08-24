package com.luban.repository;

import com.luban.entity.OntologyGroup;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface OntologyGroupRepository extends JpaRepository<OntologyGroup, Long> {
    Optional<OntologyGroup> findByName(String name);
    boolean existsByName(String name);
    List<OntologyGroup> findByIndustryId(Long industryId);
}