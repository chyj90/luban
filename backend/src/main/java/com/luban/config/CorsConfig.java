package com.luban.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.List;

/**
 * 允许来源由配置驱动（app.cors.allowed-origins，逗号分隔 origin 或 origin-pattern）。
 * 默认仅本机开发来源；Docker 部署由 Nginx 做安全隔离，后端可放宽为 "*"。
 */
@Slf4j
@Configuration
public class CorsConfig {

    @Bean
    public CorsFilter corsFilter(
            @Value("${app.cors.allowed-origins:http://localhost:*,http://127.0.0.1:*}") List<String> allowedOrigins) {
        if (allowedOrigins.contains("*")) {
            log.warn("============================================================");
            log.warn("[安全警告] CORS 已配置为允许所有来源（*）");
            log.warn("  任意网站均可跨域携带凭据调用本服务 API");
            log.warn("  Docker 部署下由 Nginx 做入口隔离，风险可控");
            log.warn("  如非 Docker 部署，请通过 app.cors.allowed-origins 指定具体来源");
            log.warn("============================================================");
        } else {
            log.info("CORS 允许来源: {}", allowedOrigins);
        }

        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOriginPatterns(allowedOrigins);
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return new CorsFilter(source);
    }
}