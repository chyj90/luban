package com.luban.security.appaccess;

import com.luban.entity.Application;
import com.luban.repository.ApplicationRepository;
import com.luban.workflow.entity.Role;
import com.luban.workflow.repository.RolePermissionRepository;
import com.luban.workflow.repository.RoleRepository;
import com.luban.workflow.repository.RoleUserRepository;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 应用访问判定的唯一实现（单一真相源）。
 *
 * 判定矩阵（从高到低短路）：
 * 1. super_admin 角色 → 全部动作放行
 * 2. 应用 owner（Application.createdBy）→ 全部动作放行
 * 3. 应用角色（Role.applicationId = appId）所持权限：
 *    - 持 app:manage → MANAGE 及以下
 *    - 持 app:develop → DEVELOP 及以下
 *    - 是应用任意角色成员 → RUN 及以下（成员即用户）
 * 4. 其余一律拒绝（默认拒绝）
 *
 * 页面级细粒度权限（app:page:{pageId}）沿用既有约定，见 assertPageAccess。
 */
@Service
public class AppAccessService {

    public static final String PERM_APP_DEVELOP = "app:develop";
    public static final String PERM_APP_MANAGE = "app:manage";

    private final ApplicationRepository applicationRepository;
    private final RoleRepository roleRepository;
    private final RoleUserRepository roleUserRepository;
    private final RolePermissionRepository rolePermissionRepository;

    public AppAccessService(ApplicationRepository applicationRepository,
                            RoleRepository roleRepository,
                            RoleUserRepository roleUserRepository,
                            RolePermissionRepository rolePermissionRepository) {
        this.applicationRepository = applicationRepository;
        this.roleRepository = roleRepository;
        this.roleUserRepository = roleUserRepository;
        this.rolePermissionRepository = rolePermissionRepository;
    }

    /** 判定入口：不满足时抛 AppAccessDeniedException（由全局异常处理转 403） */
    public void assertAccess(Long userId, Long applicationId, AppAction action) {
        Application app = applicationRepository.findById(applicationId)
                .orElseThrow(() -> new AppAccessDeniedException("应用不存在", 404));
        if (isSuperAdmin(userId)) return;
        if (app.getCreatedBy() != null && app.getCreatedBy().equals(userId)) return;

        // 成员资格与权限行分开判定：角色成员即用户（RUN），开发/管理需要显式权限行
        List<Long> userAppRoleIds = userAppRoleIds(userId, applicationId);
        Set<String> perms = permissionsOf(userAppRoleIds);
        switch (action) {
            case MANAGE:
                if (!perms.contains(PERM_APP_MANAGE)) throw denied(action);
                return;
            case DEVELOP:
                if (!perms.contains(PERM_APP_DEVELOP) && !perms.contains(PERM_APP_MANAGE)) throw denied(action);
                return;
            case RUN:
            case VIEW:
                if (userAppRoleIds.isEmpty()) throw denied(action);
                return;
            default:
                throw denied(action);
        }
    }

    /**
     * 页面访问：开发权（owner/develop/manage）直接放行；运行态走页面级授权
     * app:page:{pageId}（沿用既有约定，由应用角色承载）。
     */
    public void assertPageAccess(Long userId, Long applicationId, Long pageId) {
        Application app = applicationRepository.findById(applicationId)
                .orElseThrow(() -> new AppAccessDeniedException("应用不存在", 404));
        if (isSuperAdmin(userId)) return;
        if (app.getCreatedBy() != null && app.getCreatedBy().equals(userId)) return;

        Set<String> perms = appPermissionKeys(userId, applicationId);
        if (perms.contains(PERM_APP_DEVELOP) || perms.contains(PERM_APP_MANAGE)) return;
        if (perms.contains("app:page:" + pageId)) return;
        throw new AppAccessDeniedException("无权访问此页面", 403);
    }

    public boolean isSuperAdmin(Long userId) {
        List<Long> roleIds = roleUserRepository.findByUserId(userId).stream()
                .map(com.luban.workflow.entity.RoleUser::getRoleId)
                .toList();
        return roleRepository.findAllById(roleIds).stream()
                .anyMatch(r -> "super_admin".equals(r.getSlug()));
    }

    /** 平台级权限判定（不限应用，角色任意 scope），供创建 PLATFORM 资源等场景使用 */
    public void assertPlatformPermission(Long userId, String permission) {
        if (isSuperAdmin(userId)) return;
        List<Long> roleIds = roleUserRepository.findByUserId(userId).stream()
                .map(com.luban.workflow.entity.RoleUser::getRoleId)
                .toList();
        if (roleIds.isEmpty()) throw new AppAccessDeniedException("权限不足：" + permission, 403);
        boolean has = rolePermissionRepository.findByRoleIdIn(roleIds).stream()
                .anyMatch(rp -> permission.equals(rp.getPermission()));
        if (!has) throw new AppAccessDeniedException("权限不足：" + permission, 403);
    }

    /** 用户在该应用下的全部权限键（应用角色才计入，平台角色不赋予应用访问权） */
    private Set<String> appPermissionKeys(Long userId, Long applicationId) {
        List<Long> appRoleIds = roleRepository.findByApplicationId(applicationId).stream()
                .map(Role::getId).collect(Collectors.toList());
        if (appRoleIds.isEmpty()) return Set.of();
        List<Long> userRoleIds = roleUserRepository.findByUserId(userId).stream()
                .map(com.luban.workflow.entity.RoleUser::getRoleId)
                .filter(appRoleIds::contains)
                .toList();
        if (userRoleIds.isEmpty()) return Set.of();
        return rolePermissionRepository.findByRoleIdIn(userRoleIds).stream()
                .map(com.luban.workflow.entity.RolePermission::getPermission)
                .collect(Collectors.toSet());
    }

    /** 用户在该应用下拥有的应用角色 id 列表（成员资格判定依据） */
    private List<Long> userAppRoleIds(Long userId, Long applicationId) {
        List<Long> appRoleIds = roleRepository.findByApplicationId(applicationId).stream()
                .map(Role::getId).collect(Collectors.toList());
        if (appRoleIds.isEmpty()) return List.of();
        return roleUserRepository.findByUserId(userId).stream()
                .map(com.luban.workflow.entity.RoleUser::getRoleId)
                .filter(appRoleIds::contains)
                .toList();
    }

    private Set<String> permissionsOf(List<Long> roleIds) {
        if (roleIds.isEmpty()) return Set.of();
        return rolePermissionRepository.findByRoleIdIn(roleIds).stream()
                .map(com.luban.workflow.entity.RolePermission::getPermission)
                .collect(Collectors.toSet());
    }

    private AppAccessDeniedException denied(AppAction action) {
        return new AppAccessDeniedException("权限不足：" + action.name(), 403);
    }

    /** 携带期望 HTTP 状态的拒绝异常（403=无权，404=资源不存在避免枚举探测） */
    public static class AppAccessDeniedException extends RuntimeException {
        private final int status;
        public AppAccessDeniedException(String message, int status) {
            super(message);
            this.status = status;
        }
        public int getStatus() { return status; }
    }
}
