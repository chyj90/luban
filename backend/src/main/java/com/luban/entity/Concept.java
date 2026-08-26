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

    @Column(name = "parent_id")
    private Long parentId;

    @Column(name = "group_id")
    private Long groupId;

    @Column(columnDefinition = "TEXT")
    private String description;

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
    @Column(name = "version")
    private Integer version = 0;

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