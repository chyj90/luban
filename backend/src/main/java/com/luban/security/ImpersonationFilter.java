package com.luban.security;

import com.luban.entity.Application;
import com.luban.entity.User;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.UserRepository;
import com.luban.workflow.entity.Member;
import com.luban.workflow.repository.MemberRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Collections;

public class ImpersonationFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(ImpersonationFilter.class);
    private static final String HEADER_IMPERSONATE = "X-Impersonate-User-Id";
    private static final String HEADER_IMPERSONATE_APP = "X-Impersonate-Application-Id";
    public static final String ORIGINAL_USER_ATTRIBUTE = "ORIGINAL_USER";

    private final ApplicationRepository applicationRepository;
    private final UserRepository userRepository;
    private final MemberRepository memberRepository;

    public ImpersonationFilter(ApplicationRepository applicationRepository,
                               UserRepository userRepository,
                               MemberRepository memberRepository) {
        this.applicationRepository = applicationRepository;
        this.userRepository = userRepository;
        this.memberRepository = memberRepository;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {

        String impersonateUserId = request.getHeader(HEADER_IMPERSONATE);
        String impersonateAppId = request.getHeader(HEADER_IMPERSONATE_APP);
        String path = request.getRequestURI();

        log.debug("ImpersonationFilter 进入, path={}, impersonateUserId={}, impersonateAppId={}",
                path, impersonateUserId, impersonateAppId);

        if (impersonateUserId == null || impersonateAppId == null) {
            log.debug("ImpersonationFilter 跳过: 无模拟头, path={}", path);
            filterChain.doFilter(request, response);
            return;
        }

        var auth = SecurityContextHolder.getContext().getAuthentication();
        log.debug("ImpersonationFilter auth={}, principalClass={}, path={}",
                auth != null ? "存在" : "NULL",
                auth != null ? auth.getPrincipal().getClass().getSimpleName() : "N/A",
                path);

        if (auth == null) {
            log.debug("ImpersonationFilter 跳过: auth为null, path={}", path);
            filterChain.doFilter(request, response);
            return;
        }
        if (!(auth.getPrincipal() instanceof User currentUser)) {
            log.warn("模拟请求被拒绝: 未认证的用户, principal={}, path={}", auth.getPrincipal(), path);
            response.sendError(HttpServletResponse.SC_FORBIDDEN, "模拟请求需要先登录");
            return;
        }

        log.debug("ImpersonationFilter 当前用户: id={}, account={}, path={}", currentUser.getId(), currentUser.getAccount(), path);

        Long appId;
        Long targetUserId;
        try {
            appId = Long.valueOf(impersonateAppId);
            targetUserId = Long.valueOf(impersonateUserId);
        } catch (NumberFormatException e) {
            log.warn("模拟请求被拒绝: 参数格式错误");
            response.sendError(HttpServletResponse.SC_BAD_REQUEST, "模拟参数格式错误");
            return;
        }

        Application app = applicationRepository.findById(appId).orElse(null);
        if (app == null) {
            log.warn("模拟请求被拒绝: 应用不存在, appId={}", appId);
            response.sendError(HttpServletResponse.SC_NOT_FOUND, "应用不存在");
            return;
        }

        log.debug("ImpersonationFilter 应用: id={}, createdBy={}, 当前用户id={}, path={}",
                app.getId(), app.getCreatedBy(), currentUser.getId(), path);

        if (!app.getCreatedBy().equals(currentUser.getId())) {
            log.warn("模拟请求被拒绝: 非应用创建者, userId={}, appCreatedBy={}, appId={}",
                    currentUser.getId(), app.getCreatedBy(), appId);
            response.sendError(HttpServletResponse.SC_FORBIDDEN, "只有应用创建者才能模拟用户");
            return;
        }

        Member member = memberRepository.findById(targetUserId).orElse(null);
        if (member == null) {
            log.warn("模拟请求被拒绝: 目标成员不存在, memberId={}", targetUserId);
            response.sendError(HttpServletResponse.SC_NOT_FOUND, "目标成员不存在");
            return;
        }

        log.debug("ImpersonationFilter 目标成员: id={}, name={}, userId={}",
                member.getId(), member.getName(), member.getUserId());

        User targetUser = member.getUserId() != null
                ? userRepository.findById(member.getUserId()).orElse(null)
                : null;
        if (targetUser == null) {
            targetUser = new User();
            targetUser.setId(member.getUserId() != null ? member.getUserId() : member.getId());
            targetUser.setAccount(member.getName());
            targetUser.setEmail(member.getEmail() != null ? member.getEmail() : "");
            targetUser.setPassword("");
        }

        UsernamePasswordAuthenticationToken impersonatedAuth =
                new UsernamePasswordAuthenticationToken(targetUser, null, Collections.emptyList());
        request.setAttribute(ORIGINAL_USER_ATTRIBUTE, currentUser);
        SecurityContextHolder.getContext().setAuthentication(impersonatedAuth);

        log.debug("模拟用户成功: {} -> {}, appId={}, path={}",
                currentUser.getId(), targetUserId, appId, request.getRequestURI());

        filterChain.doFilter(request, response);

        log.debug("ImpersonationFilter 响应: status={}, path={}", response.getStatus(), request.getRequestURI());
    }
}