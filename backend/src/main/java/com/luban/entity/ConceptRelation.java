package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "concept_relation")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ConceptRelation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "source_concept_id", nullable = false)
    private Long sourceConceptId;

    @Column(name = "target_concept_id", nullable = false)
    private Long targetConceptId;

    @Column(name = "relation_type", nullable = false, length = 32)
    private String relationType;

    @Column(columnDefinition = "TEXT")
    private String expression;

    @Column(length = 256)
    private String description;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Version
    @Column(name = "version")
    private Integer version = 0;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}