package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "industry_relation")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class IndustryRelation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "industry_id", nullable = false)
    private Long industryId;

    @Column(name = "relation_type", nullable = false, length = 64)
    private String relationType;

    @Column(length = 256)
    private String description;

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