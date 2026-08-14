package com.luban.workflow.controller;

import com.luban.workflow.entity.Department;
import com.luban.workflow.entity.Member;
import com.luban.workflow.repository.DepartmentRepository;
import com.luban.workflow.repository.MemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/v1/departments")
@RequiredArgsConstructor
public class DepartmentController {

    private final DepartmentRepository departmentRepository;
    private final MemberRepository memberRepository;

    @GetMapping
    public List<Department> list(@RequestParam(required = false) Long parentId) {
        if (parentId != null) {
            return departmentRepository.findByParentId(parentId);
        }
        return departmentRepository.findByParentIdIsNull();
    }

    @GetMapping("/tree")
    public List<Department> tree() {
        return departmentRepository.findAll();
    }

    @GetMapping("/{id}")
    public Department get(@PathVariable Long id) {
        return departmentRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("部门不存在: " + id));
    }

    @GetMapping("/{id}/members")
    public List<Member> members(@PathVariable Long id) {
        return memberRepository.findByDepartmentId(id);
    }
}