package com.luban.repository;

import com.luban.entity.RoleConceptPermission;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface RoleConceptPermissionRepository extends JpaRepository<RoleConceptPermission, Long> {
    List<RoleConceptPermission> findByRoleId(Long roleId);
    List<RoleConceptPermission> findByGroupId(Long groupId);
    boolean existsByRoleIdAndGroupId(Long roleId, Long groupId);
    void deleteByRoleId(Long roleId);
    boolean existsByRoleIdInAndGroupId(List<Long> roleIds, Long groupId);
}