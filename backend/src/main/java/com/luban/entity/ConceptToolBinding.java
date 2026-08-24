package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "concept_tool_binding", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"concept_id", "tool_id", "binding_type"})
})
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ConceptToolBinding {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "concept_id", nullable = false)
    private Long conceptId;

    @Column(name = "tool_id", nullable = false)
    private Long toolId;

    @Column(name = "binding_type", nullable = false, length = 32)
    private String bindingType;

    @Column(name = "is_default", nullable = false)
    private Boolean isDefault = false;

    @Column(name = "config", columnDefinition = "JSON")
    private String config;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}