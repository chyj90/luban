package com.luban.workflow.repository;

import com.luban.workflow.entity.Department;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface DepartmentRepository extends JpaRepository<Department, Long> {
    List<Department> findByParentId(Long parentId);
    List<Department> findByParentIdIsNull();
    List<Department> findByProvider(String provider);
    List<Department> findByManagerId(Long managerId);
}