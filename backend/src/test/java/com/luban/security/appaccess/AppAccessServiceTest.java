package com.luban.security.appaccess;

import com.luban.entity.Application;
import com.luban.repository.ApplicationRepository;
import com.luban.workflow.entity.Role;
import com.luban.workflow.entity.RolePermission;
import com.luban.workflow.entity.RoleUser;
import com.luban.workflow.repository.RolePermissionRepository;
import com.luban.workflow.repository.RoleRepository;
import com.luban.workflow.repository.RoleUserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * 应用访问判定矩阵测试：owner / 平台超管 / 应用角色权限 / 非成员 的全组合。
 */
@ExtendWith(MockitoExtension.class)
class AppAccessServiceTest {

    private static final Long APP_ID = 10L;
    private static final Long OWNER_ID = 1L;
    private static final Long SUPER_ADMIN_ID = 2L;
    private static final Long DEVELOPER_ID = 3L;
    private static final Long MEMBER_ID = 4L;
    private static final Long OUTSIDER_ID = 5L;

    @Mock private ApplicationRepository applicationRepository;
    @Mock private RoleRepository roleRepository;
    @Mock private RoleUserRepository roleUserRepository;
    @Mock private RolePermissionRepository rolePermissionRepository;
    @Mock private com.luban.repository.RoleConceptPermissionRepository roleConceptPermissionRepository;
    @Mock private com.luban.repository.ConceptRepository conceptRepository;

    private AppAccessService service;

    private final Role superAdminRole = platformRole(100L, "super_admin");
    private final Role appDeveloperRole = appRole(200L);
    private final Role appMemberRole = appRole(201L);

    @BeforeEach
    void setUp() {
        // RoleConceptPermissionService 在 JDK25 下无法被 Mockito mock（具体类），用真实实例配 mock 仓库；
        // roleUserRepository 默认返回空列表 → isSuperAdmin=false，与原测试行为一致
        com.luban.service.RoleConceptPermissionService roleConceptPermissionService =
                new com.luban.service.RoleConceptPermissionService(
                        roleConceptPermissionRepository, conceptRepository, roleUserRepository, roleRepository);
        service = new AppAccessService(applicationRepository, roleRepository, roleUserRepository, rolePermissionRepository, roleConceptPermissionService);

        Application app = new Application();
        app.setCreatedBy(OWNER_ID);
        lenient().when(applicationRepository.findById(APP_ID)).thenReturn(Optional.of(app));

        lenient().when(roleRepository.findByApplicationId(APP_ID))
                .thenReturn(List.of(appDeveloperRole, appMemberRole));
        lenient().when(roleRepository.findAllById(any())).thenAnswer(inv -> {
            List<Long> ids = inv.getArgument(0);
            if (ids == null) return List.of();
            return List.of(superAdminRole, appDeveloperRole, appMemberRole).stream()
                    .filter(r -> ids.contains(r.getId())).toList();
        });
    }

    private Role platformRole(Long id, String slug) {
        Role r = new Role();
        r.setId(id);
        r.setSlug(slug);
        return r;
    }

    private Role appRole(Long id) {
        Role r = new Role();
        r.setId(id);
        r.setApplicationId(APP_ID);
        return r;
    }

    private void grantUserRoles(Long userId, List<Role> roles) {
        lenient().when(roleUserRepository.findByUserId(userId)).thenReturn(
                roles.stream().map(r -> new RoleUser(r.getId(), userId)).toList());
    }

    private void stubRolePermissions(Long roleId, List<String> perms) {
        lenient().when(rolePermissionRepository.findByRoleIdIn(anyList()))
                .thenAnswer(inv -> {
                    List<Long> ids = inv.getArgument(0);
                    if (!ids.contains(roleId)) return List.of();
                    return perms.stream().map(p -> new RolePermission(roleId, p)).toList();
                });
    }

    private void stubSuperAdmin() {
        grantUserRoles(SUPER_ADMIN_ID, List.of(superAdminRole));
        stubRolePermissions(superAdminRole.getId(), List.of());
    }

    @Test
    void ownerPassesAllActions() {
        for (AppAction action : AppAction.values()) {
            assertThatCode(() -> service.assertAccess(OWNER_ID, APP_ID, action)).doesNotThrowAnyException();
        }
    }

    @Test
    void superAdminPassesAllActions() {
        stubSuperAdmin();
        for (AppAction action : AppAction.values()) {
            assertThatCode(() -> service.assertAccess(SUPER_ADMIN_ID, APP_ID, action)).doesNotThrowAnyException();
        }
    }

    @Test
    void developerRoleCanDevelopButNotManage() {
        grantUserRoles(DEVELOPER_ID, List.of(appDeveloperRole));
        stubRolePermissions(appDeveloperRole.getId(), List.of(AppAccessService.PERM_APP_DEVELOP, "app:page:99"));

        assertThatCode(() -> service.assertAccess(DEVELOPER_ID, APP_ID, AppAction.VIEW)).doesNotThrowAnyException();
        assertThatCode(() -> service.assertAccess(DEVELOPER_ID, APP_ID, AppAction.RUN)).doesNotThrowAnyException();
        assertThatCode(() -> service.assertAccess(DEVELOPER_ID, APP_ID, AppAction.DEVELOP)).doesNotThrowAnyException();
        assertThatThrownBy(() -> service.assertAccess(DEVELOPER_ID, APP_ID, AppAction.MANAGE))
                .isInstanceOf(AppAccessService.AppAccessDeniedException.class);
    }

