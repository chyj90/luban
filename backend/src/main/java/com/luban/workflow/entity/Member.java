package com.luban.workflow.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@Entity
@Table(name = "members")
public class Member {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long userId;

    @Column(nullable = false, length = 50)
    private String name;

    @Column(length = 100)
    private String email;

    @Column(length = 20)
    private String mobile;

    @Column(length = 512)
    private String avatar;

    private Long departmentId;

    @Column(length = 255)
    private String departmentName;

    @Column(length = 50)
    private String position;

    @Column(length = 100)
    private String externalId;

    @Column(length = 64)
    private String employeeNo;

    private Long leaderId;

    @Column(nullable = false, length = 20)
    private String provider;

    @Column(nullable = false, length = 20)
    private String status;

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
        if (status == null) status = "ACTIVE";
        if (syncedAt == null) syncedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}