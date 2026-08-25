package com.luban.repository;

import com.luban.entity.Query;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface QueryRepository extends JpaRepository<Query, Long> {
    List<Query> findByApplicationId(Long applicationId);
    void deleteByApplicationId(Long applicationId);
}