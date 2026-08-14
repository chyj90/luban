package com.luban.workflow.repository;

import com.luban.workflow.entity.Member;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface MemberRepository extends JpaRepository<Member, Long> {
    Optional<Member> findByUserId(Long userId);
    Optional<Member> findByEmail(String email);
    List<Member> findByDepartmentId(Long departmentId);
    List<Member> findByDepartmentIdIn(List<Long> departmentIds);
    List<Member> findByProvider(String provider);
    List<Member> findByNameContaining(String keyword);
    List<Member> findByStatus(String status);
}