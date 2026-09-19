package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

/**
 * 数据源表结构快照（schema 缓存）。
 * 问数 prompt / 自动映射 / 本体校验都依赖表结构元数据，
 * 此前每轮对话实时连所有数据源拉全量 schema，数据源多时首包慢且单源故障会被放大；
 * 现按 TTL 缓存于本表，数据源配置变更时失效，可经 refresh 接口强制刷新。
 */
@Entity
@Table(name = "datasource_schema", uniqueConstraints = @UniqueConstraint(columnNames = "datasource_id"))
@Data
@NoArgsConstructor
@AllArgsConstructor
public class DatasourceSchema {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "datasource_id", nullable = false)
    private Long datasourceId;

    /** 简化后的表结构 JSON：[{name, comment, columns:[{name,type,nullable,comment}]}] */
    @Column(name = "tables_json", columnDefinition = "LONGTEXT", nullable = false)
    private String tablesJson;

    @Column(name = "table_count", nullable = false)
    private Integer tableCount = 0;

    @Column(name = "synced_at", nullable = false)
    private LocalDateTime syncedAt;

    @Column(name = "sync_ok", nullable = false)
    private Boolean syncOk = true;

    @Column(name = "sync_error", length = 512)
    private String syncError;

    @PrePersist
    protected void onCreate() {
        if (syncedAt == null) syncedAt = LocalDateTime.now();
    }
}
