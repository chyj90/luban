package com.luban.orchestration.engine;

import com.luban.orchestration.dsl.OrchestrationDsl;
import com.luban.workflow.service.ConditionEvaluator;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * 编排执行引擎：按 DSL 拓扑解释执行。
 *
 * 设计：
 * - 深度优先推进（与流程引擎同构）：进入节点 → 执行 → 沿边推进；condition 边用 ConditionEvaluator 语法评估；
 * - parallel 节点：并发执行所有出边目标，join 等待后进入下一节点；
 * - 变量上下文：Map<nodeId, output> + "__input__"（start 参数），无 eval；
 * - 错误策略（节点 config.strategy）：fail（默认，快速终止）/ fallback（输出 fallbackValue）/ continue（跳过输出空）；
 * - 硬限制：总超时 60s、节点输出 ≤1MB、执行深度 ≤64（防环兜底）。
 */
@Component
public class OrchestrationEngine {

    public static final int MAX_TOTAL_TIMEOUT_MS = 60_000;
    private static final int MAX_DEPTH = 64;

    private final VariableResolver variableResolver;
    private final NodeInvokers nodeInvokers;
    private final com.luban.orchestration.security.IpGuard ipGuard;
    private final ExecutorService parallelPool = Executors.newFixedThreadPool(8);

    public OrchestrationEngine(VariableResolver variableResolver, NodeInvokers nodeInvokers,
                               com.luban.orchestration.security.IpGuard ipGuard) {
        this.variableResolver = variableResolver;
        this.nodeInvokers = nodeInvokers;
        this.ipGuard = ipGuard;
    }

    /** 执行结果 */
    public record ExecutionResult(boolean success, Map<String, Object> output,
                                  List<Map<String, Object>> nodeTrace, String errorCode, String errorMessage) {}

    /** 由调用方注入的执行环境：各类型节点的实际执行委托 */
    public interface NodeInvokers {
        Map<String, Object> runQuery(Long queryId, Map<String, Object> params);
        Map<String, Object> callTool(Long toolId, Map<String, Object> params, int timeoutMs, int retries);
        Map<String, Object> callHttpUrl(String url, String method, Map<String, Object> headers,
                                        Object body, int timeoutMs, int retries);
        Map<String, Object> runPython(String source, String entry, List<String> packages,
                                      Map<String, Object> inputs, int timeoutMs);
        /** workflow 节点：经流程引擎执行（发起权限 canSubmitWorkflow、审批 assignee 校验天然生效）。默认不支持。 */
        default Map<String, Object> runWorkflowAction(String action, Long workflowDefinitionId,
                                                      Map<String, Object> formData, Long instanceId, String comment) {
            throw new UnsupportedOperationException("workflow 节点未被该执行器支持");
        }
    }

