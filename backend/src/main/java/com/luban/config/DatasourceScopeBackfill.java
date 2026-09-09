package com.luban.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Datasource.scope 列回填：存量行 scope 为 null 时以 slug 为准（历史上 slug 承担 scope 语义）。
 * ddl-auto=update 自动加列后执行一次；显式 scope 落地后新代码读取 getEffectiveScope()。
 */
@Slf4j
@Component
@Order(100)
@RequiredArgsConstructor
public class DatasourceScopeBackfill implements ApplicationRunner {

    private final JdbcTemplate jdbcTemplate;

    @Override
    public void run(ApplicationArguments args) {
        try {
            int updated = jdbcTemplate.update(
                    "UPDATE datasources SET scope = slug WHERE scope IS NULL");
            if (updated > 0) {
                log.info("[DatasourceScopeBackfill] 已回填 {} 行 datasources.scope", updated);
            }
        } catch (Exception e) {
            log.warn("[DatasourceScopeBackfill] 回填跳过（表或列尚未就绪）: {}", e.getMessage());
        }
    }
}
