package com.luban.workflow.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@Entity
@Table(name = "workflow_history")
public class WorkflowHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long instanceId;

    private Long taskId;

    @Column(nullable = false, length = 50)
    private String nodeId;

    @Column(nullable = false)
    private Long operatorId;

    @Column(nullable = false, length = 30)
    private String action;

    @Column(length = 50)
    private String fromNodeId;

    @Column(length = 50)
    private String toNodeId;

    @Column(columnDefinition = "TEXT")
    private String comment;

    @Column(columnDefinition = "JSON")
    private String detail;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}