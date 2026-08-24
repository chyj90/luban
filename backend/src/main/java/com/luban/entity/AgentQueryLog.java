package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "agent_query_log")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AgentQueryLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id", nullable = false, length = 64)
    private String sessionId;

    @Column(name = "message_id", nullable = false, length = 64)
    private String messageId;

    @Column(name = "user_query", columnDefinition = "TEXT")
    private String userQuery;

    @Column(name = "decision_type", length = 32)
    private String decisionType;

    @Column(name = "concept_ids", columnDefinition = "JSON")
    private String conceptIds;

    @Column(name = "concept_match_count", nullable = false)
    private int conceptMatchCount = 0;

    @Column(name = "concept_expand_count", nullable = false)
    private int conceptExpandCount = 0;

    @Column(name = "api_tool_count", nullable = false)
    private int apiToolCount = 0;

    @Column(name = "sql_generated", columnDefinition = "TEXT")
    private String sqlGenerated;

    @Column(name = "sql_executed", nullable = false)
    private boolean sqlExecuted = false;

    @Column(name = "sql_success", nullable = false)
    private boolean sqlSuccess = false;

    @Column(name = "sql_error", columnDefinition = "TEXT")
    private String sqlError;

    @Column(name = "llm_latency_ms")
    private Long llmLatencyMs;

    @Column(name = "execution_latency_ms")
    private Long executionLatencyMs;

    @Column(name = "total_latency_ms")
    private Long totalLatencyMs;

    @Column(name = "permission_denied", nullable = false)
    private boolean permissionDenied = false;

    @Column(name = "feedback_given", nullable = false)
    private boolean feedbackGiven = false;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}