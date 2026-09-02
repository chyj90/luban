package com.luban.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@Entity
@Table(name = "code_pages")
public class CodePage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private Long pageId;

    @Column(columnDefinition = "mediumtext")
    private String html;

    @Column(columnDefinition = "mediumtext")
    private String css;

    @Column(columnDefinition = "mediumtext")
    private String js;

    @Column(columnDefinition = "text")
    private String libraries;

    @Column(columnDefinition = "text")
    private String queryIds;

    @Column(columnDefinition = "text")
    private String toolIds;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}