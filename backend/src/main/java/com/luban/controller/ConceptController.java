package com.luban.controller;

import com.luban.dto.*;
import com.luban.entity.Concept;
import com.luban.entity.ConceptRelation;
import com.luban.entity.ToolConcept;
import com.luban.service.ConceptService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/concepts")
@RequiredArgsConstructor
public class ConceptController {

    private final ConceptService conceptService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<Concept>>> list(@RequestParam(required = false) Long groupId,
                              @RequestParam(required = false) String keyword) {
        return ResponseEntity.ok(ApiResponse.ok(conceptService.list(groupId, keyword)));
    }

    @GetMapping("/tree")
    public ResponseEntity<ApiResponse<List<ConceptTreeResponse>>> tree(@RequestParam(required = false) Long groupId) {
        return ResponseEntity.ok(ApiResponse.ok(conceptService.getTree(groupId)));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<ConceptDetailResponse>> get(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(conceptService.getById(id)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<Concept>> create(@RequestBody CreateConceptRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(conceptService.create(request)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<Concept>> update(@PathVariable Long id, @RequestBody CreateConceptRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(conceptService.update(id, request)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        conceptService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @GetMapping("/{id}/relations")
    public ResponseEntity<ApiResponse<List<ConceptRelation>>> getRelations(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(conceptService.getRelations(id)));
    }

    @PostMapping("/{id}/relations")
    public ResponseEntity<ApiResponse<ConceptRelation>> createRelation(@PathVariable Long id,
                                           @RequestBody CreateRelationRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(conceptService.createRelation(id, request)));
    }

    @PutMapping("/{id}/relations/{relId}")
    public ResponseEntity<ApiResponse<ConceptRelation>> updateRelation(@PathVariable Long id,
                                           @PathVariable Long relId,
                                           @RequestBody CreateRelationRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(conceptService.updateRelation(relId, request)));
    }

    @DeleteMapping("/{id}/relations/{relId}")
    public ResponseEntity<ApiResponse<Void>> deleteRelation(@PathVariable Long id, @PathVariable Long relId) {
        conceptService.deleteRelation(relId);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @GetMapping("/{id}/tools")
    public ResponseEntity<ApiResponse<List<ToolConcept>>> getConceptTools(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(conceptService.getConceptTools(id)));
    }
}