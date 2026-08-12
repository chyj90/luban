package com.luban.repository;

import com.luban.entity.Page;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface PageRepository extends JpaRepository<Page, Long> {
    List<Page> findByApplicationId(Long applicationId);
    void deleteByApplicationId(Long applicationId);
}