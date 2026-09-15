package com.luban.workflow.service;

import com.luban.entity.User;
import com.luban.repository.UserRepository;
import com.luban.workflow.repository.RoleRepository;
import com.luban.workflow.repository.RoleUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 审批人脚本的受控查询接口（沙箱白名单）。
 * 替代原先直接注入 userRepository/roleRepository 的做法——脚本只能经此
 * 拿到脱敏后的用户信息，拿不到仓库实例与完整实体（含 password 等敏感字段）。
 */
@Component
@RequiredArgsConstructor
public class ApproverScriptHelper {

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final RoleUserRepository roleUserRepository;

    /** 脱敏用户视图：id/account/name */
    public Map<String, Object> findUserById(Long userId) {
        if (userId == null) return null;
        return userRepository.findById(userId).map(this::sanitize).orElse(null);
    }

    /** 按角色 slug 查用户 id 列表（脚本按 id 返回审批人即可） */
    public List<Long> userIdsByRoleSlug(String slug) {
        if (slug == null || slug.isBlank()) return List.of();
        return roleRepository.findBySlug(slug)
                .map(role -> roleUserRepository.findByRoleId(role.getId()).stream()
                        .map(ru -> ru.getUserId())
                        .toList())
                .orElse(List.of());
    }

    private Map<String, Object> sanitize(User u) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", u.getId());
        m.put("account", u.getAccount());
        m.put("name", u.getName());
        return m;
    }
}