    public ExecutionResult execute(OrchestrationDsl.Dsl dsl, Map<String, Object> inputs,
                                   Map<String, Object> inputSchema) {
        long start = System.currentTimeMillis();
        List<Map<String, Object>> trace = new ArrayList<>();
        Map<String, Object> context = new LinkedHashMap<>();
        Map<String, Object> sanitizedInput = sanitizeInputs(inputs, inputSchema);
        context.put("__input__", sanitizedInput);

        OrchestrationDsl.NodeDef current = findStart(dsl);
        Map<String, Object> lastOutput = null;
        int depth = 0;

        try {
            while (current != null) {
                if (++depth > MAX_DEPTH) {
                    return fail(trace, "DEPTH_EXCEEDED", "执行深度超限（可能存在循环推进）", start);
                }
                if (System.currentTimeMillis() - start > MAX_TOTAL_TIMEOUT_MS) {
                    return fail(trace, "TIMEOUT", "总执行超时 " + MAX_TOTAL_TIMEOUT_MS + "ms", start);
                }

                if ("condition".equals(current.getNodeType())) {
                    current = nextByCondition(dsl, current, context);
                    continue;
                }
                if ("parallel".equals(current.getNodeType())) {
                    current = runParallel(dsl, current, context, trace);
                    continue;
                }
                if ("output".equals(current.getNodeType())) {
                    lastOutput = context;
                    break;
                }

                long nodeStart = System.currentTimeMillis();
                Map<String, Object> output;
                try {
                    output = executeNode(current, context);
                } catch (Exception e) {
                    trace.add(nodeTrace(current, "FAILED", System.currentTimeMillis() - nodeStart, e.getMessage()));
                    String strategy = current.config().getStrategy();
                    if ("continue".equals(strategy)) {
                        context.put(current.getId(), Map.of("__skipped__", true));
                        current = nextNode(dsl, current.getId(), null);
                        continue;
                    }
                    if ("fallback".equals(strategy)) {
                        Map<String, Object> fb = new LinkedHashMap<>();
                        if (current.config().getTemplate() != null) fb.putAll(current.config().getTemplate());
                        if (fb.isEmpty()) fb.put("__fallback__", true);
                        context.put(current.getId(), fb);
                        current = nextNode(dsl, current.getId(), null);
                        continue;
                    }
                    return fail(trace, "NODE_FAILED",
                            "节点 " + current.getId() + " 执行失败: " + safeMessage(e), start);
                }
                long elapsed = System.currentTimeMillis() - nodeStart;
                context.put(current.getId(), output);
                trace.add(nodeTrace(current, "SUCCESS", elapsed, null));
                lastOutput = output;
                current = nextNode(dsl, current.getId(), null);
            }

            Map<String, Object> outputMap = lastOutput instanceof Map<?, ?> m
                    ? asStringMap(m) : Map.of();
            return new ExecutionResult(true, outputMap, trace, null, null);
        } catch (Exception e) {
            return fail(trace, "ENGINE_ERROR", safeMessage(e), start);
        }
    }

    /** 计算上下文快照（Python ctx 输入用）：已执行节点的输出 */
    public Map<String, Object> contextSnapshot(Map<String, Object> context) {
        Map<String, Object> snapshot = new LinkedHashMap<>(context);
        snapshot.remove("__input__");
        return snapshot;
    }

    private Map<String, Object> executeNode(OrchestrationDsl.NodeDef node, Map<String, Object> context) {
        OrchestrationDsl.NodeDef.Config c = node.config();
        Map<String, Object> params = variableResolver.resolveTemplate(c.getParamsTemplate(), context);
        return switch (node.getNodeType() == null ? "" : node.getNodeType()) {
            case "http" -> c.getToolId() != null
                    ? nodeInvokers.callTool(c.getToolId(), params,
                            c.getTimeoutMs() != null ? c.getTimeoutMs() : 10_000,
                            c.getRetries() != null ? c.getRetries() : 0)
                    : invokeHttpDirect(node, c, context);
            case "query" -> nodeInvokers.runQuery(c.getQueryId(), params);
            case "python" -> nodeInvokers.runPython(c.getSource(),
                    c.getEntry() == null ? "main" : c.getEntry(),
                    c.getPackages(),
                    contextSnapshot(context),
                    c.getTimeoutMs() != null ? c.getTimeoutMs() : 20_000);
            case "transform" -> {
                Map<String, Object> tmpl = new LinkedHashMap<>(c.getTemplate() == null ? Map.of() : c.getTemplate());
                yield variableResolver.resolveTemplate(tmpl, context);
            }
            case "workflow" -> nodeInvokers.runWorkflowAction(c.getWorkflowAction(),
                    c.getWorkflowDefinitionId(),
                    variableResolver.resolveTemplate(
                            c.getFormDataTemplate() == null ? Map.of() : new LinkedHashMap<>(c.getFormDataTemplate()),
                            context),
                    variableResolver.resolveInstanceId(c.getInstanceIdTemplate(), context),
                    c.getComment());
            default -> Map.of();
        };
    }

