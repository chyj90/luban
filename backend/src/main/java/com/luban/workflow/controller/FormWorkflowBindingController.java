package com.luban.workflow.controller;

import com.luban.workflow.entity.FormWorkflowBinding;
import com.luban.workflow.service.FormWorkflowBindingService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/form-workflow-bindings")
@RequiredArgsConstructor
public class FormWorkflowBindingController {

    private final FormWorkflowBindingService bindingService;

    @GetMapping
    public List<FormWorkflowBinding> list(
            @RequestParam(required = false) Long formId,
            @RequestParam(required = false) Long workflowId,
            @RequestParam(required = false) Long applicationId) {
        if (formId != null) return bindingService.listByFormId(formId);
        if (workflowId != null) return bindingService.listByWorkflowId(workflowId);
        if (applicationId != null) return bindingService.listByApplicationId(applicationId);
        return List.of();
    }

    @GetMapping("/default")
    public FormWorkflowBinding getDefault(@RequestParam Long formId) {
        return bindingService.getDefaultForForm(formId);
    }

    @PostMapping
    public FormWorkflowBinding bind(@RequestBody Map<String, Object> params) {
        Long formId = Long.valueOf(params.get("formId").toString());
        Long workflowId = Long.valueOf(params.get("workflowId").toString());
        Integer workflowVersion = params.containsKey("workflowVersion") ?
                Integer.valueOf(params.get("workflowVersion").toString()) : null;
        String bindingType = params.getOrDefault("bindingType", "ONE_TO_ONE").toString();
        Boolean isDefault = Boolean.valueOf(params.getOrDefault("isDefault", false).toString());
        return bindingService.bind(formId, workflowId, workflowVersion, bindingType, isDefault);
    }

    @PutMapping("/{id}")
    public FormWorkflowBinding update(@PathVariable Long id, @RequestBody Map<String, Object> params) {
        Integer workflowVersion = params.containsKey("workflowVersion") ?
                Integer.valueOf(params.get("workflowVersion").toString()) : null;
        String bindingType = params.containsKey("bindingType") ? params.get("bindingType").toString() : null;
        Boolean isDefault = params.containsKey("isDefault") ?
                Boolean.valueOf(params.get("isDefault").toString()) : null;
        return bindingService.updateBinding(id, workflowVersion, bindingType, isDefault);
    }

    @PutMapping("/{id}/default")
    public ResponseEntity<Void> setDefault(@PathVariable Long id) {
        bindingService.setDefault(id);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> unbind(@PathVariable Long id) {
        bindingService.unbind(id);
        return ResponseEntity.noContent().build();
    }
}