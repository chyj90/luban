package com.luban.invoke;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

/** 统一调用审计记录：漏斗内每次 invoke 一条，parentTraceId 串出全链路调用树。 */
@Data
@Entity
@Table(name = "invocation_trace", indexes = {
        @Index(name = "idx_inv_trace_chain", columnList = "chainId"),
        @Index(name = "idx_inv_trace_parent", columnList = "parentTraceRowId"),
        @Index(name = "idx_inv_trace_created", columnList = "createdAt")
})
public class InvocationTrace {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "chain_id", nullable = false, length = 64)
    private String chainId;

    @Column(name = "parent_trace_row_id")
    private Long parentTraceRowId;

    @Column(name = "origin", nullable = false, length = 32)
    private String origin;

    @Column(name = "principal_kind", length = 16)
    private String principalKind;

    @Column(name = "principal_id")
    private Long principalId;

    @Column(name = "app_id")
    private Long appId;

    @Column(name = "target_type", nullable = false, length = 32)
    private String targetType;

    @Column(name = "target_id", nullable = false)
    private Long targetId;

    @Column(nullable = false)
    private Integer depth;

    @Column(length = 16, nullable = false)
    private String status; // RUNNING / SUCCESS / FAILED

    @Column(name = "error_code", length = 64)
    private String errorCode;

    @Column(name = "error_message", length = 512)
    private String errorMessage;

    @Column(name = "elapsed_ms")
    private Long elapsedMs;

    @Column(name = "idempotency_key", length = 64)
    private String idempotencyKey;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;
}
