package com.luban.repository;

import com.luban.entity.IndustryRelation;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface IndustryRelationRepository extends JpaRepository<IndustryRelation, Long> {
    List<IndustryRelation> findByIndustryIdOrderBySortOrder(Long industryId);
    void deleteByIndustryId(Long industryId);
}