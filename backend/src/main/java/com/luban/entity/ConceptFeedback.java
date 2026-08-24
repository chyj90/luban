package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "concept_feedback")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class ConceptFeedback {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id", nullable = false, length = 64)
    private String sessionId;

    @Column(name = "message_id", nullable = false, length = 64)
    private String messageId;

    @Column(name = "user_question", nullable = false, columnDefinition = "TEXT")
    private String userQuestion;

    @Column(name = "reasoning", columnDefinition = "TEXT")
    private String reasoning;

    @Column(name = "resolved_concepts", columnDefinition = "JSON")
    private String resolvedConcepts;

    @Column(name = "generated_sql", columnDefinition = "TEXT")
    private String generatedSql;

    @Column(name = "query_result", columnDefinition = "TEXT")
    private String queryResult;

    @Column(name = "user_feedback", nullable = false, columnDefinition = "TEXT")
    private String userFeedback;

    @Column(name = "feedback_type", length = 16)
    private String feedbackType;

    @Column(name = "correct_concept_id")
    private Long correctConceptId;

    @Column(name = "status", nullable = false, length = 16)
    private String status = "pending";

    @Column(name = "reviewed_by", length = 64)
    private String reviewedBy;

    @Column(name = "review_comment", columnDefinition = "TEXT")
    private String reviewComment;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "reviewed_at")
    private LocalDateTime reviewedAt;

    @Column(name = "suggestions", columnDefinition = "TEXT")
    private String suggestions;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}