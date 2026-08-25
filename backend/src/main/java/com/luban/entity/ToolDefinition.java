package com.luban.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "tool_definition")
public class ToolDefinition {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 128)
    private String name;

    @Column(name = "display_name", length = 128)
    private String displayName;

    @Column(nullable = false, length = 512)
    private String description;

    @Column(name = "tool_type", nullable = false, length = 20)
    private String toolType;

    @Column(nullable = false, length = 20)
    private String status;

    @Column(name = "input_schema", columnDefinition = "JSON")
    private String inputSchema;

    @Column(name = "output_schema", columnDefinition = "JSON")
    private String outputSchema;

    @Column(name = "embedding", columnDefinition = "TEXT")
    private String embedding;

    @Column(nullable = false, columnDefinition = "JSON")
    private String config;

    @Column(name = "group_id", nullable = false)
    private Long groupId;

    @Column(nullable = false, length = 20)
    private String scope;

    @Column(name = "created_by")
    private Long createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
        if (status == null) status = "ENABLED";
        if (scope == null) scope = "PLATFORM";
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}