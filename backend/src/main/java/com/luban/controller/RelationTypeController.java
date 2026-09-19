package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.OntologyOperationType.BuiltinRelation;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.entity.RelationType;
import com.luban.repository.RelationTypeRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.NoSuchElementException;

/**
 * 全局关系类型注册表管理。内置类型（BuiltinRelation）启动时自动播种，不可删除；
 * 自定义类型可手工添加，或由本体变更/导入链路自动注册。
 */
@RestController
@RequestMapping("/api/v1/relation-types")
@RequiredArgsConstructor
@RequirePermission(Permissions.CONNECT_CONCEPTS)
public class RelationTypeController {

    private final RelationTypeRepository relationTypeRepository;

    @GetMapping
    public ResponseEntity<ApiResponse<List<RelationType>>> list() {
        return ResponseEntity.ok(ApiResponse.ok(relationTypeRepository.findAll()));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<RelationType>> create(@RequestBody RelationType relationType) {
        if (relationType.getRelationType() == null || relationType.getRelationType().isBlank()) {
            throw new IllegalArgumentException("关系类型标识不能为空");
        }
        String type = relationType.getRelationType().trim();
        if (relationTypeRepository.existsByRelationType(type)) {
            throw new IllegalArgumentException("关系类型已存在: " + type);
        }
        relationType.setRelationType(type);
        relationType.setIsBuiltin(false);
        if (relationType.getLabel() == null || relationType.getLabel().isBlank()) {
            relationType.setLabel(type);
        }
        if (relationType.getColor() == null || relationType.getColor().isBlank()) {
            relationType.setColor("#999999");
        }
        if (relationType.getSortOrder() == null) {
            relationType.setSortOrder((int) relationTypeRepository.count());
        }
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(relationTypeRepository.save(relationType)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<RelationType>> update(@PathVariable Long id, @RequestBody RelationType updated) {
        RelationType existing = relationTypeRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("关系类型不存在: " + id));
        if (updated.getDescription() != null) existing.setDescription(updated.getDescription());
        if (updated.getLabel() != null) existing.setLabel(updated.getLabel());
        if (updated.getColor() != null) existing.setColor(updated.getColor());
        if (updated.getSourceRole() != null) existing.setSourceRole(updated.getSourceRole());
        if (updated.getTargetRole() != null) existing.setTargetRole(updated.getTargetRole());
        if (updated.getSourceToTarget() != null) existing.setSourceToTarget(updated.getSourceToTarget());
        if (updated.getIsTransitive() != null) existing.setIsTransitive(updated.getIsTransitive());
        if (updated.getIsSymmetric() != null) existing.setIsSymmetric(updated.getIsSymmetric());
        if (updated.getSortOrder() != null) existing.setSortOrder(updated.getSortOrder());
        return ResponseEntity.ok(ApiResponse.ok(relationTypeRepository.save(existing)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        RelationType relationType = relationTypeRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("关系类型不存在: " + id));
        if (Boolean.TRUE.equals(relationType.getIsBuiltin())) {
            throw new IllegalArgumentException("内置关系不允许删除: " + relationType.getRelationType());
        }
        relationTypeRepository.delete(relationType);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @GetMapping("/builtin")
    public ResponseEntity<ApiResponse<List<BuiltinRelationDef>>> builtins() {
        return ResponseEntity.ok(ApiResponse.ok(List.of(BuiltinRelation.values()).stream()
                .map(r -> new BuiltinRelationDef(r.name(), r.description(), r.label(), r.color(),
                        r.sourceRole(), r.targetRole(), r.sourceToTarget(), r.isTransitive(), r.isSymmetric(), r.sortOrder()))
                .toList()));
    }

    public record BuiltinRelationDef(String name, String description, String label, String color,
                                     String sourceRole, String targetRole, boolean sourceToTarget,
                                     boolean transitive, boolean symmetric, int sortOrder) {}
}
