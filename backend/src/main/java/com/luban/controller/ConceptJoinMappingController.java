package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.entity.ConceptJoinMapping;
import com.luban.service.ConceptJoinMappingService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/concepts/{conceptId}/join-mappings")
@RequiredArgsConstructor
@RequirePermission(Permissions.CONNECT_CONCEPTS)
public class ConceptJoinMappingController {

    private final ConceptJoinMappingService joinMappingService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<ConceptJoinMapping>>> listByConcept(
            @PathVariable Long conceptId,
            @RequestParam(required = false) Long datasourceId) {
        if (datasourceId != null) {
            return ResponseEntity.ok(ApiResponse.ok(joinMappingService.listByConceptAndDatasource(conceptId, datasourceId)));
        }
        return ResponseEntity.ok(ApiResponse.ok(joinMappingService.listByConcept(conceptId)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<ConceptJoinMapping>> create(@PathVariable Long conceptId,
            @RequestBody ConceptJoinMapping mapping) {
        mapping.setConceptId(conceptId);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(joinMappingService.create(mapping)));
    }

    @PutMapping("/{mappingId}")
    public ResponseEntity<ApiResponse<ConceptJoinMapping>> update(@PathVariable Long conceptId,
            @PathVariable Long mappingId, @RequestBody ConceptJoinMapping mapping) {
        return ResponseEntity.ok(ApiResponse.ok(joinMappingService.update(mappingId, mapping)));
    }

    @DeleteMapping("/{mappingId}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long conceptId, @PathVariable Long mappingId) {
        joinMappingService.delete(mappingId);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}