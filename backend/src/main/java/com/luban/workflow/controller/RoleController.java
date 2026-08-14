package com.luban.workflow.controller;

import com.luban.workflow.entity.*;
import com.luban.workflow.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/v1/roles")
@RequiredArgsConstructor
public class RoleController {

    private final RoleRepository roleRepository;

    @GetMapping
    public List<Role> list(@RequestParam Long workspaceId) {
        return roleRepository.findByWorkspaceId(workspaceId);
    }

    @GetMapping("/{id}")
    public Role get(@PathVariable Long id) {
        return roleRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("角色不存在: " + id));
    }

    @PostMapping
    public Role create(@RequestBody Role role) {
        return roleRepository.save(role);
    }

    @PutMapping("/{id}")
    public Role update(@PathVariable Long id, @RequestBody Role role) {
        Role existing = roleRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("角色不存在: " + id));
        if (role.getName() != null) existing.setName(role.getName());
        if (role.getDescription() != null) existing.setDescription(role.getDescription());
        if (role.getMemberIds() != null) existing.setMemberIds(role.getMemberIds());
        return roleRepository.save(existing);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        roleRepository.deleteById(id);
        return ResponseEntity.noContent().build();
    }
}