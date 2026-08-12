package com.luban.controller;

import com.luban.dto.*;
import com.luban.service.DatasourceService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/datasources")
public class DatasourceController {

    private final DatasourceService datasourceService;

    public DatasourceController(DatasourceService datasourceService) {
        this.datasourceService = datasourceService;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> list(
            @RequestParam Long applicationId) {
        return ResponseEntity.ok(ApiResponse.ok(datasourceService.listByApplication(applicationId)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<Map<String, Object>>> create(
            @Valid @RequestBody CreateDatasourceRequest request) {
        Map<String, Object> ds = datasourceService.create(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(ds));
    }

    @PostMapping("/{id}/test")
    public ResponseEntity<ApiResponse<TestDatasourceResponse>> test(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(datasourceService.test(id)));
    }

    @GetMapping("/{id}/structure")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getStructure(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(datasourceService.getStructure(id)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        datasourceService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> update(
            @PathVariable Long id,
            @Valid @RequestBody CreateDatasourceRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(datasourceService.update(id, request)));
    }
}