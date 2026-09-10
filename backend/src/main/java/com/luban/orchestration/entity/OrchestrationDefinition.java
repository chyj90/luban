package com.luban.orchestration.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

/** API 编排定义（应用内资源）。发布后在 ToolDefinition 注册 ORCHESTRATION 类型工具。 */
@Data
@Entity
@Table(name = "orchestration_definitions")
public class OrchestrationDefinition {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(length = 512)
    private String description;

    @Column(name = "application_id", nullable = false)
    private Long applicationId;

    @Column(name = "current_version_id")
    private Long currentVersionId;

    @Column(name = "published_version_id")
    private Long publishedVersionId;

    @Column(nullable = false, length = 20)
    private String status; // DRAFT / PUBLISHED / ARCHIVED

    @Column(name = "created_by", nullable = false)
    private Long createdBy;

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