    /** 直连 http：先 IpGuard 校验（含 DNS rebinding 防护），以解析后的 IP 建连（由 NodeInvokers.callHttpUrl 实现） */
    private Map<String, Object> invokeHttpDirect(OrchestrationDsl.NodeDef node,
                                                 OrchestrationDsl.NodeDef.Config c,
                                                 Map<String, Object> context) {
        String url = String.valueOf(variableResolver.resolveValue(c.getUrl(), context));
        var target = ipGuard.check(url);
        // 用已验证 IP 重建 URL 建连（Host 语义由调用方补 Host 头），防 DNS rebinding
        String connectUrl = target.address() instanceof java.net.Inet6Address
                ? "%s://[%s]:%d%s%s".formatted(
                        url.startsWith("https") ? "https" : "http",
                        target.address().getHostAddress(), target.port(),
                        target.path(), target.query() != null ? "?" + target.query() : "")
                : "%s://%s:%d%s%s".formatted(
                        url.startsWith("https") ? "https" : "http",
                        target.address().getHostAddress(), target.port(),
                        target.path(), target.query() != null ? "?" + target.query() : "");
        Map<String, Object> headers = new java.util.LinkedHashMap<>(
                variableResolver.resolveTemplate(
                        c.getHeaders() == null ? Map.of() : new java.util.LinkedHashMap<>(c.getHeaders()), context));
        headers.putIfAbsent("Host", target.host());
        Object body = variableResolver.resolveValue(c.getBodyTemplate(), context);
        String method = c.getMethod() == null ? "GET" : c.getMethod();
        return nodeInvokers.callHttpUrl(connectUrl, method, headers, body,
                c.getTimeoutMs() != null ? c.getTimeoutMs() : 10_000,
                c.getRetries() != null ? c.getRetries() : 0);
    }

    private OrchestrationDsl.NodeDef nextNode(OrchestrationDsl.Dsl dsl, String fromId, Map<String, Object> ctx) {
        return findNode(dsl, nextNodeId(dsl, fromId, ctx));
    }

    private String nextNodeId(OrchestrationDsl.Dsl dsl, String fromId, Map<String, Object> ctx) {
        for (OrchestrationDsl.EdgeDef e : dsl.getEdges()) {
            if (fromId.equals(e.getSource())) return e.getTarget();
        }
        return null;
    }

    private OrchestrationDsl.NodeDef nextByCondition(OrchestrationDsl.Dsl dsl,
                                                     OrchestrationDsl.NodeDef conditionNode,
                                                     Map<String, Object> context) {
        OrchestrationDsl.NodeDef first = null;
        for (OrchestrationDsl.EdgeDef e : dsl.getEdges()) {
            if (!conditionNode.getId().equals(e.getSource())) continue;
            boolean matched = ConditionEvaluator.evaluate(
                    e.getCondition(), inputOnly(context));
            if (matched) {
                return findNode(dsl, e.getTarget());
            }
            if (first == null) first = findNode(dsl, e.getTarget());
        }
        return first; // 无满足条件时走第一条边（与流程引擎一致的兜底）
    }

    /** condition 评估的变量上下文：输入参数 + 已执行节点输出（顶层合并便于直接引用字段名） */
    private Map<String, Object> inputOnly(Map<String, Object> context) {
        Map<String, Object> eval = new LinkedHashMap<>();
        Object input = context.get("__input__");
        if (input instanceof Map<?, ?> m) {
            m.forEach((k, v) -> eval.put(String.valueOf(k), v));
        }
        // 已执行节点输出：扁平合并到顶层，输入参数优先
        for (var entry : context.entrySet()) {
            if ("__input__".equals(entry.getKey())) continue;
            if (entry.getValue() instanceof Map<?, ?> m) {
                m.forEach((k, v) -> eval.putIfAbsent(String.valueOf(k), v));
            }
        }
        return eval;
    }

