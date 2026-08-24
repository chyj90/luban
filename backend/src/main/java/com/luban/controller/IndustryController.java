package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.entity.Industry;
import com.luban.entity.IndustryRelation;
import com.luban.service.IndustryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/industries")
@RequiredArgsConstructor
@RequirePermission(Permissions.CONNECT_CONCEPTS)
public class IndustryController {

    private final IndustryService industryService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<Industry>>> list() {
        return ResponseEntity.ok(ApiResponse.ok(industryService.list()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<Industry>> get(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(industryService.getById(id)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<Industry>> create(@RequestBody Industry industry) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(industryService.create(industry)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<Industry>> update(@PathVariable Long id, @RequestBody Industry industry) {
        return ResponseEntity.ok(ApiResponse.ok(industryService.update(id, industry)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        industryService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @GetMapping("/{id}/relations")
    public ResponseEntity<ApiResponse<List<IndustryRelation>>> getRelations(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(industryService.getRelations(id)));
    }

    @PutMapping("/{id}/relations")
    public ResponseEntity<ApiResponse<List<IndustryRelation>>> saveRelations(
            @PathVariable Long id, @RequestBody List<IndustryRelation> relations) {
        return ResponseEntity.ok(ApiResponse.ok(industryService.saveRelations(id, relations)));
    }

    @PostMapping("/{id}/relations")
    public ResponseEntity<ApiResponse<IndustryRelation>> addRelation(
            @PathVariable Long id, @RequestBody IndustryRelation relation) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(industryService.addRelation(id, relation)));
    }

    @PostMapping("/{id}/relations/batch")
    public ResponseEntity<ApiResponse<List<IndustryRelation>>> addRelationsBatch(
            @PathVariable Long id, @RequestBody List<String> relationTypes) {
        List<IndustryRelation> result = new java.util.ArrayList<>();
        for (String type : relationTypes) {
            IndustryRelation relation = new IndustryRelation();
            relation.setRelationType(type);
            result.add(industryService.addRelation(id, relation));
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(result));
    }

    @DeleteMapping("/{id}/relations/{relationId}")
    public ResponseEntity<ApiResponse<Void>> deleteRelation(
            @PathVariable Long id, @PathVariable Long relationId) {
        industryService.deleteRelation(relationId);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}