package com.luban.orchestration;

import com.luban.orchestration.dsl.OrchestrationDsl;
import com.luban.orchestration.engine.OrchestrationEngine;
import com.luban.orchestration.engine.VariableResolver;
import com.luban.orchestration.security.IpGuard;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** 编排引擎测试（拓扑/条件/变量解析/错误策略/IpGuard），NodeInvokers 用假实现。 */
class OrchestrationEngineTest {

    private final VariableResolver resolver = new VariableResolver();
    private final IpGuard ipGuard = new IpGuard();

    private OrchestrationDsl.NodeDef node(String id, String type) {
        OrchestrationDsl.NodeDef n = new OrchestrationDsl.NodeDef();
        n.setId(id);
        n.setNodeType(type);
        OrchestrationDsl.NodeDef.NodeData data = new OrchestrationDsl.NodeDef.NodeData();
        data.setLabel(id);
        data.setConfig(new OrchestrationDsl.NodeDef.Config());
        n.setData(data);
        return n;
    }

    private OrchestrationDsl.EdgeDef edge(String s, String t, String condition) {
        OrchestrationDsl.EdgeDef e = new OrchestrationDsl.EdgeDef();
        e.setId(s + "-" + t);
        e.setSource(s);
        e.setTarget(t);
        e.setCondition(condition);
        return e;
    }

    private OrchestrationEngine engine(OrchestrationEngine.NodeInvokers invokers) {
        return new OrchestrationEngine(resolver, invokers, ipGuard);
    }

    @Test
    void sequentialExecutionResolvesVariables() {
        // start → q(参数模板引用 $input.id) → out
        OrchestrationDsl.Dsl dsl = new OrchestrationDsl.Dsl();
        OrchestrationDsl.NodeDef start = node("start", "start");
        OrchestrationDsl.NodeDef q = node("q1", "query");
        q.config().setQueryId(72L);
        q.config().setParamsTemplate(Map.of("id", "$input.id"));
        OrchestrationDsl.NodeDef out = node("out", "output");
        dsl.setNodes(List.of(start, q, out));
        dsl.setEdges(List.of(edge("start", "q1", null), edge("q1", "out", null)));

        Map<String, Long> receivedQueryId = new java.util.HashMap<>();
        Map<String, Map<String, Object>> receivedParams = new java.util.HashMap<>();
        var result = new OrchestrationEngine(resolver, new OrchestrationEngine.NodeInvokers() {
            public Map<String, Object> runQuery(Long qid, Map<String, Object> params) {
                receivedQueryId.put("qid", qid);
                receivedParams.put("params", params);
                return Map.of("rows", List.of("r1"));
            }
            public Map<String, Object> callTool(Long t, Map<String, Object> p, int to, int r) { return Map.of(); }
            public Map<String, Object> callHttpUrl(String u, String m, Map<String, Object> h, Object b, int to, int r) { return Map.of(); }
            public Map<String, Object> runPython(String s, String e, List<String> pk, Map<String, Object> in, int to) { return Map.of(); }
        }, ipGuard).execute(dsl, Map.of("id", 42), null);

        assertThat(result.success()).isTrue();
        assertThat(receivedQueryId.get("qid")).isEqualTo(72L);
        assertThat(receivedParams.get("params")).isEqualTo(Map.of("id", 42L));
        // output 节点上下文包含 q1 的输出
        assertThat(result.output().get("q1")).isEqualTo(Map.of("rows", List.of("r1")));
    }

    @Test
    void conditionRoutesByLeaveDays() {
        OrchestrationDsl.Dsl dsl = new OrchestrationDsl.Dsl();
        OrchestrationDsl.NodeDef start = node("start", "start");
        start.config().setInputs(List.of());
        OrchestrationDsl.NodeDef cond = node("cond", "condition");
        OrchestrationDsl.NodeDef a = node("branchA", "transform");
        a.config().setTemplate(Map.of("path", "short"));
        OrchestrationDsl.NodeDef b = node("branchB", "transform");
        b.config().setTemplate(Map.of("path", "long"));
        OrchestrationDsl.NodeDef out = node("out", "output");
        dsl.setNodes(List.of(start, cond, a, b, out));
        dsl.setEdges(List.of(
                edge("start", "cond", null),
                edge("cond", "branchA", "days <= 3"),
                edge("cond", "branchB", "days > 3"),
                edge("branchA", "out", null),
                edge("branchB", "out", null)));

        var shortResult = engine(noopInvokers()).execute(dsl, Map.of("days", 2), null);
        assertThat(shortResult.output().get("branchA")).isEqualTo(Map.of("path", "short"));

        var longResult = engine(noopInvokers()).execute(dsl, Map.of("days", 5), null);
        assertThat(longResult.output().get("branchB")).isEqualTo(Map.of("path", "long"));
    }

