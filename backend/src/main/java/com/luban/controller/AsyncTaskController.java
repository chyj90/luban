package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.entity.AsyncTask;
import com.luban.service.AsyncTaskService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/async-tasks")
@RequiredArgsConstructor
public class AsyncTaskController {

    private final AsyncTaskService asyncTaskService;

    @GetMapping("/pending")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<java.util.List<AsyncTask>>> listPendingTasks() {
        return ResponseEntity.ok(ApiResponse.ok(asyncTaskService.listPendingTasks()));
    }

    @GetMapping("/processed")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> listProcessedTasks(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        Page<AsyncTask> result = asyncTaskService.listProcessedTasks(page, size);
        return ResponseEntity.ok(ApiResponse.ok(Map.of(
                "content", result.getContent(),
                "totalElements", result.getTotalElements(),
                "totalPages", result.getTotalPages(),
                "page", result.getNumber(),
                "size", result.getSize()
        )));
    }

    @GetMapping("/{id}")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<AsyncTask>> getTask(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(asyncTaskService.getTask(id)));
    }

    @PutMapping("/{id}/mark-processed")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Void>> markProcessed(@PathVariable Long id) {
        asyncTaskService.markProcessed(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}