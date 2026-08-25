package com.luban.workflow.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.entity.Application;
import com.luban.entity.User;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.UserRepository;
import com.luban.workflow.entity.*;
import com.luban.workflow.repository.*;
import com.luban.entity.RoleConceptPermission;
import com.luban.service.RoleConceptPermissionService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/roles")
@RequiredArgsConstructor
@RequirePermission(Permissions.PEOPLE_ROLES)
public class RoleController {

    private final RoleRepository roleRepository;
    private final RolePermissionRepository rolePermissionRepository;
    private final RoleUserRepository roleUserRepository;
    private final UserRepository userRepository;
    private final ApplicationRepository applicationRepository;
    private final RoleConceptPermissionService roleConceptPermissionService;

    private static final String SUPER_ADMIN_SLUG = "super_admin";
    private static final String USER_SLUG = "user";
    private static final Set<String> RESERVED_SLUGS = Set.of(SUPER_ADMIN_SLUG, USER_SLUG);

    private boolean isSuperAdmin(User user) {
        List<RoleUser> roleUsers = roleUserRepository.findByUserId(user.getId());
        List<Long> roleIds = roleUsers.stream().map(RoleUser::getRoleId).toList();
        return roleRepository.findAllById(roleIds).stream()
                .anyMatch(r -> SUPER_ADMIN_SLUG.equals(r.getSlug()));
    }

    @GetMapping
    public ApiResponse<List<Map<String, Object>>> list(@AuthenticationPrincipal User user) {
        List<Role> roles;
        if (isSuperAdmin(user)) {
            List<Role> platformRoles = roleRepository.findByScope("PLATFORM");
            List<Role> appRoles = roleRepository.findByCreatedByAndScope(user.getId(), "APPLICATION");
            platformRoles.addAll(appRoles);
            roles = platformRoles;
        } else {
            roles = roleRepository.findByCreatedByAndScope(user.getId(), "APPLICATION");
        }

        Set<Long> appIds = roles.stream()
                .map(Role::getApplicationId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<Long, String> appNameMap = new HashMap<>();
        if (!appIds.isEmpty()) {
            List<Application> apps = applicationRepository.findAllById(appIds);
            for (Application app : apps) {
                appNameMap.put(app.getId(), app.getName());
            }
        }

        List<Map<String, Object>> result = new ArrayList<>();
        for (Role role : roles) {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("id", role.getId());
            map.put("name", role.getName());
            map.put("slug", role.getSlug());
            map.put("description", role.getDescription());
            map.put("applicationId", role.getApplicationId());
            map.put("scope", role.getScope());
            map.put("createdBy", role.getCreatedBy());
            map.put("createdAt", role.getCreatedAt());
            map.put("updatedAt", role.getUpdatedAt());
            if (role.getApplicationId() != null) {
                map.put("applicationName", appNameMap.getOrDefault(role.getApplicationId(), ""));
            }
            result.add(map);
        }
        return ApiResponse.ok(result);
    }

    @GetMapping("/{id}")
    public ApiResponse<Role> get(@PathVariable Long id, @AuthenticationPrincipal User user) {
        Role role = roleRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("角色不存在: " + id));
        if (!isSuperAdmin(user) && !user.getId().equals(role.getCreatedBy())) {
            throw new RuntimeException("无权查看此角色");
        }
        return ApiResponse.ok(role);
    }

    @PostMapping
    public ApiResponse<Role> create(@RequestBody Role role, @AuthenticationPrincipal User user) {
        String slug = role.getSlug();
        if (slug == null || slug.isBlank()) {
            throw new RuntimeException("角色标识不能为空");
        }
        if (RESERVED_SLUGS.contains(slug)) {
            throw new RuntimeException("角色标识 " + slug + " 为系统保留，不可使用");
        }

        if (!isSuperAdmin(user)) {
            role.setScope("APPLICATION");
        }

        if ("PLATFORM".equals(role.getScope())) {
            if (roleRepository.findBySlug(slug).isPresent()) {
                throw new RuntimeException("平台角色标识 " + slug + " 已存在");
            }
        } else {
            if (role.getApplicationId() == null) {
                throw new RuntimeException("应用角色必须指定应用");
            }
            if (roleRepository.findBySlugAndApplicationId(slug, role.getApplicationId()).isPresent()) {
                throw new RuntimeException("该应用下角色标识 " + slug + " 已存在");
            }
        }

        role.setCreatedBy(user.getId());
        return ApiResponse.ok(roleRepository.save(role));
    }

