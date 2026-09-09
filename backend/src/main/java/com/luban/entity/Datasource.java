package com.luban.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@Entity
@Table(name = "datasources")
public class Datasource {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "owner_id")
    private Long ownerId;

    @Column(nullable = false, length = 20)
    private String slug;

    /**
     * 显式资源范围（"PLATFORM" / "APPLICATION"），由 slug 回填而来。
     * 历史上 slug 同时承担 scope 语义、ownerId 在两种 scope 下含义漂移（应用 id / 平台组 id），
     * 本列用于逐步消除语义漂移；读取请用 {@link #getEffectiveScope()}。
     */
    @Column(name = "scope", length = 20)
    private String scope;

    @Column(nullable = false, length = 50)
    private String name;

    @Column(nullable = false, length = 20)
    private String type;

    @Column(columnDefinition = "text")
    private String config;

    @Column(length = 20, columnDefinition = "varchar(20) default 'pending'")
    private String status;

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

    /** scope 列回填前的存量行回退读 slug */
    public String getEffectiveScope() {
        return scope != null ? scope : slug;
    }
}
