package com.luban.security;

import com.luban.entity.UserSession;
import com.luban.repository.UserRepository;
import com.luban.repository.UserSessionRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Collections;
import java.util.Optional;

@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(JwtAuthFilter.class);

    private final JwtTokenProvider jwtTokenProvider;
    private final UserRepository userRepository;
    private final UserSessionRepository userSessionRepository;

    public JwtAuthFilter(JwtTokenProvider jwtTokenProvider,
                         UserRepository userRepository,
                         UserSessionRepository userSessionRepository) {
        this.jwtTokenProvider = jwtTokenProvider;
        this.userRepository = userRepository;
        this.userSessionRepository = userSessionRepository;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String token = extractToken(request);
        String path = request.getRequestURI();

        if (token == null) {
            log.debug("JWT filter: 无 token, path={}", path);
            filterChain.doFilter(request, response);
            return;
        }

        if (!jwtTokenProvider.validateToken(token)) {
            log.warn("JWT filter: token 无效或已过期, path={}", path);
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Token 无效或已过期");
            return;
        }

        Optional<UserSession> sessionOpt = userSessionRepository.findByToken(token);
        if (sessionOpt.isEmpty()) {
            log.warn("JWT filter: 会话不存在, path={}", path);
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED, "会话不存在，请重新登录");
            return;
        }

        userRepository.findById(sessionOpt.get().getUserId()).ifPresent(user -> {
            log.debug("JWT filter: 认证成功, userId={}, path={}", user.getId(), path);
            UsernamePasswordAuthenticationToken auth =
                    new UsernamePasswordAuthenticationToken(user, null, Collections.emptyList());
            SecurityContextHolder.getContext().setAuthentication(auth);
        });

        filterChain.doFilter(request, response);
    }

    private String extractToken(HttpServletRequest request) {
        String bearer = request.getHeader("Authorization");
        if (StringUtils.hasText(bearer) && bearer.startsWith("Bearer ")) {
            return bearer.substring(7);
        }
        return null;
    }
}