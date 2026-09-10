package com.luban.orchestration.engine;

import com.luban.entity.Query;
import com.luban.entity.ToolDefinition;
import com.luban.repository.QueryRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.service.QueryService;
import com.luban.workflow.service.ProcessEngine;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 默认节点执行器：把引擎的抽象 invoker 落到平台既有服务。
 *
 * - runQuery  → QueryService.run（参数化执行，用户上下文来自当前请求）
 * - callTool  → 平台已注册 API 工具出站调用（复用 http 节点的 IP 建连逻辑与超时）
 * - callHttpUrl → 直连出站（URL 已由引擎 IpGuard 校验并替换为验证过的 IP 建连地址）
 * - runPython → SandboxPythonClient（embedding-service 沙箱池）
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

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER) // 重定向逐跳校验由调用方负责
            .build();

    @Override
    public Map<String, Object> runQuery(Long queryId, Map<String, Object> params) {
        com.luban.dto.RunQueryRequest request = new com.luban.dto.RunQueryRequest();
        if (params != null && !params.isEmpty()) request.setParams(params);
        var response = queryService.run(queryId, request);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("columns", response.getColumns());
        out.put("rows", response.getRows());
        out.put("totalCount", response.getTotalCount());
        return out;
    }

    @Override
    public Map<String, Object> callTool(Long toolId, Map<String, Object> params, int timeoutMs, int retries) {
        ToolDefinition tool = toolDefinitionRepository.findById(toolId)
                .orElseThrow(() -> new IllegalArgumentException("API 工具不存在: " + toolId));
        String config = tool.getConfig();
        // 复用直连通道：工具 config 中的 url/method 由平台注册时管理（已受控）
        return callHttpUrlWithRetries(urlOf(config), methodOf(config), Map.of(), params, timeoutMs, retries, true);
    }

    @Override
    public Map<String, Object> callHttpUrl(String url, String method, Map<String, Object> headers,
                                           Object body, int timeoutMs, int retries) {
        return callHttpUrlWithRetries(url, method, headers, body, timeoutMs, retries, false);
    }

    private Map<String, Object> callHttpUrlWithRetries(String url, String method, Map<String, Object> headers,
                                                       Object body, int timeoutMs, int retries, boolean hasHostHeader) {
        Map<String, Object> lastResult = Map.of("error", "未执行");
        int attempts = Math.max(1, retries + 1);
        for (int i = 0; i < attempts; i++) {
            lastResult = callHttpOnce(url, method, headers, body, timeoutMs, hasHostHeader);
            Object err = lastResult.get("error");
            if (err == null) return lastResult;
            log.warn("HTTP call attempt {}/{} failed: {}", i + 1, attempts, err);
        }
        return lastResult;
    }

    private Map<String, Object> callHttpOnce(String url, String method, Map<String, Object> headers,
                                             Object body, int timeoutMs, boolean hasHostHeader) {
        try {
            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofMillis(timeoutMs));
            if (headers != null) {
                headers.forEach((k, v) -> builder.header(k, String.valueOf(v)));
            }
            if (!hasHostHeader) {
                // IP 建连时由引擎补 Host；此处兜底
                URI uri = URI.create(url);
                builder.header("Host", uri.getHost());
            }
            if ("POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method) || "PATCH".equalsIgnoreCase(method)) {
                String payload = body == null ? "" : toJson(body);
                builder.method(method.toUpperCase(), HttpRequest.BodyPublishers.ofString(payload));
                builder.header("Content-Type", "application/json");
            } else {
                builder.method(method.toUpperCase(), HttpRequest.BodyPublishers.noBody());
            }
            HttpResponse<String> resp = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("status", resp.statusCode());
            String bodyText = resp.body() == null ? "" : resp.body();
            out.put("data", bodyText.length() > 1_000_000 ? bodyText.substring(0, 1_000_000) : bodyText);
            return out;
        } catch (Exception e) {
            return Map.of("error", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
        }
    }

    @Override
    public Map<String, Object> runWorkflowAction(String action, Long workflowDefinitionId,
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
