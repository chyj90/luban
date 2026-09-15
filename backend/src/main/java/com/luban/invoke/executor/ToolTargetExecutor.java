package com.luban.invoke.executor;

import com.luban.constant.ToolType;
import com.luban.entity.ApplicationApiKey;
import com.luban.entity.ToolDefinition;
import com.luban.invoke.ExecutionContext;
import com.luban.invoke.InvocationException;
import com.luban.invoke.InvocationOrigin;
import com.luban.invoke.InvocationRequest;
import com.luban.invoke.InvocationResult;
import com.luban.invoke.InvocationService;
import com.luban.invoke.TargetExecutor;
import com.luban.invoke.TargetType;
import com.luban.repository.ApiKeyToolRepository;
import com.luban.repository.ApplicationApiKeyRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.service.ToolExecutionService;
import com.luban.workflow.repository.RoleRepository;
import com.luban.workflow.repository.RoleUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * Tool/API 目标执行器。
 * PAGE 来源执行 scope 归属 + 平台工具白名单/Key 绑定校验；AGENT 来源直接执行；
 * ORCHESTRATION 类型工具经漏斗子调用（修掉旧实现"静默不递归"的问题）。
 */
@Component
@RequiredArgsConstructor
public class ToolTargetExecutor implements TargetExecutor {

    private final ToolDefinitionRepository toolDefinitionRepository;
    private final ToolExecutionService toolExecutionService;
    private final com.luban.orchestration.service.OrchestrationToolInvoker orchestrationToolInvoker;
    private final ObjectProvider<InvocationService> invocationServiceProvider;
    private final RoleRepository roleRepository;
    private final RoleUserRepository roleUserRepository;
    private final ApplicationApiKeyRepository applicationApiKeyRepository;
    private final ApiKeyToolRepository apiKeyToolRepository;

    @Override
    public TargetType support() {
        return TargetType.TOOL;
    }

    @Override
    public InvocationResult execute(InvocationRequest request, ExecutionContext ctx) {
        ToolDefinition tool = toolDefinitionRepository.findById(request.getTargetId())
                .orElseThrow(() -> new IllegalArgumentException("API 不存在: " + request.getTargetId()));

        if (ctx.getOrigin() == InvocationOrigin.PAGE) {
            assertPageAccess(tool, ctx);
        }

        if (tool.getToolType() == ToolType.ORCHESTRATION) {
            Long orchDefId = orchestrationToolInvoker.requireOrchestrationId(tool);
            if (ctx.getOrigin() == InvocationOrigin.PAGE) {
                Long orchAppId = orchestrationToolInvoker.applicationIdOf(orchDefId);
                if (orchAppId == null || !orchAppId.equals(ctx.getAppId())) {
                    throw new InvocationException(InvocationException.FORBIDDEN, "无权调用此编排（属于其他应用）");
                }
            }
            Map<String, Object> params = request.getParams();
            var child = ctx.child(TargetType.ORCHESTRATION, String.valueOf(orchDefId));
            InvocationResult result = invocationServiceProvider.getObject()
                    .invoke(com.luban.invoke.InvocationRequest.of(
                            TargetType.ORCHESTRATION, orchDefId, params, child));
            return new InvocationResult(result.isSuccess(), result.getData(),
                    result.getErrorCode(), result.getErrorMessage(), 0, ctx.getTraceRowId());
        }

        if (ctx.getOrigin() == InvocationOrigin.PAGE) {
            Map<String, Object> params = request.getParams();
            return InvocationResult.ok(toolExecutionService.executeApplicationTool(tool, params),
                    0, ctx.getTraceRowId());
        }
        // Agent 等内部来源：平台工具统一分发（HTTP/MCP/算法）
        return InvocationResult.ok(
                toolExecutionService.executeToolDefinition(tool, request.getParams(), "agent"),
                0, ctx.getTraceRowId());
    }

    /** 迁移自 RuntimeController.runTool 的页面级工具授权（scope 归属 + 白名单 + Key 绑定） */
    private void assertPageAccess(ToolDefinition tool, ExecutionContext ctx) {
        Long applicationId = ctx.getAppId();
        String scope = tool.getScope();
        if ("APPLICATION".equals(scope)) {
            if (!tool.getGroupId().equals(applicationId)) {
                throw new InvocationException(InvocationException.FORBIDDEN, "无权调用此 API");
            }
            return;
        }
        if (!"PLATFORM".equals(scope)) {
            throw new InvocationException(InvocationException.FORBIDDEN, "不支持的 API 类型");
        }
        if (!tool.getGroupId().equals(applicationId)) {
            throw new InvocationException(InvocationException.FORBIDDEN, "无权调用此 API");
        }

        Long userId = ctx.getPrincipal() != null ? ctx.getPrincipal().getUserId() : null;
        var appRoles = roleRepository.findByApplicationId(applicationId);
        List<Long> appRoleIds = appRoles.stream().map(r -> r.getId()).toList();
        var userRoles = roleUserRepository.findByUserId(userId);
        boolean inWhitelist = userRoles.stream().anyMatch(ru -> appRoleIds.contains(ru.getRoleId()));
        if (!inWhitelist) {
            throw new InvocationException(InvocationException.FORBIDDEN, "无权访问此应用，请联系管理员");
        }

        List<ApplicationApiKey> bindings = applicationApiKeyRepository
                .findByApplicationIdAndStatus(applicationId, "ACTIVE");
        if (bindings.isEmpty()) {
            throw new InvocationException(InvocationException.FORBIDDEN, "应用未绑定有效 API KEY");
        }
        boolean hasKeyPermission = bindings.stream().anyMatch(binding ->
                apiKeyToolRepository.findByApiKeyIdAndToolId(binding.getApiKeyId(), tool.getId())
                        .map(akt -> "APPROVED".equals(akt.getStatus()))
                        .orElse(false));
        if (!hasKeyPermission) {
            throw new InvocationException(InvocationException.FORBIDDEN, "API KEY 无权调用此工具");
        }
    }
}
