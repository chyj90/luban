package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.entity.ConceptMapping;
import com.luban.service.ConceptMappingService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/concepts/{conceptId}/mappings")
@RequiredArgsConstructor
@RequirePermission(Permissions.CONNECT_CONCEPTS)
public class ConceptMappingController {

    private final ConceptMappingService mappingService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<ConceptMapping>>> listByConcept(
            @PathVariable Long conceptId,
            @RequestParam(required = false) Long datasourceId) {
        if (datasourceId != null) {
            return ResponseEntity.ok(ApiResponse.ok(mappingService.listByConceptAndDatasource(conceptId, datasourceId)));
        }
        return ResponseEntity.ok(ApiResponse.ok(mappingService.listByConcept(conceptId)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<ConceptMapping>> create(@PathVariable Long conceptId,
            @RequestBody ConceptMapping mapping) {
        mapping.setConceptId(conceptId);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(mappingService.create(mapping)));
    }

    @PutMapping("/{mappingId}")
    public ResponseEntity<ApiResponse<ConceptMapping>> update(@PathVariable Long conceptId,
            @PathVariable Long mappingId, @RequestBody ConceptMapping mapping) {
        return ResponseEntity.ok(ApiResponse.ok(mappingService.update(mappingId, mapping)));
    }

    @DeleteMapping("/{mappingId}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long conceptId, @PathVariable Long mappingId) {
        mappingService.delete(mappingId);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PostMapping("/batch")
    public ResponseEntity<ApiResponse<List<ConceptMapping>>> batchSave(@PathVariable Long conceptId,
            @RequestBody List<ConceptMapping> mappings) {
        mappings.forEach(m -> m.setConceptId(conceptId));
        return ResponseEntity.ok(ApiResponse.ok(mappingService.batchSave(mappings)));
    }
}