package com.luban.workflow.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.entity.User;
import com.luban.entity.UserDept;
import com.luban.repository.UserDeptRepository;
import com.luban.repository.UserRepository;
import com.luban.workflow.entity.Department;
import com.luban.workflow.repository.DepartmentRepository;
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
    private final UserRepository userRepository;
    private final UserDeptRepository userDeptRepository;

    private void populateManagerNames(List<Department> departments) {
        List<Long> managerIds = departments.stream()
                .map(Department::getManagerId)
                .filter(id -> id != null)
                .distinct()
                .collect(Collectors.toList());
        if (managerIds.isEmpty()) return;
        Map<Long, String> nameMap = userRepository.findAllById(managerIds).stream()
                .collect(Collectors.toMap(User::getId, User::getName));
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
            userRepository.findById(dept.getManagerId())
                    .ifPresent(u -> dept.setManagerName(u.getName()));
        }
        return ApiResponse.ok(dept);
    }

    @GetMapping("/{id}/members")
    public ApiResponse<List<User>> members(@PathVariable Long id) {
        List<Long> userIds = userDeptRepository.findByDepartmentId(id).stream()
                .map(UserDept::getUserId)
                .collect(Collectors.toList());
        return ApiResponse.ok(userRepository.findAllById(userIds));
    }

    @PostMapping
    public ApiResponse<Department> create(@RequestBody Department department) {
        department.setId(null);
        department.setProvider("local");
        department.setSyncedAt(java.time.LocalDateTime.now());
        Department saved = departmentRepository.save(department);
        if (saved.getManagerId() != null) {
            userRepository.findById(saved.getManagerId())
                    .ifPresent(u -> saved.setManagerName(u.getName()));
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
            userRepository.findById(saved.getManagerId())
                    .ifPresent(u -> saved.setManagerName(u.getName()));
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