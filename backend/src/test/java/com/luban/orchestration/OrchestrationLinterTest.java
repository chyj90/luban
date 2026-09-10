package com.luban.orchestration;

import com.luban.orchestration.dsl.OrchestrationDsl;
import com.luban.orchestration.lint.OrchestrationLinter;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** 编排 DSL lint 矩阵（M1 验收）。 */
class OrchestrationLinterTest {

    private final OrchestrationLinter linter = new OrchestrationLinter();
    private static final java.util.function.LongPredicate QUERY_72_EXISTS = id -> id == 72L;
    private static final java.util.function.LongPredicate TOOL_5_EXISTS = id -> id == 5L;

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

    private OrchestrationDsl.EdgeDef edge(String s, String t) {
        OrchestrationDsl.EdgeDef e = new OrchestrationDsl.EdgeDef();
        e.setId(s + "-" + t);
        e.setSource(s);
        e.setTarget(t);
        return e;
    }

    private OrchestrationDsl.Dsl validDsl() {
        OrchestrationDsl.Dsl dsl = new OrchestrationDsl.Dsl();
        OrchestrationDsl.NodeDef start = node("start", "start");
        OrchestrationDsl.NodeDef q = node("q1", "query");
        q.config().setQueryId(72L);
        OrchestrationDsl.NodeDef out = node("out", "output");
        dsl.setNodes(List.of(start, q, out));
        dsl.setEdges(List.of(edge("start", "q1"), edge("q1", "out")));
        return dsl;
    }

    @Test
    void validDslPasses() {
        var r = linter.lint(validDsl(), QUERY_72_EXISTS, TOOL_5_EXISTS);
        assertThat(r.passed()).as("errors=%s", r.errors()).isTrue();
    }

    @Test
    void missingStartOrOutputFails() {
        OrchestrationDsl.Dsl dsl = validDsl();
        dsl.setNodes(dsl.getNodes().stream().filter(n -> !"start".equals(n.getNodeType())).toList());
        assertThat(linter.lint(dsl, QUERY_72_EXISTS, TOOL_5_EXISTS).passed()).isFalse();

        OrchestrationDsl.Dsl dsl2 = validDsl();
        dsl2.setNodes(dsl2.getNodes().stream().filter(n -> !"output".equals(n.getNodeType())).toList());
        assertThat(linter.lint(dsl2, QUERY_72_EXISTS, TOOL_5_EXISTS).passed()).isFalse();
    }

    @Test
    void duplicateNodeIdFails() {
        OrchestrationDsl.Dsl dsl = validDsl();
        OrchestrationDsl.NodeDef dup = node("q1", "transform");
        dsl.setNodes(List.of(dsl.getNodes().get(0), dsl.getNodes().get(1), dup, dsl.getNodes().get(2)));
        var r = linter.lint(dsl, QUERY_72_EXISTS, TOOL_5_EXISTS);
        assertThat(r.errors().stream().anyMatch(e -> e.contains("重复"))).isTrue();
    }

    @Test
    void danglingEdgeFails() {
        OrchestrationDsl.Dsl dsl = validDsl();
        dsl.setEdges(List.of(edge("start", "q1"), edge("q1", "out"), edge("q1", "ghost")));
        var r = linter.lint(dsl, QUERY_72_EXISTS, TOOL_5_EXISTS);
        assertThat(r.errors().stream().anyMatch(e -> e.contains("ghost"))).isTrue();
    }

    @Test
    void missingQueryReferenceFails() {
        OrchestrationDsl.Dsl dsl = validDsl();
        dsl.getNodes().get(1).config().setQueryId(999L);
        var r = linter.lint(dsl, QUERY_72_EXISTS, TOOL_5_EXISTS);
        assertThat(r.errors().stream().anyMatch(e -> e.contains("999"))).isTrue();
    }

    @Test
    void invalidConditionSyntaxFails() {
        OrchestrationDsl.Dsl dsl = validDsl();
        OrchestrationDsl.NodeDef cond = node("cond", "condition");
        OrchestrationDsl.NodeDef out2 = node("out2", "output");
        dsl.setNodes(List.of(dsl.getNodes().get(0), cond, out2));
        OrchestrationDsl.EdgeDef e = edge("cond", "out2");
        e.setCondition("leaveDays =< 3; DROP TABLE"); // 非法语法
        dsl.setEdges(List.of(edge("start", "cond"), e));
        var r = linter.lint(dsl, QUERY_72_EXISTS, TOOL_5_EXISTS);
        assertThat(r.errors().stream().anyMatch(x -> x.contains("条件表达式语法无效"))).isTrue();
    }

    @Test
    void invalidVariableSyntaxFails() {
        OrchestrationDsl.Dsl dsl = validDsl();
        dsl.getNodes().get(1).config().setParamsTemplate(Map.of("id", "$input..bad..path"));
        var r = linter.lint(dsl, QUERY_72_EXISTS, TOOL_5_EXISTS);
        assertThat(r.errors().stream().anyMatch(e -> e.contains("变量引用语法无效"))).isTrue();
    }

    @Test
    void disconnectedBranchWarnsAndBlocksOutput() {
        OrchestrationDsl.Dsl dsl = validDsl();
        // 孤立节点（不可达）：output 不可达时 error
        OrchestrationDsl.NodeDef orphan = node("orphan", "transform");
        orphan.config().setTemplate(Map.of("a", "$input.x"));
        dsl.setNodes(List.of(dsl.getNodes().get(0), orphan, dsl.getNodes().get(2)));
        dsl.setEdges(List.of(edge("start", "orphan"))); // start 不再连 output
        var r = linter.lint(dsl, QUERY_72_EXISTS, TOOL_5_EXISTS);
        assertThat(r.errors().stream().anyMatch(e -> e.contains("start 无法到达 output"))).isTrue();
    }

