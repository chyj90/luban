package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.OntologyOperationType.BuiltinRelation;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.entity.OntologyGroup;
import com.luban.service.OntologyGroupService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/ontology-groups")
@RequiredArgsConstructor
@RequirePermission(Permissions.CONNECT_CONCEPTS)
public class OntologyGroupController {

    private final OntologyGroupService groupService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<OntologyGroup>>> list(@RequestParam(required = false) Long industryId) {
        if (industryId != null) {
            return ResponseEntity.ok(ApiResponse.ok(groupService.listByIndustry(industryId)));
        }
        return ResponseEntity.ok(ApiResponse.ok(groupService.list()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<OntologyGroup>> get(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(groupService.getById(id)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<OntologyGroup>> create(@RequestBody OntologyGroup group) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(groupService.create(group)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<OntologyGroup>> update(@PathVariable Long id, @RequestBody OntologyGroup group) {
        return ResponseEntity.ok(ApiResponse.ok(groupService.update(id, group)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        groupService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @GetMapping("/builtin-relation-types")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> builtinRelationTypes() {
        return ResponseEntity.ok(ApiResponse.ok(BuiltinRelation.toApiList()));
    }
}