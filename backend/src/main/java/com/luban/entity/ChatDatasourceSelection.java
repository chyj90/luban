package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "chat_datasource_selection", indexes = {
    @Index(name = "idx_cds_message_id", columnList = "message_id"),
    @Index(name = "idx_cds_session_id", columnList = "session_id")
})
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ChatDatasourceSelection {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "message_id", nullable = false, length = 64)
    private String messageId;

    @Column(name = "session_id", nullable = false, length = 64)
    private String sessionId;

    @Column(name = "datasources", columnDefinition = "JSON", nullable = false)
    private String datasources;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}