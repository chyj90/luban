package com.luban.workflow.repository;

import com.luban.workflow.entity.Member;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;

public interface MemberRepository extends JpaRepository<Member, Long> {
    Optional<Member> findByUserId(Long userId);
    List<Member> findByUserIdIn(List<Long> userIds);
    Optional<Member> findByEmail(String email);
    List<Member> findByDepartmentId(Long departmentId);
    List<Member> findByDepartmentIdIn(List<Long> departmentIds);
    List<Member> findByProvider(String provider);
    List<Member> findByNameContaining(String keyword);
    List<Member> findByStatus(String status);

    @Query(value = """
        SELECT
            m.id AS id,
            m.name AS displayName,
            m.email AS email,
            m.mobile AS mobile,
            m.position AS position,
            m.employee_no AS employeeNo,
            m.department_id AS deptId,
            d.name AS deptName,
            m.leader_id AS leaderId,
            u.id AS userId,
            u.account AS account,
            u.created_at AS createdAt,
            platform_role.role_id AS roleId,
            platform_role.role_name AS roleName,
            platform_role.role_ids AS roleIds,
            CASE WHEN u.id IS NOT NULL THEN TRUE ELSE FALSE END AS hasAccount
        FROM members m
        LEFT JOIN users u ON u.id = m.user_id
        LEFT JOIN (
            SELECT ru.user_id, MIN(r.id) AS role_id, GROUP_CONCAT(r.name ORDER BY r.id SEPARATOR ', ') AS role_name, GROUP_CONCAT(r.id ORDER BY r.id SEPARATOR ',') AS role_ids
            FROM role_users ru
            JOIN workflow_roles r ON r.id = ru.role_id AND r.scope = 'PLATFORM'
            GROUP BY ru.user_id
        ) platform_role ON platform_role.user_id = u.id
        LEFT JOIN departments d ON d.id = m.department_id
        WHERE (:keyword IS NULL OR m.name LIKE CONCAT('%', :keyword, '%') OR u.account LIKE CONCAT('%', :keyword, '%') OR m.email LIKE CONCAT('%', :keyword, '%'))
          AND (:accountFilter IS NULL OR
            (:accountFilter = 'has' AND u.id IS NOT NULL) OR
            (:accountFilter = 'none' AND u.id IS NULL))
        ORDER BY m.id
        LIMIT :limit OFFSET :offset
        """, nativeQuery = true)
    List<Object[]> findMembersWithUserInfoPage(
            @Param("keyword") String keyword,
            @Param("accountFilter") String accountFilter,
            @Param("limit") int limit,
            @Param("offset") int offset);

    @Query(value = """
        SELECT COUNT(*)
        FROM members m
        LEFT JOIN users u ON u.id = m.user_id
        WHERE (:keyword IS NULL OR m.name LIKE CONCAT('%', :keyword, '%') OR u.account LIKE CONCAT('%', :keyword, '%') OR m.email LIKE CONCAT('%', :keyword, '%'))
          AND (:accountFilter IS NULL OR
            (:accountFilter = 'has' AND u.id IS NOT NULL) OR
            (:accountFilter = 'none' AND u.id IS NULL))
        """, nativeQuery = true)
    long countMembersWithUserInfo(
            @Param("keyword") String keyword,
            @Param("accountFilter") String accountFilter);

    @Query(value = """
        SELECT
            m.id AS id,
            m.name AS displayName,
            m.email AS email,
            m.mobile AS mobile,
            m.position AS position,
            m.employee_no AS employeeNo,
            m.department_id AS deptId,
            d.name AS deptName,
            m.leader_id AS leaderId,
            u.id AS userId,
            u.account AS account,
            u.created_at AS createdAt,
            platform_role.role_id AS roleId,
            platform_role.role_name AS roleName,
            platform_role.role_ids AS roleIds,
            CASE WHEN u.id IS NOT NULL THEN TRUE ELSE FALSE END AS hasAccount
        FROM members m
        LEFT JOIN users u ON u.id = m.user_id
        LEFT JOIN (
            SELECT ru.user_id, MIN(r.id) AS role_id, GROUP_CONCAT(r.name ORDER BY r.id SEPARATOR ', ') AS role_name, GROUP_CONCAT(r.id ORDER BY r.id SEPARATOR ',') AS role_ids
            FROM role_users ru
            JOIN workflow_roles r ON r.id = ru.role_id AND r.scope = 'PLATFORM'
            GROUP BY ru.user_id
        ) platform_role ON platform_role.user_id = u.id
        LEFT JOIN departments d ON d.id = m.department_id
        ORDER BY m.id
        """, nativeQuery = true)
    List<Object[]> findAllMembersWithUserInfo();
}