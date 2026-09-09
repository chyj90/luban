package com.luban.security;

import com.luban.entity.User;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;

@Component
public class JwtTokenProvider {

    private static final String KNOWN_DEFAULT_SECRET = "luban-jwt-secret-key-change-in-production-256-bit";

    private final SecretKey key;
    private final long expiration;
    private final boolean ephemeral;

    public JwtTokenProvider(
            @Value("${app.security.jwt.secret:}") String secret,
            @Value("${app.security.jwt.expiration}") long expiration) {
        // 密钥缺失或仍是历史默认值时使用随机临时密钥：拒绝弱默认上线，重启即失效所有旧 token
        String effective = secret == null ? "" : secret.trim();
        boolean weak = effective.isEmpty() || effective.equals(KNOWN_DEFAULT_SECRET) || effective.length() < 32;
        this.ephemeral = weak;
        if (weak) {
            byte[] random = new byte[48];
            new java.security.SecureRandom().nextBytes(random);
            this.key = Keys.hmacShaKeyFor(random);
            org.slf4j.LoggerFactory.getLogger(JwtTokenProvider.class)
                    .warn("未配置 LUBAN_JWT_SECRET（缺失/过短/为历史默认值），已使用随机临时密钥，重启后所有登录态失效");
        } else {
            this.key = Keys.hmacShaKeyFor(effective.getBytes(StandardCharsets.UTF_8));
        }
        this.expiration = expiration;
    }

    public String generateToken(User user) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + expiration);

        return Jwts.builder()
                .subject(user.getId().toString())
                .claim("email", user.getEmail())
                .claim("account", user.getAccount())
                .issuedAt(now)
                .expiration(expiry)
                .signWith(key)
                .compact();
    }

    public Long getUserIdFromToken(String token) {
        Claims claims = Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
        return Long.parseLong(claims.getSubject());
    }

    public boolean validateToken(String token) {
        try {
            Jwts.parser().verifyWith(key).build().parseSignedClaims(token);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}