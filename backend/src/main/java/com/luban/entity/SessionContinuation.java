package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "session_continuation")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class SessionContinuation {

    @Id
    @Column(name = "session_id", length = 64)
    private String sessionId;

    @Column(name = "pending_continuation", nullable = false)
    private Boolean pendingContinuation = false;

    @Column(name = "last_interrupted_message_id", length = 64)
    private String lastInterruptedMessageId;

    @Column(name = "last_user_question", columnDefinition = "TEXT")
    private String lastUserQuestion;

    @Column(name = "last_partial_response", columnDefinition = "TEXT")
    private String lastPartialResponse;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}