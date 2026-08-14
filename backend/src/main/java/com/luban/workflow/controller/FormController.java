package com.luban.workflow.controller;

import com.luban.entity.User;
import com.luban.workflow.entity.FormDefinition;
import com.luban.workflow.service.FormService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/forms")
@RequiredArgsConstructor
public class FormController {

    private final FormService formService;

    @GetMapping
    public List<FormDefinition> list(
            @RequestParam(required = false) Long applicationId) {
        if (applicationId != null) return formService.listByApplication(applicationId);
        return List.of();
    }

    @GetMapping("/{id}")
    public FormDefinition get(@PathVariable Long id) {
        return formService.getById(id);
    }

    @PostMapping
    public FormDefinition create(@RequestBody FormDefinition form, @AuthenticationPrincipal User user) {
        form.setCreatedBy(user.getId());
        return formService.create(form);
    }

    @PutMapping("/{id}")
    public FormDefinition update(@PathVariable Long id, @RequestBody FormDefinition form) {
        return formService.update(id, form);
    }

    @PostMapping("/{id}/publish")
    public FormDefinition publish(@PathVariable Long id) {
        return formService.publish(id);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        formService.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/copy")
    public FormDefinition copy(@PathVariable Long id) {
        return formService.copy(id);
    }

    @GetMapping("/{id}/preview")
    public Map<String, Object> preview(@PathVariable Long id) {
        return formService.getPreview(id);
    }
}