    @PutMapping("/{id}")
    public ApiResponse<Role> update(@PathVariable Long id, @RequestBody Role role,
                                    @AuthenticationPrincipal User user) {
        Role existing = roleRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("角色不存在: " + id));
        checkOwnership(existing, user);
        if (role.getName() != null) existing.setName(role.getName());
        if (role.getDescription() != null) existing.setDescription(role.getDescription());
        return ApiResponse.ok(roleRepository.save(existing));
    }

    @DeleteMapping("/{id}")
    @Transactional
    public ApiResponse<Void> delete(@PathVariable Long id, @AuthenticationPrincipal User user) {
        Role role = roleRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("角色不存在: " + id));
        if (SUPER_ADMIN_SLUG.equals(role.getSlug())) {
            throw new RuntimeException("系统内置角色不可删除");
        }
        checkOwnership(role, user);
        rolePermissionRepository.deleteByRoleId(id);
        roleUserRepository.deleteByRoleId(id);
        roleRepository.deleteById(id);
        return ApiResponse.ok(null);
    }

    @GetMapping("/{id}/permissions")
    public ApiResponse<List<String>> getPermissions(@PathVariable Long id,
                                                     @AuthenticationPrincipal User user) {
        Role role = roleRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("角色不存在: " + id));
        checkOwnership(role, user);
        List<String> perms = rolePermissionRepository.findByRoleId(id)
                .stream()
                .map(RolePermission::getPermission)
                .toList();
        return ApiResponse.ok(perms);
    }

    @PutMapping("/{id}/permissions")
    @Transactional
    public ApiResponse<Void> updatePermissions(@PathVariable Long id, @RequestBody Map<String, List<String>> body,
                                               @AuthenticationPrincipal User user) {
        Role role = roleRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("角色不存在: " + id));
        checkOwnership(role, user);
        List<String> perms = body.get("permissions");
        rolePermissionRepository.deleteByRoleId(id);
        rolePermissionRepository.flush();
        if (perms != null && !perms.isEmpty()) {
            List<RolePermission> entities = perms.stream()
                    .map(p -> new RolePermission(id, p))
                    .toList();
            rolePermissionRepository.saveAll(entities);
        }
        return ApiResponse.ok(null);
    }

    @GetMapping("/{id}/users")
    public ApiResponse<List<Long>> getUsers(@PathVariable Long id, @AuthenticationPrincipal User user) {
        Role role = roleRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("角色不存在: " + id));
        checkOwnership(role, user);
        List<Long> userIds = roleUserRepository.findByRoleId(id).stream()
                .map(RoleUser::getUserId)
                .toList();
        return ApiResponse.ok(userIds);
    }

    @PutMapping("/{id}/users")
    @Transactional
    public ApiResponse<Void> updateUsers(@PathVariable Long id, @RequestBody Map<String, List<Long>> body,
                                         @AuthenticationPrincipal User user) {
        Role role = roleRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("角色不存在: " + id));
        checkOwnership(role, user);
        List<Long> userIds = body.get("userIds");

        roleUserRepository.deleteByRoleId(id);
        roleUserRepository.flush();
        if (userIds != null && !userIds.isEmpty()) {
            List<RoleUser> entities = userIds.stream()
                    .map(uid -> new RoleUser(id, uid))
                    .toList();
            roleUserRepository.saveAll(entities);
        }
        return ApiResponse.ok(null);
    }

    @GetMapping("/{id}/concept-permissions")
    public ApiResponse<Map<String, Object>> getConceptPermissions(@PathVariable Long id,
            @AuthenticationPrincipal User user) {
        Role role = roleRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("角色不存在: " + id));
        checkOwnership(role, user);
        List<RoleConceptPermission> perms = roleConceptPermissionService.listByRole(id);
        List<Map<String, Object>> groups = perms.stream()
                .map(p -> {
                    Map<String, Object> m = new HashMap<>();
                    m.put("groupId", p.getGroupId());
                    return m;
                })
                .collect(Collectors.toList());
        return ApiResponse.ok(Map.of("groups", groups));
    }

    @PutMapping("/{id}/concept-permissions")
    @Transactional
    public ApiResponse<Void> updateConceptPermissions(@PathVariable Long id,
            @RequestBody Map<String, List<Long>> body,
            @AuthenticationPrincipal User user) {
        Role role = roleRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("角色不存在: " + id));
        checkOwnership(role, user);
        List<Long> groupIds = body.get("groupIds");
        roleConceptPermissionService.replaceByRole(id, groupIds);
        return ApiResponse.ok(null);
    }

    private void checkOwnership(Role role, User user) {
        if ("PLATFORM".equals(role.getScope())) {
            if (!isSuperAdmin(user)) {
                throw new RuntimeException("无权操作此角色");
            }
        } else {
            if (!user.getId().equals(role.getCreatedBy())) {
                throw new RuntimeException("无权操作此角色");
            }
        }
    }
}