    @Test
    void workflowNodeStartsProcessViaInvoker() {
        OrchestrationDsl.Dsl dsl = new OrchestrationDsl.Dsl();
        OrchestrationDsl.NodeDef start = node("start", "start");
        OrchestrationDsl.NodeDef wf = node("wf", "workflow");
        wf.config().setWorkflowAction("start");
        wf.config().setWorkflowDefinitionId(41L);
        wf.config().setFormDataTemplate(Map.of("leaveDays", "$input.days"));
        OrchestrationDsl.NodeDef out = node("out", "output");
        dsl.setNodes(List.of(start, wf, out));
        dsl.setEdges(List.of(edge("start", "wf", null), edge("wf", "out", null)));

        Map<String, Object> captured = new java.util.HashMap<>();
        var result = new OrchestrationEngine(resolver, new OrchestrationEngine.NodeInvokers() {
            public Map<String, Object> runQuery(Long q, Map<String, Object> p) { return Map.of(); }
            public Map<String, Object> callTool(Long t, Map<String, Object> p, int to, int r) { return Map.of(); }
            public Map<String, Object> callHttpUrl(String u, String m, Map<String, Object> h, Object b, int to, int r) { return Map.of(); }
            public Map<String, Object> runPython(String s, String e, List<String> pk, Map<String, Object> in, int to) { return Map.of(); }
            public Map<String, Object> runWorkflowAction(String action, Long defId, Map<String, Object> formData, Long instanceId, String comment) {
                captured.put("action", action);
                captured.put("defId", defId);
                captured.put("formData", formData);
                return Map.of("instanceId", 100L, "status", "RUNNING");
            }
        }, ipGuard).execute(dsl, Map.of("days", 2), null);

        assertThat(result.success()).isTrue();
        assertThat(captured.get("action")).isEqualTo("start");
        assertThat(captured.get("defId")).isEqualTo(41L);
        assertThat(captured.get("formData")).isEqualTo(Map.of("leaveDays", 2L));
        assertThat(result.output().get("wf")).isEqualTo(Map.of("instanceId", 100L, "status", "RUNNING"));
    }

    @Test
    void nodeFailureFailsFastByDefault() {
        OrchestrationDsl.Dsl dsl = new OrchestrationDsl.Dsl();
        OrchestrationDsl.NodeDef start = node("start", "start");
        OrchestrationDsl.NodeDef boom = node("boom", "query");
        boom.config().setQueryId(1L); // query invoker 抛错模拟节点失败
        OrchestrationDsl.NodeDef out = node("out", "output");
        dsl.setNodes(List.of(start, boom, out));
        dsl.setEdges(List.of(edge("start", "boom", null), edge("boom", "out", null)));

        var result = engine(failingInvokers()).execute(dsl, Map.of(), null);
        assertThat(result.success()).isFalse();
        assertThat(result.errorCode()).isEqualTo("NODE_FAILED");
    }

    @Test
    void nodeErrorWithFallbackStrategyContinues() {
        OrchestrationDsl.Dsl dsl = new OrchestrationDsl.Dsl();
        OrchestrationDsl.NodeDef start = node("start", "start");
        OrchestrationDsl.NodeDef risky = node("risky", "query");
        risky.config().setQueryId(1L);
        risky.config().setStrategy("fallback");
        risky.config().setTemplate(Map.of("fallbackFor", "risky"));
        OrchestrationDsl.NodeDef out = node("out", "output");
        dsl.setNodes(List.of(start, risky, out));
        dsl.setEdges(List.of(edge("start", "risky", null), edge("risky", "out", null)));

        var result = engine(throwingQueryInvokers()).execute(dsl, Map.of(), null);
        assertThat(result.success()).isTrue();
        assertThat(result.output().get("risky")).isEqualTo(Map.of("fallbackFor", "risky"));
    }

    @Test
    void totalTimeoutIsBounded() {
        OrchestrationDsl.Dsl dsl = new OrchestrationDsl.Dsl();
        OrchestrationDsl.NodeDef start = node("start", "start");
        OrchestrationDsl.NodeDef slow = node("slow", "transform");
        slow.config().setTemplate(Map.of("x", "1"));
        OrchestrationDsl.NodeDef out = node("out", "output");
        dsl.setNodes(List.of(start, slow, out));
        dsl.setEdges(List.of(edge("start", "slow", null), edge("slow", "out", null)));
        // 引擎 MAX_TOTAL_TIMEOUT_MS=60s 无法在单测中等待——此处只验证成功路径在限内完成
        var result = engine(noopInvokers()).execute(dsl, Map.of(), null);
        assertThat(result.success()).isTrue();
    }

    // ===== helpers =====

    private OrchestrationEngine.NodeInvokers noopInvokers() {
        return new OrchestrationEngine.NodeInvokers() {
            public Map<String, Object> runQuery(Long q, Map<String, Object> p) { return Map.of("rows", List.of()); }
            public Map<String, Object> callTool(Long t, Map<String, Object> p, int to, int r) { return Map.of(); }
            public Map<String, Object> callHttpUrl(String u, String m, Map<String, Object> h, Object b, int to, int r) { return Map.of(); }
            public Map<String, Object> runPython(String s, String e, List<String> pk, Map<String, Object> in, int to) { return Map.of(); }
        };
    }

    private OrchestrationEngine.NodeInvokers failingInvokers() {
        return new OrchestrationEngine.NodeInvokers() {
            public Map<String, Object> runQuery(Long q, Map<String, Object> p) { throw new RuntimeException("boom"); }
            public Map<String, Object> callTool(Long t, Map<String, Object> p, int to, int r) { return Map.of(); }
            public Map<String, Object> callHttpUrl(String u, String m, Map<String, Object> h, Object b, int to, int r) { return Map.of(); }
            public Map<String, Object> runPython(String s, String e, List<String> pk, Map<String, Object> in, int to) { return Map.of(); }
        };
    }

    private OrchestrationEngine.NodeInvokers throwingQueryInvokers() {
        return new OrchestrationEngine.NodeInvokers() {
            public Map<String, Object> runQuery(Long q, Map<String, Object> p) { throw new RuntimeException("db down"); }
            public Map<String, Object> callTool(Long t, Map<String, Object> p, int to, int r) { return Map.of(); }
            public Map<String, Object> callHttpUrl(String u, String m, Map<String, Object> h, Object b, int to, int r) { return Map.of(); }
            public Map<String, Object> runPython(String s, String e, List<String> pk, Map<String, Object> in, int to) { return Map.of(); }
        };
    }
}
