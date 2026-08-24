package com.luban.security;

import com.luban.entity.ApiKey;
import com.luban.repository.ApiKeyRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Optional;

/**
 * API Key 鉴权过滤器。
 * 从请求头 X-API-Key 提取 KEY，校验有效性后注入认证上下文。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ApiKeyAuthFilter extends OncePerRequestFilter {

    private static final String API_KEY_HEADER = "X-API-Key";
    private static final String API_KEY_ATTR = "api_key_id";

    private final ApiKeyRepository apiKeyRepository;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String apiKey = request.getHeader(API_KEY_HEADER);

        if (apiKey == null || apiKey.isBlank()) {
            filterChain.doFilter(request, response);
            return;
        }

        String keyPrefix = apiKey.length() > 8 ? apiKey.substring(0, 8) : apiKey;
        Optional<ApiKey> keyOpt = apiKeyRepository.findByKeyPrefix(keyPrefix);

        if (keyOpt.isEmpty() || !"ACTIVE".equals(keyOpt.get().getStatus())) {
            log.warn("Invalid or inactive API Key: {}", keyPrefix);
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.getWriter().write("{\"success\":false,\"message\":\"Invalid API Key\"}");
            response.setContentType("application/json");
            return;
        }

        ApiKey key = keyOpt.get();
        request.setAttribute(API_KEY_ATTR, key.getId());

        UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                "api-key:" + key.getId(), null,
                List.of(new SimpleGrantedAuthority("ROLE_API_KEY")));
        SecurityContextHolder.getContext().setAuthentication(auth);

        filterChain.doFilter(request, response);
    }
}