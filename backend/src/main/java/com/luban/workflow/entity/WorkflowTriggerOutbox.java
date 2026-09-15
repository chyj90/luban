package com.luban.workflow.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 流程节点触发器 outbox：ProcessEngine 在节点事件点同事务写入，
 * TriggerDispatcher 独立轮询派发（at-least-once，幂等键 = "otb-"+id）。
 */
@Data
@Entity
@Table(name = "workflow_trigger_outbox", indexes = {
        @Index(name = "uk_trigger_outbox_idem", columnList = "idempotencyKey", unique = true),
        @Index(name = "idx_trigger_outbox_scan", columnList = "status, nextRetryAt")
})
public class WorkflowTriggerOutbox {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "instance_id", nullable = false)
    private Long instanceId;

    @Column(name = "task_id")
    private Long taskId;

    @Column(name = "node_id", nullable = false, length = 64)
    private String nodeId;

    @Column(name = "trigger_id", length = 64)
    private String triggerId;

    @Column(name = "target_type", nullable = false, length = 32)
    private String targetType; // ORCHESTRATION / QUERY / TOOL

    @Column(name = "target_ref", nullable = false)
    private Long targetRef;

    /** 派发上下文：params / initiatorId / applicationId / workflowDefinitionId */
    @Column(nullable = false, columnDefinition = "JSON")
    private String payload;

    @Column(name = "idempotency_key", nullable = false, length = 64)
    private String idempotencyKey;

    @Column(nullable = false, length = 16)
    private String status; // PENDING / DISPATCHED / DEAD

    @Column(nullable = false)
    private Integer attempts;

    @Column(name = "max_attempts", nullable = false)
    private Integer maxAttempts;

    /** 退避序列 JSON，如 [30,120,600] */
    @Column(name = "backoff_seconds", length = 128)
    private String backoffSeconds;

    @Column(name = "next_retry_at", nullable = false)
    private LocalDateTime nextRetryAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "dispatched_at")
    private LocalDateTime dispatchedAt;

    @Column(name = "last_error", length = 512)
    private String lastError;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = LocalDateTime.now();
    }
}
