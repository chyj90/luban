package com.luban.repository;

import com.luban.entity.UserDept;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

public interface UserDeptRepository extends JpaRepository<UserDept, Long> {
    List<UserDept> findByUserId(Long userId);
    List<UserDept> findByDepartmentId(Long departmentId);
    @Modifying
    @Transactional
    void deleteByUserIdAndDepartmentId(Long userId, Long departmentId);
}