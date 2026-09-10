package com.luban.orchestration.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

/** 编排执行记录：审计 + 节点级调试留痕（inputs/outputs 已脱敏摘要化）。 */
@Data
@Entity
@Table(name = "orchestration_executions", indexes = {
        @Index(name = "idx_orchexec_def_time", columnList = "definition_id, created_at")
})
public class OrchestrationExecution {

    public static final String TRIGGER_USER_TEST = "USER_TEST";
    public static final String TRIGGER_RUNTIME = "RUNTIME";
    public static final String TRIGGER_API_KEY = "API_KEY";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "definition_id", nullable = false)
    private Long definitionId;

    @Column(name = "version_id", nullable = false)
    private Long versionId;

    @Column(name = "trigger_type", nullable = false, length = 20)
    private String triggerType;

    @Column(name = "api_key_id")
    private Long apiKeyId;

    @Column(columnDefinition = "JSON")
    private String inputs;        // 脱敏后的输入摘要

    @Column(name = "outputs_digest", columnDefinition = "JSON")
    private String outputsDigest; // 输出摘要（截断）

    @Column(name = "node_trace", columnDefinition = "JSON")
    private String nodeTrace;     // 每节点耗时/状态/错误码

    @Column(nullable = false, length = 20)
    private String status;        // SUCCESS / FAILED / TIMEOUT

    @Column(name = "error_code", length = 64)
    private String errorCode;

    @Column(name = "duration_ms", nullable = false)
    private Integer durationMs;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
