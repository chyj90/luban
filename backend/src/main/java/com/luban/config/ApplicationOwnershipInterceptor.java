package com.luban.config;

import com.luban.entity.Application;
import com.luban.entity.User;
import com.luban.entity.Workspace;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.WorkspaceRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
@RequiredArgsConstructor
public class ApplicationOwnershipInterceptor implements HandlerInterceptor {

    private final ApplicationRepository applicationRepository;
    private final WorkspaceRepository workspaceRepository;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String appIdParam = request.getParameter("applicationId");
        if (appIdParam == null || appIdParam.isEmpty()) {
            return true;
        }

        Long applicationId;
        try {
            applicationId = Long.valueOf(appIdParam);
        } catch (NumberFormatException e) {
            return true;
        }

        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof User user)) {
            response.setStatus(403);
            return false;
        }

        Application app = applicationRepository.findById(applicationId).orElse(null);
        if (app == null) {
            response.setStatus(404);
            return false;
        }

        Workspace workspace = workspaceRepository.findById(app.getWorkspaceId()).orElse(null);
        if (workspace == null || !workspace.getOwnerId().equals(user.getId())) {
            response.setStatus(403);
            return false;
        }

        return true;
    }
}