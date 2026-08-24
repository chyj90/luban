package com.luban.service;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * NL2SQL 独立连接池，与业务连接池隔离。
 * 全局最大 5 连接，按数据源 ID 动态创建子池。
 */
@Slf4j
@Component
public class Nl2sqlConnectionPool {

    private static final int MAX_TOTAL_CONNECTIONS = 5;
    private static final int MAX_IDLE_PER_POOL = 2;
    private static final int CONNECTION_TIMEOUT_MS = 10_000;
    private static final int IDLE_TIMEOUT_MS = 300_000;
    private static final int MAX_LIFETIME_MS = 600_000;

    private final Map<Long, HikariDataSource> pools = new ConcurrentHashMap<>();

    public Connection getConnection(Long datasourceId, String jdbcUrl, String username, String password) {
        HikariDataSource ds = pools.computeIfAbsent(datasourceId, id -> {
            HikariConfig config = new HikariConfig();
            config.setJdbcUrl(jdbcUrl);
            config.setUsername(username);
            config.setPassword(password);
            config.setMaximumPoolSize(Math.max(1, MAX_TOTAL_CONNECTIONS / Math.max(1, pools.size() + 1)));
            config.setMinimumIdle(0);
            config.setIdleTimeout(IDLE_TIMEOUT_MS);
            config.setMaxLifetime(MAX_LIFETIME_MS);
            config.setConnectionTimeout(CONNECTION_TIMEOUT_MS);
            config.setPoolName("nl2sql-pool-" + id);
            config.addDataSourceProperty("cachePrepStmts", "true");
            config.addDataSourceProperty("prepStmtCacheSize", "64");
            config.addDataSourceProperty("prepStmtCacheSqlLimit", "256");
            log.info("Created NL2SQL connection pool for datasource {}: {}", id, jdbcUrl);
            return new HikariDataSource(config);
        });
        try {
            return ds.getConnection();
        } catch (SQLException e) {
            log.error("Failed to get NL2SQL connection from pool for datasource {}", datasourceId, e);
            throw new RuntimeException("NL2SQL 连接池获取连接失败", e);
        }
    }

    public void evictPool(Long datasourceId) {
        HikariDataSource ds = pools.remove(datasourceId);
        if (ds != null) {
            ds.close();
            log.info("Closed NL2SQL connection pool for datasource {}", datasourceId);
        }
    }

    public int getActivePoolCount() {
        return pools.size();
    }

    public int getActiveConnectionCount() {
        return pools.values().stream()
                .mapToInt(ds -> ds.getHikariPoolMXBean().getActiveConnections())
                .sum();
    }
}