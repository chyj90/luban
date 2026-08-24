package com.luban.service;

import com.luban.entity.RoleConceptPermission;
import com.luban.repository.RoleConceptPermissionRepository;
import com.luban.repository.ConceptRepository;
import com.luban.entity.Concept;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class RoleConceptPermissionService {

    private final RoleConceptPermissionRepository permissionRepository;
    private final ConceptRepository conceptRepository;
    private final com.luban.workflow.repository.RoleUserRepository roleUserRepository;

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
            return false;
        }
        return permissionRepository.existsByRoleIdInAndGroupId(roleIds, groupId);
    }

    @Transactional(readOnly = true)
    public Map<Long, Boolean> batchCheckQueryPermission(Long userId, List<Long> conceptIds) {
        List<Concept> concepts = conceptRepository.findAllById(conceptIds);
        List<Long> roleIds = roleUserRepository.findByUserId(userId)
                .stream().map(ru -> ru.getRoleId()).toList();

        Map<Long, Boolean> result = new HashMap<>();
        for (Concept concept : concepts) {
            Long groupId = concept.getGroupId();
            if (groupId == null) {
                result.put(concept.getId(), true);
            } else if (roleIds.isEmpty()) {
                result.put(concept.getId(), false);
            } else {
                boolean hasPerm = permissionRepository.existsByRoleIdInAndGroupId(roleIds, groupId);
                result.put(concept.getId(), hasPerm);
            }
        }
        return result;
    }
}