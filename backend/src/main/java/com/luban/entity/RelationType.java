package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

/**
 * 全局关系类型注册表。概念关系的 relationType 必须在此注册后才可用于建模，
 * 内置类型由 PlatformSeedDataInitializer 启动时播种，自定义类型可经管理端或
 * 本体变更（OntologyChangeService）追加。
 */
@Entity
@Table(name = "relation_type", uniqueConstraints = @UniqueConstraint(columnNames = "relation_type"))
@Data
@NoArgsConstructor
@AllArgsConstructor
public class RelationType {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "relation_type", nullable = false, length = 64)
    private String relationType;

    @Column(length = 256)
    private String description;

    @Column(length = 32)
    private String label;

    @Column(length = 16)
    private String color;

    @Column(name = "source_role", length = 32)
    private String sourceRole;

    @Column(name = "target_role", length = 32)
    private String targetRole;

    /** true = source 是 parent、target 是 child，用于构建概念树层级 */
    @Column(name = "source_to_target", nullable = false)
    private Boolean sourceToTarget = false;

    @Column(name = "is_transitive", nullable = false)
    private Boolean isTransitive = false;

    @Column(name = "is_symmetric", nullable = false)
    private Boolean isSymmetric = false;

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder = 0;

    @Column(name = "is_builtin", nullable = false)
    private Boolean isBuiltin = false;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
