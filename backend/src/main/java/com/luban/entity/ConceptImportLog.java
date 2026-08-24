package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "concept_import_log")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ConceptImportLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 32)
    private String industry;

    @Column(nullable = false, length = 128)
    private String source;

    @Column(name = "target_group_id", nullable = false)
    private Long targetGroupId;

    @Column(name = "total_concepts", nullable = false)
    private Integer totalConcepts = 0;

    @Column(name = "imported_count", nullable = false)
    private Integer importedCount = 0;

    @Column(name = "skipped_count", nullable = false)
    private Integer skippedCount = 0;

    @Column(name = "conflict_detail", columnDefinition = "JSON")
    private String conflictDetail;

    @Column(name = "imported_by", length = 64)
    private String importedBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}