    @Test
    void manageRoleImpliesDevelop() {
        grantUserRoles(DEVELOPER_ID, List.of(appDeveloperRole));
        stubRolePermissions(appDeveloperRole.getId(), List.of(AppAccessService.PERM_APP_MANAGE));

        assertThatCode(() -> service.assertAccess(DEVELOPER_ID, APP_ID, AppAction.MANAGE)).doesNotThrowAnyException();
        assertThatCode(() -> service.assertAccess(DEVELOPER_ID, APP_ID, AppAction.DEVELOP)).doesNotThrowAnyException();
    }

    @Test
    void plainMemberCanRunButNotDevelop() {
        grantUserRoles(MEMBER_ID, List.of(appMemberRole));
        stubRolePermissions(appMemberRole.getId(), List.of());

        assertThatCode(() -> service.assertAccess(MEMBER_ID, APP_ID, AppAction.RUN)).doesNotThrowAnyException();
        assertThatThrownBy(() -> service.assertAccess(MEMBER_ID, APP_ID, AppAction.DEVELOP))
                .isInstanceOf(AppAccessService.AppAccessDeniedException.class);
        assertThatThrownBy(() -> service.assertAccess(MEMBER_ID, APP_ID, AppAction.MANAGE))
                .isInstanceOf(AppAccessService.AppAccessDeniedException.class);
    }

    @Test
    void outsiderDeniedEverything() {
        grantUserRoles(OUTSIDER_ID, List.of());
        for (AppAction action : AppAction.values()) {
            assertThatThrownBy(() -> service.assertAccess(OUTSIDER_ID, APP_ID, action))
                    .isInstanceOf(AppAccessService.AppAccessDeniedException.class);
        }
    }

    @Test
    void platformRoleAloneGrantsNoAppAccess() {
        // 持平台角色（super_admin 以外）但无应用角色 → 不得访问应用（平台角色不赋予应用访问权）
        Role platformEditor = platformRole(300L, "platform_editor");
        when(roleRepository.findByApplicationId(APP_ID)).thenReturn(List.of(appDeveloperRole));
        grantUserRoles(OUTSIDER_ID, List.of(platformEditor));
        stubRolePermissions(platformEditor.getId(), List.of(AppAccessService.PERM_APP_DEVELOP));

        assertThatThrownBy(() -> service.assertAccess(OUTSIDER_ID, APP_ID, AppAction.DEVELOP))
                .isInstanceOf(AppAccessService.AppAccessDeniedException.class);
    }

    @Test
    void missingAppTreatedAsNotFound() {
        when(applicationRepository.findById(999L)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.assertAccess(OUTSIDER_ID, 999L, AppAction.VIEW))
                .isInstanceOf(AppAccessService.AppAccessDeniedException.class)
                .hasFieldOrPropertyWithValue("status", 404);
    }

    @Test
    void platformPermissionCheck() {
        Role platformOps = platformRole(400L, "platform_ops");
        when(roleRepository.findAllById(any())).thenAnswer(inv -> {
            List<Long> ids = inv.getArgument(0);
            if (ids == null) return List.of();
            return List.of(superAdminRole, platformOps).stream()
                    .filter(r -> ids.contains(r.getId())).toList();
        });
        grantUserRoles(DEVELOPER_ID, List.of(platformOps));
        stubRolePermissions(platformOps.getId(), List.of("connect:systems"));
        // 持 connect:systems → 放行
        assertThatCode(() -> service.assertPlatformPermission(DEVELOPER_ID, "connect:systems")).doesNotThrowAnyException();
        // 未持该权限 → 拒绝
        assertThatThrownBy(() -> service.assertPlatformPermission(DEVELOPER_ID, "connect:tools"))
                .isInstanceOf(AppAccessService.AppAccessDeniedException.class);
        // super_admin → 放行
        stubSuperAdmin();
        assertThatCode(() -> service.assertPlatformPermission(SUPER_ADMIN_ID, "connect:tools")).doesNotThrowAnyException();
    }

    @Test
    void pageAccessMatrix() {
        // 开发者无需逐页授权即可访问页面
        grantUserRoles(DEVELOPER_ID, List.of(appDeveloperRole));
        stubRolePermissions(appDeveloperRole.getId(), List.of(AppAccessService.PERM_APP_DEVELOP));
        assertThatCode(() -> service.assertPageAccess(DEVELOPER_ID, APP_ID, 99L)).doesNotThrowAnyException();

        // 运行成员必须持有 app:page:{pageId} 授权
        grantUserRoles(MEMBER_ID, List.of(appMemberRole));
        stubRolePermissions(appMemberRole.getId(), List.of("app:page:99"));
        assertThatCode(() -> service.assertPageAccess(MEMBER_ID, APP_ID, 99L)).doesNotThrowAnyException();
        assertThatThrownBy(() -> service.assertPageAccess(MEMBER_ID, APP_ID, 100L))
                .isInstanceOf(AppAccessService.AppAccessDeniedException.class);

        // 非成员一律拒绝
        grantUserRoles(OUTSIDER_ID, List.of());
        assertThatThrownBy(() -> service.assertPageAccess(OUTSIDER_ID, APP_ID, 99L))
                .isInstanceOf(AppAccessService.AppAccessDeniedException.class);
    }

}
