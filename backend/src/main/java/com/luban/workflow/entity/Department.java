package com.luban.workflow.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@Entity
@Table(name = "departments")
public class Department {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    private Long parentId;

    @Column(length = 100)
    private String externalId;

    @Column(nullable = false, length = 20)
    private String provider;

    @Column(length = 500)
    private String path;

    private Long managerId;

    @Transient
    private String managerName;

    @Column
    private Integer orderNum;

    @Column(nullable = false)
    private LocalDateTime syncedAt;

    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
        if (provider == null) provider = "local";
        if (syncedAt == null) syncedAt = LocalDateTime.now();
        if (orderNum == null) orderNum = 0;
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}