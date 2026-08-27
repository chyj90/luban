package com.luban.service;

import com.luban.entity.RoleConceptPermission;
import com.luban.repository.RoleConceptPermissionRepository;
import com.luban.repository.ConceptRepository;
import com.luban.entity.Concept;
import com.luban.workflow.repository.RoleRepository;
import com.luban.workflow.repository.RoleUserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class RoleConceptPermissionService {

    private final RoleConceptPermissionRepository permissionRepository;
    private final ConceptRepository conceptRepository;
    private final RoleUserRepository roleUserRepository;
    private final RoleRepository roleRepository;

    @Transactional(readOnly = true)
    public List<RoleConceptPermission> listByRole(Long roleId) {
        return permissionRepository.findByRoleId(roleId);
    }

    @Transactional
    public void replaceByRole(Long roleId, List<Long> groupIds) {
        permissionRepository.deleteByRoleId(roleId);
        permissionRepository.flush();
        if (groupIds != null && !groupIds.isEmpty()) {
            List<RoleConceptPermission> permissions = groupIds.stream()
                    .map(groupId -> {
                        RoleConceptPermission p = new RoleConceptPermission();
                        p.setRoleId(roleId);
                        p.setGroupId(groupId);
                        return p;
                    })
                    .toList();
            permissionRepository.saveAll(permissions);
        }
    }

    @Transactional(readOnly = true)
    public boolean checkQueryPermission(Long userId, Long conceptId) {
        Concept concept = conceptRepository.findById(conceptId)
                .orElseThrow(() -> new IllegalArgumentException("概念不存在: " + conceptId));
        Long groupId = concept.getGroupId();
        if (groupId == null) {
            return true;
        }
        List<Long> roleIds = roleUserRepository.findByUserId(userId)
                .stream().map(ru -> ru.getRoleId()).toList();
        if (roleIds.isEmpty()) {
            log.info("checkQueryPermission: userId={}, concept={}(id={}) groupId={} DENIED (no roles)",
                    userId, concept.getName(), conceptId, groupId);
            return false;
        }
        boolean hasPerm = permissionRepository.existsByRoleIdInAndGroupId(roleIds, groupId);
        log.info("checkQueryPermission: userId={}, concept={}(id={}) groupId={} roleIds={} hasPerm={}",
                userId, concept.getName(), conceptId, groupId, roleIds, hasPerm);
        return hasPerm;
    }

    @Transactional(readOnly = true)
    public Map<Long, Boolean> batchCheckQueryPermission(Long userId, List<Long> conceptIds) {
        List<Concept> concepts = conceptRepository.findAllById(conceptIds);
        List<Long> roleIds = roleUserRepository.findByUserId(userId)
                .stream().map(ru -> ru.getRoleId()).toList();

        log.info("batchCheckQueryPermission: userId={}, roleIds={}, conceptCount={}",
                userId, roleIds, concepts.size());

        Map<Long, Boolean> result = new HashMap<>();
        for (Concept concept : concepts) {
            Long groupId = concept.getGroupId();
            if (groupId == null) {
                result.put(concept.getId(), true);
            } else if (roleIds.isEmpty()) {
                log.info("batchCheckQueryPermission: concept={}(id={}) groupId={} DENIED (no roles)",
                        concept.getName(), concept.getId(), groupId);
                result.put(concept.getId(), false);
            } else {
                boolean hasPerm = permissionRepository.existsByRoleIdInAndGroupId(roleIds, groupId);
                log.info("batchCheckQueryPermission: concept={}(id={}) groupId={} roleIds={} hasPerm={}",
                        concept.getName(), concept.getId(), groupId, roleIds, hasPerm);
                result.put(concept.getId(), hasPerm);
            }
        }
        return result;
    }

    @Transactional(readOnly = true)
    public boolean isSuperAdmin(Long userId) {
        if (userId == null) {
            return false;
        }
        List<Long> roleIds = roleUserRepository.findByUserId(userId).stream()
                .map(ru -> ru.getRoleId())
                .toList();
        if (roleIds.isEmpty()) {
            return false;
        }
        return roleRepository.findAllById(roleIds).stream()
                .anyMatch(r -> "super_admin".equals(r.getSlug()));
    }

    @Transactional(readOnly = true)
    public Set<Long> getAuthorizedGroupIds(Long userId, Set<Long> groupIdsToCheck) {
        if (userId == null || groupIdsToCheck == null || groupIdsToCheck.isEmpty()) {
            return Set.of();
        }
        List<Long> roleIds = roleUserRepository.findByUserId(userId).stream()
                .map(ru -> ru.getRoleId())
                .toList();
        if (roleIds.isEmpty()) {
            return Set.of();
        }
        return groupIdsToCheck.stream()
                .filter(gid -> permissionRepository.existsByRoleIdInAndGroupId(roleIds, gid))
                .collect(Collectors.toSet());
    }
}