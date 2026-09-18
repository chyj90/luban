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
        @Index(name = "idx_trigger_outbox_scan", columnList = "status, nextRetryAt"),
        @Index(name = "idx_trigger_outbox_group", columnList = "groupId")
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

    /**
     * 触发器组 id：同一来源节点在同一事件上配置的多个触发器同组入队。
     * 派发门槛保证组内按 group_order 顺序执行（前序成员未 DISPATCHED 时后续成员不派发），
     * 失败重试也不会乱序——"先回写状态、再扣减余额"这类顺序依赖不再靠轮询实现巧合。
     */
    @Column(name = "group_id", length = 64)
    private String groupId;

    /** 组内顺序（0 起），与触发器配置顺序一致；非组内行（历史数据）为 null */
    @Column(name = "group_order")
    private Integer groupOrder;

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

    /**
     * 预期最小影响行数（仅 QUERY 目标，可选声明）：实际影响行数低于该值按失败重试/死信处理。
     * 用于"必命中"回写（如按 id 置状态）；守卫型查询（预期可能 0 行）不要声明。
     */
    @Column(name = "min_affected_rows")
    private Integer minAffectedRows;

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