    /** parallel 节点：并发执行所有出边目标（condition 边不支持并行扇出），汇合后返回汇合节点 */
    private OrchestrationDsl.NodeDef runParallel(OrchestrationDsl.Dsl dsl,
                                                 OrchestrationDsl.NodeDef parallelNode,
                                                 Map<String, Object> context,
                                                 List<Map<String, Object>> trace) {
        List<OrchestrationDsl.NodeDef> branches = dsl.getEdges().stream()
                .filter(e -> parallelNode.getId().equals(e.getSource()))
                .map(e -> findNode(dsl, e.getTarget()))
                .filter(n -> n != null && !"condition".equals(n.getNodeType()))
                .toList();
        List<CompletableFuture<Void>> futures = new ArrayList<>();
        for (OrchestrationDsl.NodeDef branch : branches) {
            futures.add(CompletableFuture.runAsync(() -> {
                Map<String, Object> out;
                long nodeStart = System.currentTimeMillis();
                try {
                    out = executeNode(branch, context);
                    context.put(branch.getId(), out);
                    trace.add(nodeTrace(branch, "SUCCESS", System.currentTimeMillis() - nodeStart, null));
                } catch (Exception e) {
                    trace.add(nodeTrace(branch, "FAILED", System.currentTimeMillis() - nodeStart, e.getMessage()));
                    String strategy = branch.config().getStrategy();
                    if (!"continue".equals(strategy) && !"fallback".equals(strategy)) {
                        throw new RuntimeException("并行分支 " + branch.getId() + " 失败: " + e.getMessage(), e);
                    }
                    context.put(branch.getId(), "fallback".equals(strategy)
                            ? Map.of("__fallback__", true) : Map.of("__skipped__", true));
                }
            }, parallelPool));
        }
        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
        // 汇合：所有分支的共同后继
        return commonSuccessor(dsl, branches);
    }

    private OrchestrationDsl.NodeDef commonSuccessor(OrchestrationDsl.Dsl dsl,
                                                     List<OrchestrationDsl.NodeDef> branches) {
        OrchestrationDsl.NodeDef common = null;
        for (OrchestrationDsl.NodeDef b : branches) {
            String nextId = nextNodeId(dsl, b.getId(), null);
            OrchestrationDsl.NodeDef next = findNode(dsl, nextId);
            if (common == null) common = next;
            else if (common != next) return null; // 无共同汇合点 → 图结束
        }
        return common;
    }

    private OrchestrationDsl.NodeDef findStart(OrchestrationDsl.Dsl dsl) {
        return dsl.getNodes().stream()
                .filter(n -> "start".equals(n.getNodeType()))
                .findFirst().orElseThrow(() -> new IllegalArgumentException("缺少 start 节点"));
    }

    private OrchestrationDsl.NodeDef findNode(OrchestrationDsl.Dsl dsl, String id) {
        if (id == null) return null;
        return dsl.getNodes().stream()
                .filter(n -> id.equals(n.getId())).findFirst().orElse(null);
    }

    private Map<String, Object> sanitizeInputs(Map<String, Object> inputs, Map<String, Object> schema) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (schema == null) return inputs == null ? Map.of() : inputs;
        for (Map.Entry<String, Object> e : schema.entrySet()) {
            String name = String.valueOf(e.getKey());
            Object declared = e.getValue() instanceof Map<?, ?> m ? m.get("defaultValue") : null;
            Object value = inputs != null && inputs.containsKey(name) ? inputs.get(name) : declared;
            out.put(name, value);
        }
        return out;
    }

    private Map<String, Object> nodeTrace(OrchestrationDsl.NodeDef n, String status,
                                          long elapsedMs, String error) {
        Map<String, Object> t = new LinkedHashMap<>();
        t.put("nodeId", n.getId());
        t.put("nodeType", n.getNodeType());
        t.put("status", status);
        t.put("elapsedMs", elapsedMs);
        if (error != null) t.put("error", error.length() > 200 ? error.substring(0, 200) : error);
        return t;
    }

    private ExecutionResult fail(List<Map<String, Object>> trace, String code, String message, long start) {
        return new ExecutionResult(false, Map.of(), trace, code, message);
    }

    private String safeMessage(Exception e) {
        String m = e.getMessage();
        return m != null && !m.isBlank() ? m : e.getClass().getSimpleName();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> asStringMap(Map<?, ?> m) {
        Map<String, Object> out = new LinkedHashMap<>();
        m.forEach((k, v) -> out.put(String.valueOf(k), v));
        return out;
    }

    /** 优雅关闭（供 @PreDestroy 调用） */
    public void shutdown() {
        parallelPool.shutdown();
        try {
            parallelPool.awaitTermination(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}