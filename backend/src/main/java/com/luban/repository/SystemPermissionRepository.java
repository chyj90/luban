package com.luban.repository;

import com.luban.entity.SystemPermission;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface SystemPermissionRepository extends JpaRepository<SystemPermission, Long> {

    List<SystemPermission> findByUserId(Long userId);

    List<SystemPermission> findByGroupId(Long groupId);

    Optional<SystemPermission> findByUserIdAndGroupId(Long userId, Long groupId);

    Optional<SystemPermission> findByWorkflowInstanceId(Long workflowInstanceId);

    List<SystemPermission> findByStatus(String status);
}