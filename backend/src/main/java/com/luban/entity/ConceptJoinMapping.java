package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "concept_join_mapping", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"concept_id", "target_concept", "relation_type", "datasource_id"})
})
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ConceptJoinMapping {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "concept_id", nullable = false)
    private Long conceptId;

    @Column(name = "datasource_id", nullable = false)
    private Long datasourceId;

    @Column(name = "target_concept", nullable = false, length = 128)
    private String targetConcept;

    @Column(name = "relation_type", nullable = false, length = 32)
    private String relationType;

    @Column(name = "join_table", nullable = false, length = 128)
    private String joinTable;

    @Column(name = "join_condition", nullable = false, length = 512)
    private String joinCondition;

    @Column(name = "join_type", nullable = false, length = 16)
    private String joinType = "LEFT";

    @Column(name = "confidence", precision = 3, scale = 2)
    private BigDecimal confidence;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @Version
    @Column(name = "version")
    private Integer version = 0;

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