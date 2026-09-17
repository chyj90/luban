package com.luban.repository;

import com.luban.entity.UserDept;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.Optional;

public interface UserDeptRepository extends JpaRepository<UserDept, Long> {
    List<UserDept> findByUserId(Long userId);
    Optional<UserDept> findByUserIdAndIsPrimaryTrue(Long userId);
    Optional<UserDept> findByUserIdAndDepartmentId(Long userId, Long departmentId);
    List<UserDept> findByDepartmentId(Long departmentId);

    /** 用户主部门 ID（组织资产：this.auth.userDepartmentId 的注入源） */
    @Query(value = "SELECT ud.department_id FROM user_dept ud WHERE ud.user_id = :userId AND ud.is_primary = TRUE ORDER BY ud.id LIMIT 1", nativeQuery = true)
    Optional<Long> findPrimaryDeptIdByUserId(@Param("userId") Long userId);

    /** 用户主部门名（优先 user_dept 快照，缺失时回退 departments.name，与用户管理页口径一致） */
    @Query(value = "SELECT COALESCE(ud.department_name, d.name) FROM user_dept ud LEFT JOIN departments d ON d.id = ud.department_id WHERE ud.user_id = :userId AND ud.is_primary = TRUE ORDER BY ud.id LIMIT 1", nativeQuery = true)
    Optional<String> findPrimaryDeptNameByUserId(@Param("userId") Long userId);
    @Modifying
    @Transactional
    void deleteByUserIdAndDepartmentId(Long userId, Long departmentId);
    @Modifying
    @Transactional
    void deleteByUserId(Long userId);
}