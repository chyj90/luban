package com.luban.controller;

import com.luban.dto.*;
import com.luban.entity.User;
import com.luban.security.appaccess.AppAccess;
import com.luban.security.appaccess.AppAction;
import com.luban.service.QueryService;
import com.luban.util.SqlUtils;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
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

    /**
     * 工作中心数据看板：当前用户可访问应用内的洞察沉淀查询（source=INSIGHT）
     */
    @GetMapping("/insight-saved")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> insightSaved(
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(ApiResponse.ok(queryService.listInsightSaved(user.getId())));
    }

    @PostMapping("/{id}/run")
    @AppAccess(action = AppAction.RUN, resource = "query", key = "id")
    public ResponseEntity<ApiResponse<RunQueryResponse>> run(
            @PathVariable Long id,
            @RequestBody(required = false) RunQueryRequest request,
            @RequestParam(name = "previewAsUserId", required = false) Long previewAsUserId,
            @AuthenticationPrincipal User user) {
        if (request == null) request = new RunQueryRequest();
        if (previewAsUserId != null) {
            // 预览身份切换：设计者以指定平台用户身份执行（this.auth 取该用户），用于验证数据隔离；
            // 仅应用所有者可用（校验在 service 内）
            return ResponseEntity.ok(ApiResponse.ok(queryService.runPreviewAs(id, request, previewAsUserId, user.getId())));
        }
        return ResponseEntity.ok(ApiResponse.ok(queryService.run(id, request)));
    }

    /**
     * SQL 执行通道：DDL 仅当 allowDdl=true 时允许。allowDdl 的合法来源有两个：
     * ① 数据源管理面板手动执行；② Agent 的 execute_sql 在用户通过危险操作确认卡片
     * （danger-confirm）显式批准后携带——确认门在 Agent 前端内核拦截，未确认的 DDL
     * 到不了这里。DDL 判定针对拆分后的每条语句（引号/注释感知），避免"注释开头 + 批量 DDL"绕过拦截。
     */
    @PostMapping("/execute")
    @AppAccess(action = AppAction.RUN, resource = "datasource", key = "datasourceId")
    public ResponseEntity<ApiResponse<Object>> execute(
            @RequestBody ExecuteSqlRequest request) {
        boolean isDdl = SqlUtils.splitStatements(request.getSql()).stream()
                .map(SqlUtils::firstKeyword)
                .anyMatch(SqlUtils::isDdlKeyword);
        if (isDdl && !Boolean.TRUE.equals(request.getAllowDdl())) {
            return ResponseEntity.ok(ApiResponse.error("DDL 操作不允许通过该接口执行（缺少 allowDdl，未经用户确认门）。Agent 端请通过 execute_sql 确认门发起，或由用户在数据源管理面板手动执行"));
        }
        if (Boolean.TRUE.equals(request.getMulti()) || Boolean.TRUE.equals(request.getRollback())) {
            // rollback=true 强制走事务批量路径（单条也在事务中执行后回滚），测试不落库
            return ResponseEntity.ok(ApiResponse.ok(
                    queryService.executeSqlBatch(request.getDatasourceId(), request.getSql(),
                            Boolean.TRUE.equals(request.getRollback()))));
        }
        return ResponseEntity.ok(ApiResponse.ok(
                queryService.executeSql(request.getDatasourceId(), request.getSql())));
    }
}