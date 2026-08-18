package com.luban.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "mcp_server_registry")
public class McpServerRegistry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 128)
    private String name;

    @Column(length = 512)
    private String description;

    @Column(name = "server_url", nullable = false, length = 512)
    private String serverUrl;

    @Column(name = "auth_type", nullable = false, length = 20)
    private String authType;

    @Column(name = "auth_config", columnDefinition = "JSON")
    private String authConfig;

    @Column(nullable = false, length = 20)
    private String status;

    @Column(name = "sync_interval")
    private Integer syncInterval;

    @Column(name = "last_sync_at")
    private LocalDateTime lastSyncAt;

    @Column(name = "last_sync_status", length = 20)
    private String lastSyncStatus;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
        if (status == null) status = "ENABLED";
        if (syncInterval == null) syncInterval = 3600;
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}