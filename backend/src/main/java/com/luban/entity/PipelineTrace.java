package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "pipeline_trace", indexes = {
    @Index(name = "idx_pt_session", columnList = "session_id"),
    @Index(name = "idx_pt_message", columnList = "message_id")
}, uniqueConstraints = {
    @UniqueConstraint(name = "uk_pt_pipeline", columnNames = "pipeline_id")
})
@Data
@NoArgsConstructor
@AllArgsConstructor
public class PipelineTrace {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "pipeline_id", nullable = false, length = 64)
    private String pipelineId;

    @Column(name = "session_id", nullable = false, length = 64)
    private String sessionId;

    @Column(name = "message_id", nullable = false, length = 64)
    private String messageId;

    @Column(name = "user_question", nullable = false, columnDefinition = "TEXT")
    private String userQuestion;

    @Column(name = "is_continued")
    private Boolean isContinued = false;

    @Column(name = "continuation_message_id", length = 64)
    private String continuationMessageId;

    @Column(name = "interrupt_reason", length = 32)
    private String interruptReason;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}