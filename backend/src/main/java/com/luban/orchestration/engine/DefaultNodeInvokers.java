package com.luban.orchestration.engine;

import com.luban.entity.Query;
import com.luban.entity.ToolDefinition;
import com.luban.invoke.ExecutionContext;
import com.luban.invoke.InvocationRequest;
import com.luban.invoke.InvocationResult;
import com.luban.invoke.InvocationService;
import com.luban.invoke.TargetType;
import com.luban.repository.QueryRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.service.QueryService;
import com.luban.service.ToolExecutionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 默认节点执行器：把引擎的抽象 invoker 落到平台既有服务。
 *
 * 跨对象节点（query/tool/workflow/subflow）在携带 ExecutionContext 时一律经
 * InvocationService 漏斗执行（深度/环/manifest/审计统一生效）；ctx 为 null
 * （开发态试运行等直连场景）时回退到直调领域服务的旧行为。
 *
 * - runQuery  → 漏斗 → QueryService.run
 * - callTool  → 漏斗 → ToolTargetExecutor（ORCHESTRATION 型工具会经漏斗递归子编排）
 * - callHttpUrl → ToolExecutionService 裸出站通道（IP 建连/重试统一管理）
 * - runPython → SandboxPythonClient（embedding-service 沙箱池）
 * - runWorkflowAction → 漏斗 → 流程引擎（发起权限/审批 assignee 校验天然生效）
 * - runSubflow → 漏斗 → 子编排（InvocationService 护栏管深度与环）
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DefaultNodeInvokers implements OrchestrationEngine.NodeInvokers {

    private final QueryService queryService;
    private final QueryRepository queryRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final SandboxPythonClient sandboxPythonClient;
    private final com.luban.workflow.service.ProcessService processService;
    private final com.luban.workflow.repository.WorkflowTaskRepository workflowTaskRepository;
    private final com.luban.repository.UserRepository userRepository;
    private final ToolExecutionService toolExecutionService;
    private final ObjectProvider<InvocationService> invocationServiceProvider;

    @Override
    public Map<String, Object> runQuery(Long queryId, Map<String, Object> params, ExecutionContext ctx) {
        if (ctx == null) {
            return runQueryDirect(queryId, params);
        }
        InvocationResult result = invocationServiceProvider.getObject().invoke(
                InvocationRequest.of(TargetType.QUERY, queryId, params,
                        ctx.child(TargetType.QUERY, String.valueOf(queryId))));
        requireSuccess(result, "query:" + queryId);
        return result.dataAsMap();
    }

    @Override
    public Map<String, Object> callTool(Long toolId, Map<String, Object> params, int timeoutMs, int retries,
                                        ExecutionContext ctx) {
        ToolDefinition tool = toolDefinitionRepository.findById(toolId)
                .orElseThrow(() -> new IllegalArgumentException("API 工具不存在: " + toolId));
        if (ctx != null) {
            // 经漏斗：ORCHESTRATION 型工具可正确递归子编排（修复旧实现静默不递归）
            InvocationResult result = invocationServiceProvider.getObject().invoke(
                    InvocationRequest.of(TargetType.TOOL, toolId, params,
                            ctx.child(TargetType.TOOL, String.valueOf(toolId))));
            requireSuccess(result, "tool:" + toolId);
            return result.dataAsMap();
        }
        // 开发态直连通道：工具 config 中的 url/method 由平台注册时管理（已受控）
        return toolExecutionService.callHttpRaw(urlOf(tool.getConfig()), methodOf(tool.getConfig()),
                Map.of(), params, timeoutMs, retries, true);
    }

    @Override
    public Map<String, Object> callHttpUrl(String url, String method, Map<String, Object> headers,
                                           Object body, int timeoutMs, int retries) {
        return toolExecutionService.callHttpRaw(url, method, headers, body, timeoutMs, retries, false);
    }

    @Override
    public Map<String, Object> runPython(String source, String entry, java.util.List<String> packages,
                                         Map<String, Object> inputs, int timeoutMs) {
        SandboxPythonClient.SandboxResult r = sandboxPythonClient.execute(source, entry, inputs, timeoutMs);
        if (!r.ok()) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("__python_error__", r.errorCode());
            out.put("message", r.stderr() == null ? "沙箱执行失败" : r.stderr());
            return out;
        }
        return r.result();
    }

    @Override
    public Map<String, Object> runWorkflowAction(String action, Long workflowDefinitionId,
                                                 Map<String, Object> formData, Long instanceId, String comment,
                                                 ExecutionContext ctx) {
        if (ctx == null) {
            return runWorkflowActionDirect(action, workflowDefinitionId, formData, instanceId, comment);
        }
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("action", action);
        if (instanceId != null) params.put("instanceId", instanceId);
        if (formData != null) params.put("formData", formData);
        params.put("comment", comment);
        InvocationResult result = invocationServiceProvider.getObject().invoke(
                InvocationRequest.of(TargetType.FLOW, workflowDefinitionId, params,
                        ctx.child(TargetType.FLOW, String.valueOf(workflowDefinitionId))));
        requireSuccess(result, "flow:" + workflowDefinitionId);
        return result.dataAsMap();
    }

    @Override
    public Map<String, Object> runSubflow(Long subOrchestrationId, Map<String, Object> params, ExecutionContext ctx) {
        if (ctx == null) {
            // 开发态试运行：直接执行子编排（当前版本），不走漏斗
            return orchestrationDirect(subOrchestrationId, params);
        }
        InvocationResult result = invocationServiceProvider.getObject().invoke(
                InvocationRequest.of(TargetType.ORCHESTRATION, subOrchestrationId, params,
                        ctx.child(TargetType.ORCHESTRATION, String.valueOf(subOrchestrationId))));
        requireSuccess(result, "orchestration:" + subOrchestrationId);
        Map<String, Object> data = result.dataAsMap();
        Object payload = data.get("data");
        return payload instanceof Map<?, ?> m ? asStringMap(m) : data;
    }

    private void requireSuccess(InvocationResult result, String target) {
        if (!result.isSuccess()) {
            throw new IllegalStateException("调用 " + target + " 失败: "
                    + (result.getErrorCode() != null ? result.getErrorCode() + " " : "")
                    + result.getErrorMessage());
        }
    }

    // ---------- ctx == null 的直连旧行为（开发态试运行 / 兼容路径） ----------

    private Map<String, Object> runQueryDirect(Long queryId, Map<String, Object> params) {
        com.luban.dto.RunQueryRequest request = new com.luban.dto.RunQueryRequest();
        if (params != null && !params.isEmpty()) request.setParams(params);
        var response = queryService.run(queryId, request);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("columns", response.getColumns());
        out.put("rows", response.getRows());
        out.put("totalCount", response.getTotalCount());
        return out;
    }

    private Map<String, Object> runWorkflowActionDirect(String action, Long workflowDefinitionId,
                                                        Map<String, Object> formData, Long instanceId, String comment) {
        Long userId = currentUserId();
        String userName = currentUserName();
        if (userId == null) {
            throw new IllegalStateException("workflow 节点需要用户身份（编排执行须在已登录请求上下文中）");
        }
        Map<String, Object> out = new LinkedHashMap<>();
        switch (action == null ? "" : action) {
            case "start" -> {
                String formDataJson = toJson(formData == null ? Map.of() : formData);
                var instance = processService.startProcess(workflowDefinitionId, formDataJson, userId, userName);
                out.put("instanceId", instance.getId());
                out.put("status", instance.getStatus());
            }
            case "get_status" -> {
                var instance = processService.getInstance(instanceId, userId);
                out.put("instanceId", instance.getId());
                out.put("status", instance.getStatus());
            }
            case "approve" -> {
                var task = pendingTaskForInstance(instanceId, userId);
                var approved = processService.approveTask(task.getId(), comment == null ? "" : comment, userId, userName);
                out.put("taskId", approved.getId());
                out.put("status", approved.getStatus());
            }
            case "reject" -> {
                var task = pendingTaskForInstance(instanceId, userId);
                var rejected = processService.rejectTask(task.getId(), comment == null ? "" : comment, userId, userName);
                out.put("taskId", rejected.getId());
                out.put("status", rejected.getStatus());
            }
            default -> throw new IllegalArgumentException("workflow 节点动作无效: " + action);
        }
        return out;
    }

    private Map<String, Object> orchestrationDirect(Long subOrchestrationId, Map<String, Object> params) {
        throw new IllegalStateException("开发态试运行不支持嵌套子编排（发布后经漏斗执行）");
    }

    private com.luban.workflow.entity.WorkflowTask pendingTaskForInstance(Long instanceId, Long userId) {
        var tasks = workflowTaskRepository.findByAssigneeIdAndInstanceId(userId, instanceId);
        return tasks.stream().filter(t -> "PENDING".equals(t.getStatus())).findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "当前用户在该流程实例下没有待审批任务（instanceId=" + instanceId + "）"));
    }

    private Long currentUserId() {
        var auth = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.getPrincipal() instanceof com.luban.entity.User u ? u.getId() : null;
    }

    private String currentUserName() {
        var auth = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.getPrincipal() instanceof com.luban.entity.User u ? u.getAccount() : "unknown";
    }

    private String toJson(Object o) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(o);
        } catch (Exception e) {
            return "{}";
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> asStringMap(Map<?, ?> m) {
        Map<String, Object> out = new LinkedHashMap<>();
        m.forEach((k, v) -> out.put(String.valueOf(k), v));
        return out;
    }

    private String urlOf(String config) {
        try {
            var node = new com.fasterxml.jackson.databind.ObjectMapper().readTree(config);
            return node.path("url").asText("");
        } catch (Exception e) {
            return "";
        }
    }

    private String methodOf(String config) {
        try {
            var node = new com.fasterxml.jackson.databind.ObjectMapper().readTree(config);
            return node.path("method").asText("GET");
        } catch (Exception e) {
            return "GET";
        }
    }
}
