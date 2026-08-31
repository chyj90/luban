package com.luban.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@Entity
@Table(name = "jdbc_drivers")
public class JdbcDriver {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 50)
    private String name;

    @Column(nullable = false, length = 50)
    private String displayName;

    @Column(length = 255)
    private String description;

    @Column(nullable = false, length = 50, columnDefinition = "varchar(50) default 'OTHER'")
    private String category;

    @Column(nullable = false, length = 255)
    private String driverClass;

    @Column(nullable = false, length = 512)
    private String jdbcUrlTemplate;

    @Column(nullable = false)
    private Integer defaultPort;

    @Column(nullable = false, length = 255)
    private String groupId;

    @Column(nullable = false, length = 255)
    private String artifactId;

    @Column(nullable = false, length = 50)
    private String version;

    @Column(length = 50)
    private String classifier;

    @Column(nullable = false, columnDefinition = "boolean default false")
    private Boolean installed;

    @Column(nullable = false, columnDefinition = "boolean default false")
    private Boolean builtin;

    @Column(nullable = false, columnDefinition = "boolean default true")
    private Boolean enabled;

    @Column(columnDefinition = "TEXT")
    private String extraFields;

    @Column(columnDefinition = "TEXT")
    private String dependencies;

    @Column(name = "hide_standard_fields", columnDefinition = "boolean default false")
    private Boolean hideStandardFields;

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