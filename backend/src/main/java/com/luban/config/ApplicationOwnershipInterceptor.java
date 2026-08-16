package com.luban.config;

import com.luban.entity.Application;
import com.luban.entity.User;
import com.luban.repository.ApplicationRepository;
import com.luban.security.ImpersonationFilter;
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
        if (auth == null || !(auth.getPrincipal() instanceof User)) {
            response.setStatus(403);
            return false;
        }

        // 模拟场景下，使用原始用户做所有权校验，而非被模拟用户
        User effectiveUser = (User) request.getAttribute(ImpersonationFilter.ORIGINAL_USER_ATTRIBUTE);
        if (effectiveUser == null) {
            effectiveUser = (User) auth.getPrincipal();
        }

        Application app = applicationRepository.findById(applicationId).orElse(null);
        if (app == null) {
            response.setStatus(404);
            return false;
        }

        if (!app.getCreatedBy().equals(effectiveUser.getId())) {
            response.setStatus(403);
            return false;
        }

        return true;
    }
}