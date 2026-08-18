package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.dto.CreateToolConceptRequest;
import com.luban.dto.CreateToolRequest;
import com.luban.entity.ToolConcept;
import com.luban.entity.ToolDefinition;
import com.luban.entity.User;
import com.luban.service.ConceptService;
import com.luban.service.ToolService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/tools")
@RequiredArgsConstructor
public class ToolController {

    private final ToolService toolService;
    private final ConceptService conceptService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<ToolDefinition>>> list(@RequestParam(required = false) Long groupId,
                                     @RequestParam(required = false) String toolType) {
        if (groupId != null) {
            return ResponseEntity.ok(ApiResponse.ok(toolService.listByGroup(groupId)));
        }
        if (toolType != null) {
            return ResponseEntity.ok(ApiResponse.ok(toolService.listByType(toolType)));
        }
        return ResponseEntity.ok(ApiResponse.ok(List.of()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<ToolDefinition>> get(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(toolService.getById(id)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<ToolDefinition>> create(@RequestBody CreateToolRequest request,
                                  @AuthenticationPrincipal User user) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(toolService.create(request, user.getId())));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<ToolDefinition>> update(@PathVariable Long id, @RequestBody CreateToolRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(toolService.update(id, request)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        toolService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @GetMapping("/{toolId}/concepts")
    public ResponseEntity<ApiResponse<List<ToolConcept>>> getToolConcepts(@PathVariable Long toolId) {
        return ResponseEntity.ok(ApiResponse.ok(conceptService.getToolConcepts(toolId)));
    }

    @PostMapping("/{toolId}/concepts")
    public ResponseEntity<ApiResponse<ToolConcept>> bindConcept(@PathVariable Long toolId,
                                    @RequestBody CreateToolConceptRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(conceptService.bindToolConcept(toolId, request)));
    }

    @DeleteMapping("/{toolId}/concepts/{bindId}")
    public ResponseEntity<ApiResponse<Void>> unbindConcept(@PathVariable Long toolId, @PathVariable Long bindId) {
        conceptService.unbindToolConcept(bindId);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}