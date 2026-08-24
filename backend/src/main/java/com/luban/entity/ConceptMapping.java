package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "concept_mapping", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"concept_id", "attribute_name", "datasource_id"})
})
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ConceptMapping {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "concept_id", nullable = false)
    private Long conceptId;

    @Column(name = "datasource_id", nullable = false)
    private Long datasourceId;

    @Column(name = "table_name", nullable = false, length = 128)
    private String tableName;

    @Column(name = "column_name", nullable = false, length = 128)
    private String columnName;

    @Column(name = "attribute_name", length = 128)
    private String attributeName;

    @Column(name = "mapping_type", nullable = false, length = 16)
    private String mappingType = "direct";

    @Column(name = "computed_expr", length = 512)
    private String computedExpr;

    @Column(name = "confidence", precision = 3, scale = 2)
    private BigDecimal confidence;

    @Column(name = "is_auto", nullable = false)
    private Boolean isAuto = false;

    @Column(name = "is_required", nullable = false)
    private Boolean isRequired = false;

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