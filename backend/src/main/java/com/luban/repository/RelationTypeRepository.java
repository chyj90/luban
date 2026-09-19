package com.luban.repository;

import com.luban.entity.RelationType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface RelationTypeRepository extends JpaRepository<RelationType, Long> {
    Optional<RelationType> findByRelationType(String relationType);
    boolean existsByRelationType(String relationType);
}
