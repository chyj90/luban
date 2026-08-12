package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.dto.CreateAppRequest;
import com.luban.entity.Application;
import com.luban.service.ApplicationService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/applications")
public class ApplicationController {

    private final ApplicationService applicationService;

    public ApplicationController(ApplicationService applicationService) {
        this.applicationService = applicationService;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<Application>>> list(@RequestParam Long workspaceId) {
        return ResponseEntity.ok(ApiResponse.ok(applicationService.listByWorkspace(workspaceId)));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<Application>> getOne(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(applicationService.getById(id)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<Application>> create(@Valid @RequestBody CreateAppRequest request) {
        Application app = applicationService.create(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(app));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<Application>> update(@PathVariable Long id,
                                                            @RequestBody Map<String, String> request) {
        Application app = applicationService.update(id, request.get("name"));
        return ResponseEntity.ok(ApiResponse.ok(app));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        applicationService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}