package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.dto.CreateToolGroupRequest;
import com.luban.entity.ToolGroup;
import com.luban.service.ToolGroupService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/tool-groups")
@RequiredArgsConstructor
public class ToolGroupController {

    private final ToolGroupService toolGroupService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<ToolGroup>>> list() {
        return ResponseEntity.ok(ApiResponse.ok(toolGroupService.listAll()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<ToolGroup>> get(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(toolGroupService.getById(id)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<ToolGroup>> create(@RequestBody CreateToolGroupRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(toolGroupService.create(request)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<ToolGroup>> update(@PathVariable Long id, @RequestBody CreateToolGroupRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(toolGroupService.update(id, request)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        toolGroupService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}