package com.luban.workflow.controller;

import com.luban.constant.WorkflowScope;
import com.luban.entity.User;
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
        definition.setScope(WorkflowScope.APPLICATION);
        return processService.createDefinition(definition, user.getId());
    }

    @PutMapping("/{id}")
    public WorkflowDefinition updateDefinition(@PathVariable Long id, @RequestBody WorkflowDefinition definition, @AuthenticationPrincipal User user) {
        return processService.updateDefinition(id, definition, user.getId());
    }

    @PostMapping("/{id}/publish")
    public WorkflowDefinition publishDefinition(@PathVariable Long id, @AuthenticationPrincipal User user) {
        return processService.publishDefinition(id, user.getId());
    }

    @PostMapping("/{id}/unpublish")
    public WorkflowDefinition unpublishDefinition(@PathVariable Long id, @AuthenticationPrincipal User user) {
        return processService.unpublishDefinition(id, user.getId());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteDefinition(@PathVariable Long id, @AuthenticationPrincipal User user) {
        processService.deleteDefinition(id, user.getId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/validate")
    public Map<String, Object> validateDefinition(@PathVariable Long id) {
        return processService.validateWorkflow(id);
    }

    @PostMapping("/{id}/copy")
    public WorkflowDefinition copyDefinition(@PathVariable Long id, @AuthenticationPrincipal User user) {
        return processService.copyDefinition(id, user.getId());
    }

    @GetMapping("/{id}/versions")
    public List<WorkflowDefinition> getVersions(@PathVariable Long id) {
        return processService.getVersions(id);
    }
}