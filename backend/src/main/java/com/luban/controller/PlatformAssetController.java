package com.luban.controller;

import com.luban.dto.ApiResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 平台资产运行时查询：平台用户与部门组织树。
 * 低代码平台的核心优势之一是应用与 Agent 直接消费平台已有的人员组织数据——
 * 这是唯一事实源：业务表只存 user_id 绑定键，姓名/部门等身份属性一律在渲染时
 * 从这里实时解析（页面内置查询 PlatformUsers/PlatformDepartments、Agent 检索工具同源），
 * 平台新增/改名/调岗用户自动对全部应用生效，业务库不冗余、不需要同步。
 * 仅要求登录，不设管理端权限：这是"组织目录"语义——应用运行时（审批人选择、身份回显）
 * 必须可查，但只回最小字段集（id/姓名/账号/部门/直属领导），不含手机号/邮箱等 PII；
 * 联系方式等敏感档案走用户管理端的权限接口。
 */
@RestController
@RequestMapping("/api/v1/platform")
public class PlatformAssetController {

    private static final int MAX_PAGE_SIZE = 200;
    private static final int MAX_IDS = 500;

    private final NamedParameterJdbcTemplate jdbc;

    public PlatformAssetController(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String USER_FROM = """
            FROM users u
            LEFT JOIN user_dept ud ON ud.user_id = u.id AND ud.is_primary = TRUE
            LEFT JOIN departments d ON d.id = ud.department_id
            """;

    /**
     * 分页检索平台用户（最小字段集：id/姓名/账号/部门/直属领导，无 PII）。
     * keyword 模糊匹配姓名/账号；deptId 过滤部门；ids 按绑定键批量精确解析
     * （页面拿业务行里的 user_id 列表回查姓名/部门）。
     */
    @GetMapping("/users")
    public ResponseEntity<ApiResponse<Map<String, Object>>> users(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Long deptId,
            @RequestParam(required = false) List<Long> ids,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int pageSize) {

        int size = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
        int offset = (Math.max(page, 1) - 1) * size;

        StringBuilder where = new StringBuilder(" WHERE 1 = 1");
        Map<String, Object> args = new HashMap<>();
        if (keyword != null && !keyword.isBlank()) {
            // 只按姓名/账号检索：不回 email 却允许按 email 搜等于暴露邮箱存在性
            where.append(" AND (u.name LIKE CONCAT('%', :keyword, '%')")
                    .append(" OR u.account LIKE CONCAT('%', :keyword, '%'))");
            args.put("keyword", keyword.trim());
        }
        if (deptId != null) {
            where.append(" AND ud.department_id = :deptId");
            args.put("deptId", deptId);
        }
        if (ids != null && !ids.isEmpty()) {
            where.append(" AND u.id IN (:ids)");
            args.put("ids", ids.stream().limit(MAX_IDS).collect(Collectors.toList()));
        }

        Long total = jdbc.queryForObject("SELECT COUNT(*) " + USER_FROM + where, args, Long.class);
        args.put("limit", size);
        args.put("offset", offset);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT u.id, u.name, u.account,"
                        + " ud.department_id, COALESCE(ud.department_name, d.name) AS dept_name, ud.leader_id "
                        + USER_FROM + where + " ORDER BY u.id LIMIT :limit OFFSET :offset",
                args);

        List<Map<String, Object>> users = rows.stream().map(r -> {
            Map<String, Object> u = new LinkedHashMap<>();
            u.put("id", r.get("id"));
            u.put("name", r.get("name"));
            u.put("account", r.get("account"));
            u.put("deptId", r.get("department_id"));
            u.put("deptName", r.get("dept_name"));
            u.put("leaderId", r.get("leader_id"));
            return u;
        }).toList();

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("rows", users);
        data.put("total", total != null ? total : 0);
        data.put("page", Math.max(page, 1));
        data.put("pageSize", size);
        return ResponseEntity.ok(ApiResponse.ok(data));
    }

    /** 部门组织树（部门量级远小于用户，全量返回即可；managerId 可用于"部门经理审批"） */
    @GetMapping("/departments")
    public ResponseEntity<ApiResponse<Map<String, Object>>> departments() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, name, parent_id, manager_id, path FROM departments ORDER BY order_num, id", Map.of());
        List<Map<String, Object>> departments = rows.stream().map(r -> {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("id", r.get("id"));
            d.put("name", r.get("name"));
            d.put("parentId", r.get("parent_id"));
            d.put("managerId", r.get("manager_id"));
            d.put("path", r.get("path"));
            return d;
        }).toList();

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("rows", departments);
        data.put("total", departments.size());
        return ResponseEntity.ok(ApiResponse.ok(data));
    }
}
