package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.entity.User;
import com.luban.entity.Workspace;
import com.luban.service.WorkspaceService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/workspaces")
public class WorkspaceController {

    private final WorkspaceService workspaceService;

    public WorkspaceController(WorkspaceService workspaceService) {
        this.workspaceService = workspaceService;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<Workspace>>> list(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(ApiResponse.ok(workspaceService.listByOwner(user.getId())));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<Workspace>> create(@AuthenticationPrincipal User user,
                                                          @RequestBody Map<String, String> request) {
        Workspace workspace = workspaceService.create(request.get("name"), user.getId());
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(workspace));
    }
}