package com.luban.workflow.repository;

import com.luban.workflow.entity.Role;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface RoleRepository extends JpaRepository<Role, Long> {
    List<Role> findByApplicationId(Long applicationId);
    Optional<Role> findBySlug(String slug);
    List<Role> findByScope(String scope);
}