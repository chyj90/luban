package com.luban.repository;

import com.luban.entity.ToolGroup;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface ToolGroupRepository extends JpaRepository<ToolGroup, Long> {
    Optional<ToolGroup> findByCode(String code);
    List<ToolGroup> findAllByOrderBySortOrderAsc();
}