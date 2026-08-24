package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.entity.ConceptToolBinding;
import com.luban.service.ConceptToolBindingService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequiredArgsConstructor
public class ConceptToolBindingController {

    private final ConceptToolBindingService bindingService;

    @GetMapping("/api/v1/concepts/{conceptId}/tool-bindings")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<List<ConceptToolBinding>>> listByConcept(@PathVariable Long conceptId,
            @RequestParam(required = false) String bindingType) {
        if (bindingType != null) {
            return ResponseEntity.ok(ApiResponse.ok(bindingService.listByConceptAndType(conceptId, bindingType)));
        }
        return ResponseEntity.ok(ApiResponse.ok(bindingService.listByConcept(conceptId)));
    }

    @GetMapping("/api/v1/tools/{toolId}/concept-bindings")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<List<ConceptToolBinding>>> listByTool(@PathVariable Long toolId) {
        return ResponseEntity.ok(ApiResponse.ok(bindingService.listByTool(toolId)));
    }

    @PostMapping("/api/v1/concepts/{conceptId}/tool-bindings")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<ConceptToolBinding>> create(@PathVariable Long conceptId,
            @RequestBody ConceptToolBinding binding) {
        binding.setConceptId(conceptId);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(bindingService.create(binding)));
    }

    @DeleteMapping("/api/v1/concepts/{conceptId}/tool-bindings/{bindingId}")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long conceptId, @PathVariable Long bindingId) {
        bindingService.delete(bindingId);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}