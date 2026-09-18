package com.luban.invoke.executor;

import com.luban.dto.RunQueryRequest;
import com.luban.entity.Datasource;
import com.luban.entity.Query;
import com.luban.invoke.ExecutionContext;
import com.luban.invoke.InvocationException;
import com.luban.invoke.InvocationPrincipal;
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
            // 平台数据源不再经 KEY 绑定判定：设计期可见性（canUseSystemAsset）已约束开发者能绑什么，
            // 运行时由页面权限管辖——与"页面运行时不重复判数据源"的入口分域原则一致
        }

        RunQueryRequest runRequest = new RunQueryRequest();
        Map<String, Object> params = request.getParams();
        if (params != null && !params.isEmpty()) runRequest.setParams(params);
        // 无会话上下文的系统调用（触发器派发 on-behalf-of 发起人）以发起人身份解析 this.auth，
        // 回写类查询因此可以安全使用 {{ this.auth.userId }} 做数据归属
        var response = (ctx.getPrincipal() != null
                        && ctx.getPrincipal().getKind() == InvocationPrincipal.Kind.SYSTEM
                        && ctx.getPrincipal().getUserId() != null)
                ? queryService.runAsUser(query.getId(), runRequest, ctx.getPrincipal().getUserId())
                : queryService.run(query.getId(), runRequest);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("columns", response.getColumns());
        out.put("rows", response.getRows());
        out.put("totalCount", response.getTotalCount());
        // INSERT 的自增主键必须透传：页面凭 result.insertId 把业务记录 id 放进 startWorkflow 的 formData
        out.put("insertId", response.getInsertId());
        return InvocationResult.ok(out, 0, ctx.getTraceRowId());
    }
}
