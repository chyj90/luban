package com.luban.workflow.controller;

import com.luban.constant.WorkflowScope;
import com.luban.entity.User;
import com.luban.security.appaccess.AppAccess;
import com.luban.security.appaccess.AppAction;
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
    private final com.luban.security.appaccess.AppAccessService appAccessService;

    @GetMapping
    @AppAccess(action = AppAction.VIEW, from = AppAccess.Source.PARAM, key = "applicationId")
    public List<WorkflowDefinition> listDefinitions(
            @RequestParam(required = false) Long applicationId,
            @RequestParam(required = false) String status) {
        if (applicationId != null) return processService.listDefinitionsByApp(applicationId, status);
        return List.of();
    }

    @GetMapping("/{id}")
    @AppAccess(action = AppAction.VIEW, resource = "process", key = "id")
    public WorkflowDefinition getDefinition(@PathVariable Long id) {
        return processService.getDefinition(id);
    }

    @PostMapping
    @AppAccess(action = AppAction.DEVELOP, from = AppAccess.Source.BODY, key = "applicationId")
    public WorkflowDefinition createDefinition(@RequestBody WorkflowDefinition definition, @AuthenticationPrincipal User user) {
        // applicationId 为空 = 创建平台级流程（所有人可发起），需应用开发平台权限
        if (definition.getApplicationId() == null) {
            appAccessService.assertPlatformPermission(user.getId(), com.luban.constant.Permissions.APPS_READ);
        }
        definition.setCreatedBy(user.getId());
        definition.setScope(WorkflowScope.APPLICATION);
        return processService.createDefinition(definition, user.getId());
    }

    @PutMapping("/{id}")
    @AppAccess(action = AppAction.DEVELOP, resource = "process", key = "id")
    public WorkflowDefinition updateDefinition(@PathVariable Long id, @RequestBody WorkflowDefinition definition, @AuthenticationPrincipal User user) {
        return processService.updateDefinition(id, definition, user.getId());
    }

    @PostMapping("/{id}/publish")
    @AppAccess(action = AppAction.DEVELOP, resource = "process", key = "id")
    public WorkflowDefinition publishDefinition(@PathVariable Long id, @AuthenticationPrincipal User user) {
        return processService.publishDefinition(id, user.getId());
    }

    @PostMapping("/{id}/unpublish")
    @AppAccess(action = AppAction.DEVELOP, resource = "process", key = "id")
    public WorkflowDefinition unpublishDefinition(@PathVariable Long id, @AuthenticationPrincipal User user) {
        return processService.unpublishDefinition(id, user.getId());
    }

    @DeleteMapping("/{id}")
    @AppAccess(action = AppAction.DEVELOP, resource = "process", key = "id")
    public ResponseEntity<Void> deleteDefinition(@PathVariable Long id, @AuthenticationPrincipal User user) {
        processService.deleteDefinition(id, user.getId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/validate")
    @AppAccess(action = AppAction.VIEW, resource = "process", key = "id")
    public Map<String, Object> validateDefinition(@PathVariable Long id) {
        return processService.validateWorkflow(id);
    }

    @PostMapping("/{id}/copy")
    @AppAccess(action = AppAction.DEVELOP, resource = "process", key = "id")
    public WorkflowDefinition copyDefinition(@PathVariable Long id, @AuthenticationPrincipal User user) {
        return processService.copyDefinition(id, user.getId());
    }

    @GetMapping("/{id}/versions")
    @AppAccess(action = AppAction.VIEW, resource = "process", key = "id")
    public List<WorkflowDefinition> getVersions(@PathVariable Long id) {
        return processService.getVersions(id);
    }
}
