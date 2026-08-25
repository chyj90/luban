package com.luban.repository;

import com.luban.entity.User;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByEmail(String email);
    Optional<User> findByAccount(String account);
    boolean existsByEmail(String email);
    Optional<User> findFirstByOrderByIdAsc();
    Page<User> findByAccountContainingIgnoreCaseOrEmailContainingIgnoreCase(String account, String email, Pageable pageable);

    @Query(value = """
        SELECT
            u.id AS id,
            u.name AS displayName,
            u.email AS email,
            u.mobile AS mobile,
            u.position AS position,
            u.employee_no AS employeeNo,
            ud.department_id AS deptId,
            COALESCE(ud.department_name, d.name) AS deptName,
            ud.leader_id AS leaderId,
            u.id AS userId,
            u.account AS account,
            u.created_at AS createdAt,
            platform_role.role_id AS roleId,
            platform_role.role_name AS roleName,
            platform_role.role_ids AS roleIds,
            TRUE AS hasAccount
        FROM users u
        LEFT JOIN user_dept ud ON ud.user_id = u.id AND ud.is_primary = TRUE
        LEFT JOIN departments d ON d.id = ud.department_id
        LEFT JOIN (
            SELECT ru.user_id, MIN(r.id) AS role_id, GROUP_CONCAT(r.name ORDER BY r.id SEPARATOR ', ') AS role_name, GROUP_CONCAT(r.id ORDER BY r.id SEPARATOR ',') AS role_ids
            FROM role_users ru
            JOIN workflow_roles r ON r.id = ru.role_id AND r.scope = 'PLATFORM'
            GROUP BY ru.user_id
        ) platform_role ON platform_role.user_id = u.id
        WHERE (:keyword IS NULL OR u.name LIKE CONCAT('%', :keyword, '%') OR u.account LIKE CONCAT('%', :keyword, '%') OR u.email LIKE CONCAT('%', :keyword, '%'))
          AND (:accountFilter IS NULL OR
            (:accountFilter = 'has' AND u.id IS NOT NULL) OR
            (:accountFilter = 'none' AND u.id IS NULL))
        ORDER BY u.id
        LIMIT :limit OFFSET :offset
        """, nativeQuery = true)
    List<Object[]> findUsersWithDeptInfoPage(
            @Param("keyword") String keyword,
            @Param("accountFilter") String accountFilter,
            @Param("limit") int limit,
            @Param("offset") int offset);

    @Query(value = """
        SELECT COUNT(*)
        FROM users u
        LEFT JOIN user_dept ud ON ud.user_id = u.id AND ud.is_primary = TRUE
        WHERE (:keyword IS NULL OR u.name LIKE CONCAT('%', :keyword, '%') OR u.account LIKE CONCAT('%', :keyword, '%') OR u.email LIKE CONCAT('%', :keyword, '%'))
          AND (:accountFilter IS NULL OR
            (:accountFilter = 'has' AND u.id IS NOT NULL) OR
            (:accountFilter = 'none' AND u.id IS NULL))
        """, nativeQuery = true)
    long countUsersWithDeptInfo(
            @Param("keyword") String keyword,
            @Param("accountFilter") String accountFilter);

    @Query(value = """
        SELECT
            u.id AS id,
            u.name AS displayName,
            u.email AS email,
            u.mobile AS mobile,
            u.position AS position,
            u.employee_no AS employeeNo,
            ud.department_id AS deptId,
            COALESCE(ud.department_name, d.name) AS deptName,
            ud.leader_id AS leaderId,
            u.id AS userId,
            u.account AS account,
            u.created_at AS createdAt,
            platform_role.role_id AS roleId,
            platform_role.role_name AS roleName,
            platform_role.role_ids AS roleIds,
            TRUE AS hasAccount
        FROM users u
        LEFT JOIN user_dept ud ON ud.user_id = u.id AND ud.is_primary = TRUE
        LEFT JOIN departments d ON d.id = ud.department_id
        LEFT JOIN (
            SELECT ru.user_id, MIN(r.id) AS role_id, GROUP_CONCAT(r.name ORDER BY r.id SEPARATOR ', ') AS role_name, GROUP_CONCAT(r.id ORDER BY r.id SEPARATOR ',') AS role_ids
            FROM role_users ru
            JOIN workflow_roles r ON r.id = ru.role_id AND r.scope = 'PLATFORM'
            GROUP BY ru.user_id
        ) platform_role ON platform_role.user_id = u.id
        ORDER BY u.id
        """, nativeQuery = true)
    List<Object[]> findAllUsersWithDeptInfo();
}