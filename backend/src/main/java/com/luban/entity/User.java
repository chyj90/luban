package com.luban.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@Entity
@Table(name = "users")
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 100)
    private String email;

    @Column(nullable = false, length = 50)
    private String account;

    private String password;

    @Column(nullable = false, length = 50)
    private String name;

    @Column(length = 20)
    private String mobile;

    @Column(length = 512)
    private String avatar;

    @Column(length = 50)
    private String position;

    @Column(length = 64)
    private String employeeNo;

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
        if (name == null) name = account;
        if (provider == null) provider = "local";
        if (status == null) status = "ACTIVE";
        if (syncedAt == null) syncedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}