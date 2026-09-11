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
import java.util.Collections;
import java.util.HexFormat;
import java.util.Optional;

import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * X-API-Key 凭据校验过滤器。
 *
 * 行为分路：
 * - /api/v1/public/** 路径：外部公开调用，仅 X-API-Key 认证（不依赖 JWT）。
 *   Key 有效（SHA-256 命中、ACTIVE、未过期）→ 设置匿名 SecurityContext 通过认证；
 * - 其他路径（平台内部路径）：Key 作为附加凭据，只将 keyId 挂为请求属性 api_key_id，
 *   不设置 SecurityContext。必须同时持有 JWT 才能通过 Security 层。
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
            // /public/** 路径必须携带 X-API-Key
            if (request.getRequestURI().startsWith("/api/v1/public/")) {
                reject(response, "X-API-Key 请求头缺失");
                return;
            }
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

        // 对外公开路径：Key 有效即认证通过，不依赖 JWT
        if (request.getRequestURI().startsWith("/api/v1/public/")) {
            UsernamePasswordAuthenticationToken auth =
                    new UsernamePasswordAuthenticationToken("api-key:" + key.getId(), null, Collections.emptyList());
            SecurityContextHolder.getContext().setAuthentication(auth);
        }
        // 统一挂 api_key_id 属性（public 路径供 controller 读取，内部路径供 service 层判定）
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