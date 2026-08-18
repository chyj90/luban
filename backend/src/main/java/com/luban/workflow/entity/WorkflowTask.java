package com.luban.workflow.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@Entity
@Table(name = "workflow_tasks")
public class WorkflowTask {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Transient
    private String applicationName;

    @Transient
    private String nodeName;

    @Column(nullable = false)
    private Long instanceId;

    @Column(nullable = true)
    private Long applicationId;

    @Column(nullable = false, length = 50)
    private String nodeId;

    @Column(nullable = false)
    private Long assigneeId;

    @Column(nullable = false, length = 20)
    private String assigneeType;

    private Long originalAssigneeId;

    @Column(nullable = false, length = 20)
    private String status;

    @Column(length = 20)
    private String action;

    @Column(columnDefinition = "TEXT")
    private String comment;

    @Column(columnDefinition = "JSON")
    private String attachments;

    private LocalDateTime deadline;

    @Column(nullable = false)
    private Boolean slaBreached = false;

    @Column(nullable = false, length = 20)
    private String collaborationMode;

    @Column(columnDefinition = "JSON")
    private String allAssigneeIds;

    @Column(columnDefinition = "JSON")
    private String completedAssigneeIds;

    private LocalDateTime remindedAt;

    private LocalDateTime startedAt;

    private LocalDateTime completedAt;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
        if (assigneeType == null) assigneeType = "NORMAL";
        if (status == null) status = "PENDING";
        if (collaborationMode == null) collaborationMode = "all_pass";
        if (slaBreached == null) slaBreached = false;
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}