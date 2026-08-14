package com.luban.workflow.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@Entity
@Table(name = "workflow_instances")
public class WorkflowInstance {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Transient
    private String applicationName;

    @Column(nullable = false)
    private Long workflowId;

    @Column(nullable = false)
    private Long applicationId;

    @Column(nullable = false)
    private Integer workflowVersion;

    @Column(nullable = false)
    private Long formId;

    @Column(columnDefinition = "JSON")
    private String formData;

    @Column(nullable = false, length = 20)
    private String status;

    @Column(nullable = false)
    private Long initiatorId;

    @Column(columnDefinition = "JSON")
    private String currentNodes;

    @Column
    private LocalDateTime deadline;

    @Column
    private LocalDateTime startedAt;

    @Column
    private LocalDateTime completedAt;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column
    private Long parentInstanceId;

    @Column
    private Long subProcessDefinitionId;

    @Column(nullable = false)
    private Boolean isTest = false;

    @Column(nullable = false)
    private Integer definitionVersion = 1;

    @Column(nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
        if (status == null) status = "RUNNING";
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}