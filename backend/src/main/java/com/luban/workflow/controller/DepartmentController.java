package com.luban.workflow.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.workflow.entity.Department;
import com.luban.workflow.entity.Member;
import com.luban.workflow.repository.DepartmentRepository;
import com.luban.workflow.repository.MemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/departments")
@RequiredArgsConstructor
@RequirePermission(Permissions.PEOPLE_ORG)
public class DepartmentController {

    private final DepartmentRepository departmentRepository;
    private final MemberRepository memberRepository;

    private void populateManagerNames(List<Department> departments) {
        List<Long> managerIds = departments.stream()
                .map(Department::getManagerId)
                .filter(id -> id != null)
                .distinct()
                .collect(Collectors.toList());
        if (managerIds.isEmpty()) return;
        Map<Long, String> nameMap = memberRepository.findAllById(managerIds).stream()
                .collect(Collectors.toMap(Member::getId, Member::getName));
        departments.forEach(d -> {
            if (d.getManagerId() != null) {
                d.setManagerName(nameMap.get(d.getManagerId()));
            }
        });
    }

    @GetMapping
    public ApiResponse<List<Department>> list(@RequestParam(required = false) Long parentId) {
        List<Department> departments;
        if (parentId != null) {
            departments = departmentRepository.findByParentId(parentId);
        } else {
            departments = departmentRepository.findAll();
        }
        populateManagerNames(departments);
        return ApiResponse.ok(departments);
    }

    @GetMapping("/tree")
    public ApiResponse<List<Department>> tree() {
        List<Department> departments = departmentRepository.findAll();
        populateManagerNames(departments);
        return ApiResponse.ok(departments);
    }

    @GetMapping("/{id}")
    public ApiResponse<Department> get(@PathVariable Long id) {
        Department dept = departmentRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("部门不存在: " + id));
        if (dept.getManagerId() != null) {
            memberRepository.findById(dept.getManagerId())
                    .ifPresent(m -> dept.setManagerName(m.getName()));
        }
        return ApiResponse.ok(dept);
    }

    @GetMapping("/{id}/members")
    public ApiResponse<List<Member>> members(@PathVariable Long id) {
        return ApiResponse.ok(memberRepository.findByDepartmentId(id));
    }

    @PostMapping
    public ApiResponse<Department> create(@RequestBody Department department) {
        department.setId(null);
        department.setProvider("local");
        department.setSyncedAt(java.time.LocalDateTime.now());
        Department saved = departmentRepository.save(department);
        if (saved.getManagerId() != null) {
            memberRepository.findById(saved.getManagerId())
                    .ifPresent(m -> saved.setManagerName(m.getName()));
        }
        return ApiResponse.ok(saved);
    }

    @PutMapping("/{id}")
    public ApiResponse<Department> update(@PathVariable Long id, @RequestBody Department department) {
        Department existing = departmentRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("部门不存在: " + id));
        if (department.getName() != null) existing.setName(department.getName());
        if (department.getParentId() != null) existing.setParentId(department.getParentId());
        existing.setManagerId(department.getManagerId());
        Department saved = departmentRepository.save(existing);
        if (saved.getManagerId() != null) {
            memberRepository.findById(saved.getManagerId())
                    .ifPresent(m -> saved.setManagerName(m.getName()));
        }
        return ApiResponse.ok(saved);
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        if (!departmentRepository.existsById(id)) {
            throw new RuntimeException("部门不存在: " + id);
        }
        departmentRepository.deleteById(id);
        return ApiResponse.ok(null);
    }
}