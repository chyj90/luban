package com.luban.controller;

import com.luban.dto.*;
import com.luban.service.QueryService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/queries")
public class QueryController {

    private final QueryService queryService;

    public QueryController(QueryService queryService) {
        this.queryService = queryService;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> list(@RequestParam Long applicationId) {
        return ResponseEntity.ok(ApiResponse.ok(queryService.listByApplication(applicationId)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<Map<String, Object>>> create(
            @Valid @RequestBody CreateQueryRequest request) {
        Map<String, Object> query = queryService.create(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(query));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> update(
            @PathVariable Long id, @RequestBody UpdateQueryRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(queryService.update(id, request)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        queryService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PostMapping("/{id}/run")
    public ResponseEntity<ApiResponse<RunQueryResponse>> run(
            @PathVariable Long id, @RequestBody(required = false) RunQueryRequest request) {
        if (request == null) request = new RunQueryRequest();
        return ResponseEntity.ok(ApiResponse.ok(queryService.run(id, request)));
    }

    @PostMapping("/execute")
    public ResponseEntity<ApiResponse<RunQueryResponse>> execute(
            @RequestBody ExecuteSqlRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(
                queryService.executeSql(request.getDatasourceId(), request.getSql())));
    }
}