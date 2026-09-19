package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

/**
 * 跨源桥接：声明两个数据源之间可联接的等值键（左表.列 ↔ 右表.列）。
 * 问数遇到跨源问题时，agent 按 nl2sql_federated 生成两条分源 SQL，
 * 平台按本桥接声明在内存中做哈希联接。
 */
@Entity
@Table(name = "federation_bridge")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class FederationBridge {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 128)
    private String name;

    @Column(name = "left_datasource_id", nullable = false)
    private Long leftDatasourceId;

    @Column(name = "left_table", nullable = false, length = 128)
    private String leftTable;

    @Column(name = "left_column", nullable = false, length = 128)
    private String leftColumn;

    @Column(name = "right_datasource_id", nullable = false)
    private Long rightDatasourceId;

    @Column(name = "right_table", nullable = false, length = 128)
    private String rightTable;

    @Column(name = "right_column", nullable = false, length = 128)
    private String rightColumn;

    /** INNER / LEFT（保留左侧行） */
    @Column(name = "join_type", nullable = false, length = 8)
    private String joinType = "INNER";

    @Column(length = 256)
    private String description;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
