package com.luban.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "role_concept_permission", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"role_id", "group_id"})
})
@Data
@NoArgsConstructor
@AllArgsConstructor
public class RoleConceptPermission {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "role_id", nullable = false)
    private Long roleId;

    @Column(name = "group_id", nullable = false)
    private Long groupId;

    @Column(name = "granted_by")
    private Long grantedBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}