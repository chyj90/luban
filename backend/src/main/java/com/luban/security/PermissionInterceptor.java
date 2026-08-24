package com.luban.security;

import com.luban.annotation.RequirePermission;
import com.luban.entity.User;
import com.luban.workflow.entity.RolePermission;
import com.luban.workflow.entity.RoleUser;
import com.luban.workflow.repository.RolePermissionRepository;
import com.luban.workflow.repository.RoleUserRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Component
public class PermissionInterceptor implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(PermissionInterceptor.class);

    private final RoleUserRepository roleUserRepository;
    private final RolePermissionRepository rolePermissionRepository;

    public PermissionInterceptor(RoleUserRepository roleUserRepository,
                                  RolePermissionRepository rolePermissionRepository) {
        this.roleUserRepository = roleUserRepository;
        this.rolePermissionRepository = rolePermissionRepository;
    }

    @Override
    public boolean preHandle(HttpServletRequest request,
                             HttpServletResponse response,
                             Object handler) throws Exception {
        if (!(handler instanceof HandlerMethod handlerMethod)) {
            return true;
        }

        RequirePermission annotation = handlerMethod.getMethodAnnotation(RequirePermission.class);
        if (annotation == null) {
            annotation = handlerMethod.getBeanType().getAnnotation(RequirePermission.class);
        }

        if (annotation == null) {
            return true;
        }

        String requiredPermission = annotation.value();
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof User user)) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "未登录");
            return false;
        }

        Set<String> userPermissions = getUserPermissions(user.getId());
        if (userPermissions.contains(requiredPermission)) {
            return true;
        }

        log.warn("权限不足: userId={}, required={}, has={}", user.getId(), requiredPermission, userPermissions);
        response.sendError(HttpServletResponse.SC_FORBIDDEN, "权限不足: " + requiredPermission);
        return false;
    }

    private Set<String> getUserPermissions(Long userId) {
        List<Long> roleIds = roleUserRepository.findByUserId(userId).stream()
                .map(RoleUser::getRoleId)
                .toList();
        if (roleIds.isEmpty()) {
            return Set.of();
        }
        return rolePermissionRepository.findByRoleIdIn(roleIds).stream()
                .map(RolePermission::getPermission)
                .collect(Collectors.toSet());
    }
}