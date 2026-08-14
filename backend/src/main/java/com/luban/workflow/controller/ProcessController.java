package com.luban.workflow.controller;

import com.luban.entity.User;
import com.luban.workflow.config.TestDataService;
import com.luban.workflow.entity.*;
import com.luban.workflow.service.ProcessService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/workflows")
@RequiredArgsConstructor
public class ProcessController {

    private final ProcessService processService;
    private final TestDataService testDataService;

    @GetMapping
    public List<WorkflowDefinition> listDefinitions(
            @RequestParam(required = false) Long applicationId,
            @RequestParam(required = false) String status) {
        if (applicationId != null) return processService.listDefinitionsByApp(applicationId, status);
        return List.of();
    }

    @GetMapping("/{id}")
    public WorkflowDefinition getDefinition(@PathVariable Long id) {
        return processService.getDefinition(id);
    }

    @PostMapping
    public WorkflowDefinition createDefinition(@RequestBody WorkflowDefinition definition, @AuthenticationPrincipal User user) {
        definition.setCreatedBy(user.getId());
        return processService.createDefinition(definition);
    }

    @PutMapping("/{id}")
    public WorkflowDefinition updateDefinition(@PathVariable Long id, @RequestBody WorkflowDefinition definition) {
        return processService.updateDefinition(id, definition);
    }

    @PostMapping("/{id}/publish")
    public WorkflowDefinition publishDefinition(@PathVariable Long id) {
        return processService.publishDefinition(id);
    }

    @PostMapping("/{id}/unpublish")
    public WorkflowDefinition unpublishDefinition(@PathVariable Long id) {
        return processService.unpublishDefinition(id);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteDefinition(@PathVariable Long id) {
        processService.deleteDefinition(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/validate")
    public Map<String, Object> validateDefinition(@PathVariable Long id) {
        return processService.validateWorkflow(id);
    }

    @PostMapping("/{id}/copy")
    public WorkflowDefinition copyDefinition(@PathVariable Long id) {
        return processService.copyDefinition(id);
    }

    @GetMapping("/{id}/versions")
    public List<WorkflowDefinition> getVersions(@PathVariable Long id) {
        return processService.getVersions(id);
    }

    @PostMapping("/test-data/init")
    public Map<String, Object> initTestData(@RequestParam Long applicationId) {
        testDataService.initApplicationRoles(applicationId);
        return Map.of("success", true, "applicationId", applicationId);
    }

    @PostMapping("/test-data/reset")
    public Map<String, Object> resetTestData(@RequestParam Long applicationId) {
        testDataService.resetApplicationRoles(applicationId);
        return Map.of("success", true, "applicationId", applicationId);
    }
}