package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "concept")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Concept {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 255)
    private String name;

    @Column(name = "group_id")
    private Long groupId;

    @Column(columnDefinition = "TEXT")
    private String description;

    /**
     * 语义角色：DIMENSION(维度，用于分组/筛选) / METRIC(指标，用于聚合度量) / ENTITY(实体，业务对象)。
     * 可空 = 未分类（兼容存量数据）。问数 prompt 的展示与决策规则据此区分，
     * 逐步替代硬编码在规则文本里的语义假设。
     */
    @Column(name = "concept_type", length = 16)
    private String conceptType;

    /**
     * 指标类概念的默认聚合方式：SUM/COUNT/AVG/MAX/MIN/NONE。
     * 用户未指明聚合时，LLM 按此生成 SQL，而不是靠猜。
     */
    @Column(name = "default_aggregation", length = 16)
    private String defaultAggregation;

    /** 指标单位（元、%、件…），final_answer 呈现与阈值解读时使用 */
    @Column(length = 32)
    private String unit;

    /**
     * 指标的时间戳列（如 stat_date），日期类过滤/趋势分析以此为锚。
     * 替代"先查 MIN/MAX(date_col)"规则里对时间列的猜测。
     */
    @Column(name = "timestamp_column", length = 128)
    private String timestampColumn;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "embedding", columnDefinition = "BLOB")
    private byte[] embedding;

    @Column(name = "embedding_version", length = 32)
    private String embeddingVersion;

    @Column(name = "anomaly_threshold_expr", length = 64)
    private String anomalyThresholdExpr;

    @Column(name = "anomaly_threshold_desc", length = 256)
    private String anomalyThresholdDesc;

    @Version
    @Column(name = "version", columnDefinition = "int default 0")
    private int version = 0;

    @Transient
    private Boolean mapped;

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