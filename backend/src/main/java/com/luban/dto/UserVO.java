package com.luban.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class UserVO {
    private Long id;
    private String displayName;
    private String email;
    private String mobile;
    private String position;
    private String employeeNo;
    private Long deptId;
    private String deptName;
    private Long leaderId;
    private Long userId;
    private String account;
    private LocalDateTime createdAt;
    private Long roleId;
    private String roleName;
    private String roleIds;
    private boolean hasAccount;
}