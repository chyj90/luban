package com.luban.controller;

import com.luban.dto.*;
import com.luban.entity.Application;
import com.luban.entity.Page;
import com.luban.entity.User;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.PageRepository;
import com.luban.service.PageService;
import com.luban.workflow.entity.Role;
import com.luban.workflow.entity.RoleUser;
import com.luban.workflow.repository.RoleRepository;
import com.luban.workflow.repository.RoleUserRepository;
import com.luban.workflow.repository.RolePermissionRepository;
import com.luban.workflow.entity.RolePermission;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/pages")
public class PageController {

    private final PageService pageService;
    private final PageRepository pageRepository;
    private final ApplicationRepository applicationRepository;
    private final RoleRepository roleRepository;
    private final RoleUserRepository roleUserRepository;
    private final RolePermissionRepository rolePermissionRepository;

    public PageController(PageService pageService,
                          PageRepository pageRepository,
                          ApplicationRepository applicationRepository,
                          RoleRepository roleRepository,
                          RoleUserRepository roleUserRepository,
                          RolePermissionRepository rolePermissionRepository) {
        this.pageService = pageService;
        this.pageRepository = pageRepository;
        this.applicationRepository = applicationRepository;
        this.roleRepository = roleRepository;
        this.roleUserRepository = roleUserRepository;
        this.rolePermissionRepository = rolePermissionRepository;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> list(
            @RequestParam Long applicationId,
            @AuthenticationPrincipal User user) {
        List<Map<String, Object>> pages = pageService.listByApplication(applicationId);

        // 获取用户在该应用的角色权限，标记 accessible
        List<Role> appRoles = roleRepository.findByApplicationId(applicationId);
        List<Long> appRoleIds = appRoles.stream().map(Role::getId).toList();
        List<RoleUser> userRoles = roleUserRepository.findByUserId(user.getId());
        List<Long> userRoleIds = userRoles.stream()
                .map(RoleUser::getRoleId)
                .filter(appRoleIds::contains)
                .toList();

        Set<String> pagePermissions = rolePermissionRepository.findByRoleIdIn(userRoleIds).stream()
                .map(RolePermission::getPermission)
                .filter(p -> p.startsWith("app:page:"))
                .collect(Collectors.toSet());

        for (Map<String, Object> page : pages) {
            Long pageId = (Long) page.get("id");
            String permKey = "app:page:" + pageId;
            boolean accessible = pagePermissions.contains(permKey);
            // 如果用户没有任何角色权限，默认全部可访问（兼容旧逻辑：无角色设置时所有页面可见）
            if (pagePermissions.isEmpty()) {
                accessible = true;
            }
            page.put("accessible", accessible);
        }

        return ResponseEntity.ok(ApiResponse.ok(pages));
    }

    private void checkPageOwnership(Long pageId, User user) {
        Page page = pageRepository.findById(pageId)
                .orElseThrow(() -> new IllegalArgumentException("页面不存在"));
        Application app = applicationRepository.findById(page.getApplicationId())
                .orElseThrow(() -> new IllegalArgumentException("应用不存在"));
        if (!app.getCreatedBy().equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "无权操作此页面");
        }
    }

    private void checkAppOwnership(Long applicationId, User user) {
        Application app = applicationRepository.findById(applicationId)
                .orElseThrow(() -> new IllegalArgumentException("应用不存在"));
        if (!app.getCreatedBy().equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "无权操作此应用");
        }
    }

    @PostMapping("/code")
    public ResponseEntity<ApiResponse<Map<String, Object>>> createCodePage(
            @Valid @RequestBody CreateCodePageRequest request,
            @AuthenticationPrincipal User user) {
        checkAppOwnership(request.getApplicationId(), user);
        Map<String, Object> page = pageService.createCodePage(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(page));
    }

    @GetMapping("/{id}/code")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getCodePage(@PathVariable Long id,
                                                                         @AuthenticationPrincipal User user) {
        checkPageOwnership(id, user);
        return ResponseEntity.ok(ApiResponse.ok(pageService.getCodePage(id)));
    }

    @PutMapping("/{id}/code")
    public ResponseEntity<ApiResponse<Map<String, Object>>> updateCodePage(
            @PathVariable Long id, @RequestBody UpdateCodePageRequest request,
            @AuthenticationPrincipal User user) {
        checkPageOwnership(id, user);
        return ResponseEntity.ok(ApiResponse.ok(pageService.updateCodePage(id, request)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> rename(
            @PathVariable Long id, @RequestBody Map<String, String> body,
            @AuthenticationPrincipal User user) {
        checkPageOwnership(id, user);
        String name = body.get("name");
        return ResponseEntity.ok(ApiResponse.ok(pageService.renamePage(id, name)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id,
                                                     @AuthenticationPrincipal User user) {
        checkPageOwnership(id, user);
        pageService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}