    @Test
    void pythonWithoutMainFails() {
        OrchestrationDsl.Dsl dsl = validDsl();
        OrchestrationDsl.NodeDef py = node("py", "python");
        py.config().setSource("print('hello')");
        dsl.setNodes(List.of(dsl.getNodes().get(0), py, dsl.getNodes().get(2)));
        dsl.setEdges(List.of(edge("start", "py"), edge("py", "out")));
        var r = linter.lint(dsl, QUERY_72_EXISTS, TOOL_5_EXISTS);
        assertThat(r.errors().stream().anyMatch(e -> e.contains("def main(ctx)"))).isTrue();
    }

    @Test
    void pythonForbiddenImportFails() {
        OrchestrationDsl.Dsl dsl = validDsl();
        OrchestrationDsl.NodeDef py = node("py", "python");
        py.config().setSource("import os\ndef main(ctx):\n    return os.environ");
        dsl.setNodes(List.of(dsl.getNodes().get(0), py, dsl.getNodes().get(2)));
        dsl.setEdges(List.of(edge("start", "py"), edge("py", "out")));
        var r = linter.lint(dsl, QUERY_72_EXISTS, TOOL_5_EXISTS);
        assertThat(r.errors().stream().anyMatch(e -> e.contains("禁止 import 模块: os"))).isTrue();
    }

    @Test
    void pythonForbiddenBuiltinCallFails() {
        OrchestrationDsl.Dsl dsl = validDsl();
        OrchestrationDsl.NodeDef py = node("py", "python");
        py.config().setSource("def main(ctx):\n    return eval('1+1')");
        dsl.setNodes(List.of(dsl.getNodes().get(0), py, dsl.getNodes().get(2)));
        dsl.setEdges(List.of(edge("start", "py"), edge("py", "out")));
        var r = linter.lint(dsl, QUERY_72_EXISTS, TOOL_5_EXISTS);
        assertThat(r.errors().stream().anyMatch(e -> e.contains("被禁止的内置调用"))).isTrue();
    }

    @Test
    void workflowNodeValidation() {
        // start 无效
        OrchestrationDsl.Dsl dsl = validDsl();
        OrchestrationDsl.NodeDef wf = node("wf", "workflow");
        wf.config().setWorkflowAction("start");
        dsl.setNodes(List.of(dsl.getNodes().get(0), wf, dsl.getNodes().get(2)));
        dsl.setEdges(List.of(edge("start", "wf"), edge("wf", "out")));
        var r = linter.lint(dsl, QUERY_72_EXISTS, TOOL_5_EXISTS, id -> false);
        assertThat(r.errors().stream().anyMatch(e -> e.contains("缺少 workflowDefinitionId"))).isTrue();

        // definitionId 不存在
        OrchestrationDsl.Dsl dsl2 = validDsl();
        OrchestrationDsl.NodeDef wf2 = node("wf", "workflow");
        wf2.config().setWorkflowAction("start");
        wf2.config().setWorkflowDefinitionId(999L);
        dsl2.setNodes(List.of(dsl2.getNodes().get(0), wf2, dsl2.getNodes().get(2)));
        dsl2.setEdges(List.of(edge("start", "wf"), edge("wf", "out")));
        System.err.println("[DBG] after setNodes: ids=" + dsl2.getNodes().stream().map(n -> n.getId()).toList());
        var r2 = linter.lint(dsl2, QUERY_72_EXISTS, TOOL_5_EXISTS, id -> id == 7L);
        assertThat(r2.errors().stream().anyMatch(e -> e.contains("999"))).isTrue();

        // 合法（definitionId=7 存在）
        OrchestrationDsl.Dsl dsl3 = validDsl();
        OrchestrationDsl.NodeDef wf3 = node("wf", "workflow");
        wf3.config().setWorkflowAction("start");
        wf3.config().setWorkflowDefinitionId(7L);
        wf3.config().setFormDataTemplate(Map.of("leaveDays", "$input.days"));
        dsl3.setNodes(List.of(dsl3.getNodes().get(0), wf3, dsl3.getNodes().get(2)));
        dsl3.setEdges(List.of(edge("start", "wf"), edge("wf", "out")));
        var r3 = linter.lint(dsl3, QUERY_72_EXISTS, TOOL_5_EXISTS, id -> id == 7L);
        assertThat(r3.errors()).as("dsl3 应无错误").isEmpty();

        // approve 缺实例引用
        OrchestrationDsl.Dsl dsl4 = validDsl();
        OrchestrationDsl.NodeDef wf4 = node("wf", "workflow");
        wf4.config().setWorkflowAction("approve");
        dsl4.setNodes(List.of(dsl4.getNodes().get(0), wf4, dsl4.getNodes().get(2)));
        dsl4.setEdges(List.of(edge("start", "wf"), edge("wf", "out")));
        assertThat(linter.lint(dsl4, QUERY_72_EXISTS, TOOL_5_EXISTS, id -> false).passed()).isFalse();
    }

    @Test
    void whitelistedPythonModulePasses() {
        OrchestrationDsl.Dsl dsl = validDsl();
        OrchestrationDsl.NodeDef py = node("py", "python");
        py.config().setSource("import json\ndef main(ctx):\n    return json.dumps(ctx)");
        dsl.setNodes(List.of(dsl.getNodes().get(0), py, dsl.getNodes().get(2)));
        dsl.setEdges(List.of(edge("start", "py"), edge("py", "out")));
        var r = linter.lint(dsl, QUERY_72_EXISTS, TOOL_5_EXISTS);
        assertThat(r.errors()).isEmpty();
    }
}
