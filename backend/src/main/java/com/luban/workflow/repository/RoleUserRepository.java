package com.luban.workflow.repository;

import com.luban.workflow.entity.RoleUser;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

public interface RoleUserRepository extends JpaRepository<RoleUser, Long> {

    List<RoleUser> findByRoleId(Long roleId);

    Optional<RoleUser> findByRoleIdAndUserId(Long roleId, Long userId);

    List<RoleUser> findByRoleIdIn(List<Long> roleIds);

    List<RoleUser> findByUserId(Long userId);

    List<RoleUser> findByUserIdIn(List<Long> userIds);

    @Modifying
    @Transactional
    @Query("DELETE FROM RoleUser ru WHERE ru.roleId = :roleId")
    void deleteByRoleId(Long roleId);

    @Modifying
    @Transactional
    @Query("DELETE FROM RoleUser ru WHERE ru.userId = :userId")
    void deleteByUserId(Long userId);
}