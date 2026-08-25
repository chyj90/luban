package com.luban.repository;

import com.luban.entity.UserDept;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.Optional;

public interface UserDeptRepository extends JpaRepository<UserDept, Long> {
    List<UserDept> findByUserId(Long userId);
    Optional<UserDept> findByUserIdAndIsPrimaryTrue(Long userId);
    Optional<UserDept> findByUserIdAndDepartmentId(Long userId, Long departmentId);
    List<UserDept> findByDepartmentId(Long departmentId);
    @Modifying
    @Transactional
    void deleteByUserIdAndDepartmentId(Long userId, Long departmentId);
    @Modifying
    @Transactional
    void deleteByUserId(Long userId);
}