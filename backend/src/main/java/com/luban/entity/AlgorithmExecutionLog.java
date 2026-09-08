package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "algorithm_execution_log")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AlgorithmExecutionLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "algorithm_id", nullable = false)
    private Long algorithmId;

    @Column(name = "session_id", length = 64)
    private String sessionId;

    @Column(name = "tool_call_id", length = 64)
    private String toolCallId;

    @Column(name = "user_query", columnDefinition = "TEXT")
    private String userQuery;

    @Column(nullable = false)
    private Boolean success;

    @Column(name = "input_data", columnDefinition = "TEXT")
    private String inputData;

    @Column(name = "output_data", columnDefinition = "TEXT")
    private String outputData;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "elapsed_ms")
    private Long elapsedMs;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}