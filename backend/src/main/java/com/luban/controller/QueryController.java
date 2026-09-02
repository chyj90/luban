package com.luban.controller;

import com.luban.dto.*;
import com.luban.entity.Application;
import com.luban.entity.Query;
import com.luban.entity.User;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.QueryRepository;
import com.luban.service.QueryService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/queries")
public class QueryController {

    private final QueryService queryService;
    private final QueryRepository queryRepository;
    private final ApplicationRepository applicationRepository;

    public QueryController(QueryService queryService,
                           QueryRepository queryRepository,
                           ApplicationRepository applicationRepository) {
        this.queryService = queryService;
        this.queryRepository = queryRepository;
        this.applicationRepository = applicationRepository;
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

    private void checkQueryOwnership(Long queryId, User user) {
        Query query = queryRepository.findById(queryId)
                .orElseThrow(() -> new IllegalArgumentException("查询不存在"));
        Application app = applicationRepository.findById(query.getApplicationId())
                .orElseThrow(() -> new IllegalArgumentException("应用不存在"));
        if (!app.getCreatedBy().equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "无权操作此查询");
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> update(
            @PathVariable Long id, @RequestBody UpdateQueryRequest request,
            @AuthenticationPrincipal User user) {
        checkQueryOwnership(id, user);
        return ResponseEntity.ok(ApiResponse.ok(queryService.update(id, request)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id,
                                                     @AuthenticationPrincipal User user) {
        checkQueryOwnership(id, user);
        queryService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PostMapping("/{id}/run")
    public ResponseEntity<ApiResponse<RunQueryResponse>> run(
            @PathVariable Long id, @RequestBody(required = false) RunQueryRequest request,
            @AuthenticationPrincipal User user) {
        checkQueryOwnership(id, user);
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