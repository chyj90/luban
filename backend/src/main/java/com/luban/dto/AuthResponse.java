package com.luban.dto;

import com.luban.entity.User;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
public class AuthResponse {
    private String token;
    private UserInfo user;

    /**
     * 登录用户档案。除鉴权字段外携带完整身份与组织信息（部门来自 user_dept 主部门）——
     * 这是平台身份资产的第一出口：前端 authStore、页面 __LUBAN_USER__、Agent 的
     * "当前用户身份"全部源于此，业务库不冗余这些字段。
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class UserInfo {
        private Long id;
        private String email;
        private String account;
        private boolean superAdmin;
        private String displayName;
        private String mobile;
        private String position;
        private String employeeNo;
        private Long deptId;
        private String deptName;
        private Long leaderId;

        public static UserInfo from(User user, Long deptId, String deptName, Long leaderId, boolean superAdmin) {
            return new UserInfo(user.getId(), user.getEmail(), user.getAccount(), superAdmin,
                    user.getName(), user.getMobile(), user.getPosition(), user.getEmployeeNo(),
                    deptId, deptName, leaderId);
        }
    }
}
