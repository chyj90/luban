package com.luban.security;

import com.luban.entity.ApiKey;
import com.luban.repository.ApiKeyRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.Optional;

/**
 * X-API-Key 凭据校验过滤器。
 *
 * 设计约定（重要）：X-API-Key 不是免登录的 HTTP 认证通道，而是「已登录请求内的附加凭据」——
 * 用于在平台开发/运行流程中解锁该 Key 已获审批（APPROVED）的资源（工具/数据源）。
 *
 * 行为：
 * 1. 请求未携带 X-API-Key → 直接放行（普通 JWT 用户流程）；
 * 2. 携带了 X-API-Key → 必须有效（完整 Key 的 SHA-256 命中、ACTIVE、未过期），否则整个请求 401，
 *    杜绝「带伪造 Key 绕过资源审批校验」；有效则将 keyId 挂为请求属性 api_key_id 供服务层判定；
 * 3. 本过滤器绝不设置 SecurityContext 认证：仅凭 X-API-Key（无 JWT）访问任何端点都会被
 *    Security 层以 401 拒绝——外部无法直接通过 X-API-Key 调用任何资源。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ApiKeyAuthFilter extends OncePerRequestFilter {

    private static final String API_KEY_HEADER = "X-API-Key";
    public static final String API_KEY_ATTR = "api_key_id";

    private final ApiKeyRepository apiKeyRepository;

    @Value("${app.security.api-key-enabled:true}")
    private boolean apiKeyEnabled;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String apiKey = request.getHeader(API_KEY_HEADER);

        if (apiKey == null || apiKey.isBlank() || !apiKeyEnabled) {
            filterChain.doFilter(request, response);
            return;
        }

        Optional<ApiKey> keyOpt = apiKeyRepository.findByKeyHash(sha256(apiKey));
        if (keyOpt.isEmpty() || !"ACTIVE".equals(keyOpt.get().getStatus())) {
            log.warn("Invalid or inactive API Key presented");
            reject(response, "Invalid API Key");
            return;
        }

        ApiKey key = keyOpt.get();
        if (key.getExpiresAt() != null && key.getExpiresAt().isBefore(LocalDateTime.now())) {
            log.warn("Expired API Key: id={}", key.getId());
            reject(response, "API Key expired");
            return;
        }

        // 只挂凭据属性，不创建认证：X-API-Key 不赋予任何端点访问权
        request.setAttribute(API_KEY_ATTR, key.getId());
        filterChain.doFilter(request, response);
    }

    private void reject(HttpServletResponse response, String message) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.getWriter().write("{\"success\":false,\"message\":\"" + message + "\"}");
        response.setContentType("application/json");
    }

    private String sha256(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 不可用", e);
        }
    }
}
