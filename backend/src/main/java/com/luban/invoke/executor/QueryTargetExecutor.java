package com.luban.invoke.executor;

import com.luban.dto.RunQueryRequest;
import com.luban.entity.Datasource;
import com.luban.entity.Query;
import com.luban.invoke.ExecutionContext;
import com.luban.invoke.InvocationException;
import com.luban.invoke.InvocationRequest;
import com.luban.invoke.InvocationResult;
import com.luban.invoke.InvocationOrigin;
import com.luban.invoke.TargetExecutor;
import com.luban.invoke.TargetType;
import com.luban.repository.DatasourceRepository;
import com.luban.repository.QueryRepository;
import com.luban.service.ApiKeyService;
import com.luban.service.QueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Query 目标执行器。
 * PAGE 来源执行页面归属校验（查询属于页面应用 + PLATFORM 数据源需应用获授权），
 * 其余来源（编排节点/触发器）依赖发布清单校验，直接执行。
 */
@Component
@RequiredArgsConstructor
public class QueryTargetExecutor implements TargetExecutor {

    private final QueryRepository queryRepository;
    private final DatasourceRepository datasourceRepository;
    private final ApiKeyService apiKeyService;
    private final QueryService queryService;

    @Override
    public TargetType support() {
        return TargetType.QUERY;
    }

    @Override
    public InvocationResult execute(InvocationRequest request, ExecutionContext ctx) {
        Query query = queryRepository.findById(request.getTargetId())
                .orElseThrow(() -> new IllegalArgumentException("查询不存在: " + request.getTargetId()));

        if (ctx.getOrigin() == InvocationOrigin.PAGE) {
            if (ctx.getAppId() == null || !query.getApplicationId().equals(ctx.getAppId())) {
                throw new InvocationException(InvocationException.FORBIDDEN, "无权在当前页面执行此查询");
            }
            Datasource ds = datasourceRepository.findById(query.getDatasourceId())
                    .orElseThrow(() -> new IllegalArgumentException("数据源不存在"));
            if ("PLATFORM".equals(ds.getEffectiveScope())
                    && !apiKeyService.hasApplicationDatasourcePermission(ctx.getAppId(), ds.getId())) {
                throw new InvocationException(InvocationException.FORBIDDEN,
                        "应用未获此数据源访问授权，请先申请并完成审批");
            }
        }

        RunQueryRequest runRequest = new RunQueryRequest();
        Map<String, Object> params = request.getParams();
        if (params != null && !params.isEmpty()) runRequest.setParams(params);
        var response = queryService.run(query.getId(), runRequest);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("columns", response.getColumns());
        out.put("rows", response.getRows());
        out.put("totalCount", response.getTotalCount());
        return InvocationResult.ok(out, 0, ctx.getTraceRowId());
    }
}
