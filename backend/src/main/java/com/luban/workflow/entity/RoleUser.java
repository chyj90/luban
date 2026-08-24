package com.luban.workflow.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "role_users", uniqueConstraints = {
        @UniqueConstraint(columnNames = {"role_id", "user_id"})
})
public class RoleUser {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "role_id", nullable = false)
    private Long roleId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    public RoleUser(Long roleId, Long userId) {
        this.roleId = roleId;
        this.userId = userId;
    }
}