package com.luban.controller;

import com.luban.dto.*;
import com.luban.security.appaccess.AppAccess;
import com.luban.security.appaccess.AppAction;
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
    @AppAccess(action = AppAction.VIEW, from = AppAccess.Source.PARAM, key = "applicationId")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> list(@RequestParam Long applicationId) {
        return ResponseEntity.ok(ApiResponse.ok(queryService.listByApplication(applicationId)));
    }

    @PostMapping
    @AppAccess(action = AppAction.DEVELOP, from = AppAccess.Source.BODY, key = "applicationId")
    public ResponseEntity<ApiResponse<Map<String, Object>>> create(
            @Valid @RequestBody CreateQueryRequest request) {
        Map<String, Object> query = queryService.create(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(query));
    }

    @PutMapping("/{id}")
    @AppAccess(action = AppAction.DEVELOP, resource = "query", key = "id")
    public ResponseEntity<ApiResponse<Map<String, Object>>> update(
            @PathVariable Long id, @RequestBody UpdateQueryRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(queryService.update(id, request)));
    }

    @DeleteMapping("/{id}")
    @AppAccess(action = AppAction.DEVELOP, resource = "query", key = "id")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        queryService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PostMapping("/{id}/run")
    @AppAccess(action = AppAction.RUN, resource = "query", key = "id")
    public ResponseEntity<ApiResponse<RunQueryResponse>> run(
            @PathVariable Long id, @RequestBody(required = false) RunQueryRequest request) {
        if (request == null) request = new RunQueryRequest();
        return ResponseEntity.ok(ApiResponse.ok(queryService.run(id, request)));
    }

    /**
     * SQL 执行通道：DDL 仅当 allowDdl=true 时允许（仅前端面板手动执行可传，Agent 调用不传此字段）。
     */
    @PostMapping("/execute")
    @AppAccess(action = AppAction.RUN, resource = "datasource", key = "datasourceId")
    public ResponseEntity<ApiResponse<Object>> execute(
            @RequestBody ExecuteSqlRequest request) {
        String upperSql = request.getSql() != null ? request.getSql().trim().toUpperCase() : "";
        boolean isDdl = upperSql.matches("(?s)^\\s*(CREATE|ALTER|DROP|TRUNCATE|RENAME)\\b.*");
        if (isDdl && !Boolean.TRUE.equals(request.getAllowDdl())) {
            return ResponseEntity.ok(ApiResponse.error("DDL 操作不允许通过该接口执行，请前往数据源管理面板手动操作"));
        }
        if (Boolean.TRUE.equals(request.getMulti())) {
            return ResponseEntity.ok(ApiResponse.ok(
                    queryService.executeSqlBatch(request.getDatasourceId(), request.getSql())));
        }
        return ResponseEntity.ok(ApiResponse.ok(
                queryService.executeSql(request.getDatasourceId(), request.getSql())));
    }
}