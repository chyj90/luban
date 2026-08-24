package com.luban.controller;

import com.luban.constant.Permissions;
import com.luban.dto.*;
import com.luban.entity.User;
import com.luban.repository.UserSessionRepository;
import com.luban.service.AuthService;
import com.luban.workflow.entity.RolePermission;
import com.luban.workflow.entity.RoleUser;
import com.luban.workflow.repository.RolePermissionRepository;
import com.luban.workflow.repository.RoleRepository;
import com.luban.workflow.repository.RoleUserRepository;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@RestController
@RequestMapping("/api/v1")
public class AuthController {

    private final AuthService authService;
    private final UserSessionRepository userSessionRepository;
    private final RoleUserRepository roleUserRepository;
    private final RolePermissionRepository rolePermissionRepository;
    private final RoleRepository roleRepository;

    public AuthController(AuthService authService,
                          UserSessionRepository userSessionRepository,
                          RoleUserRepository roleUserRepository,
                          RolePermissionRepository rolePermissionRepository,
                          RoleRepository roleRepository) {
        this.authService = authService;
        this.userSessionRepository = userSessionRepository;
        this.roleUserRepository = roleUserRepository;
        this.rolePermissionRepository = rolePermissionRepository;
        this.roleRepository = roleRepository;
    }

    @PostMapping("/auth/register")
    public ResponseEntity<ApiResponse<AuthResponse>> register(@Valid @RequestBody RegisterRequest request) {
        AuthResponse resp = authService.register(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(resp));
    }

    @PostMapping("/auth/login")
    public ResponseEntity<ApiResponse<AuthResponse>> login(@Valid @RequestBody LoginRequest request) {
        AuthResponse resp = authService.login(request);
        return ResponseEntity.ok(ApiResponse.ok(resp));
    }

    @PostMapping("/auth/logout")
    public ResponseEntity<ApiResponse<Void>> logout(@AuthenticationPrincipal User user) {
        if (user != null) {
            userSessionRepository.deleteByUserId(user.getId());
        }
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @GetMapping("/users/me")
    public ResponseEntity<ApiResponse<AuthResponse.UserInfo>> me(@AuthenticationPrincipal User user) {
        boolean superAdmin = roleUserRepository.findByUserId(user.getId()).stream()
                .map(RoleUser::getRoleId)
                .toList()
                .stream()
                .anyMatch(roleId -> {
                    var role = roleRepository.findById(roleId).orElse(null);
                    return role != null && "super_admin".equals(role.getSlug());
                });
        return ResponseEntity.ok(ApiResponse.ok(
                new AuthResponse.UserInfo(user.getId(), user.getEmail(), user.getAccount(), superAdmin)));
    }

    @GetMapping("/permissions")
    public ResponseEntity<ApiResponse<List<Permissions.Def>>> listPermissions() {
        return ResponseEntity.ok(ApiResponse.ok(Permissions.ALL));
    }

    @GetMapping("/auth/permissions")
    public ResponseEntity<ApiResponse<List<String>>> myPermissions(@AuthenticationPrincipal User user) {
        if (user == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "未登录或 Token 已过期");
        }
        List<Long> roleIds = roleUserRepository.findByUserId(user.getId()).stream()
                .map(RoleUser::getRoleId)
                .toList();
        if (roleIds.isEmpty()) {
            return ResponseEntity.ok(ApiResponse.ok(List.of()));
        }
        List<String> permissions = rolePermissionRepository.findByRoleIdIn(roleIds).stream()
                .map(RolePermission::getPermission)
                .distinct()
                .sorted()
                .toList();
        return ResponseEntity.ok(ApiResponse.ok(permissions));
    }
}