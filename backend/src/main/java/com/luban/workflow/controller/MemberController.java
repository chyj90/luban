package com.luban.workflow.controller;

import com.luban.workflow.entity.Member;
import com.luban.workflow.repository.MemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/v1/members")
@RequiredArgsConstructor
public class MemberController {

    private final MemberRepository memberRepository;

    @GetMapping
    public List<Member> list(
            @RequestParam(required = false) Long departmentId,
            @RequestParam(required = false) String keyword) {
        if (keyword != null && !keyword.isEmpty()) {
            return memberRepository.findByNameContaining(keyword);
        }
        if (departmentId != null) {
            return memberRepository.findByDepartmentId(departmentId);
        }
        return memberRepository.findAll();
    }

    @GetMapping("/{id}")
    public Member get(@PathVariable Long id) {
        return memberRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("成员不存在: " + id));
    }
}