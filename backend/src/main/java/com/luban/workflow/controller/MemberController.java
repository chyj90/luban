package com.luban.workflow.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.workflow.entity.Member;
import com.luban.workflow.repository.MemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/members")
@RequiredArgsConstructor
@RequirePermission(Permissions.PEOPLE_USERS)
public class MemberController {

    private final MemberRepository memberRepository;

    @GetMapping
    public ApiResponse<List<Member>> list(
            @RequestParam(required = false) Long departmentId,
            @RequestParam(required = false) String keyword) {
        if (keyword != null && !keyword.isEmpty()) {
            return ApiResponse.ok(memberRepository.findByNameContaining(keyword));
        }
        if (departmentId != null) {
            return ApiResponse.ok(memberRepository.findByDepartmentId(departmentId));
        }
        return ApiResponse.ok(memberRepository.findAll());
    }

    @GetMapping("/{id}")
    public ApiResponse<Member> get(@PathVariable Long id) {
        Member member = memberRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("成员不存在: " + id));
        return ApiResponse.ok(member);
    }

    @PutMapping("/{id}")
    public ApiResponse<Member> update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        Member member = memberRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("成员不存在: " + id));
        if (body.containsKey("name")) member.setName((String) body.get("name"));
        if (body.containsKey("email")) member.setEmail((String) body.get("email"));
        if (body.containsKey("mobile")) member.setMobile((String) body.get("mobile"));
        if (body.containsKey("position")) member.setPosition((String) body.get("position"));
        if (body.containsKey("employeeNo")) member.setEmployeeNo((String) body.get("employeeNo"));
        if (body.containsKey("departmentId")) {
            Object deptId = body.get("departmentId");
            member.setDepartmentId(deptId != null ? ((Number) deptId).longValue() : null);
        }
        memberRepository.save(member);
        return ApiResponse.ok(member);
    }
}