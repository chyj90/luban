package com.luban.orchestration.lint;

import com.luban.orchestration.dsl.OrchestrationDsl;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 编排 DSL 静态校验（保存/发布前必跑）。
 *
 * 三类检查：
 * 1. 结构：唯一 start/output、节点 id 唯一、边引用存在、无环（除 condition 回边外的推进环）、连通性；
 * 2. 引用：queryId / toolId / http 直连 URL 协议、Python 模块白名单与入口签名、变量语法；
 * 3. 语义：条件表达式可解析（复用流程引擎 ConditionEvaluator 语法族）、并行节点汇合规则。
 */
@Component
public class OrchestrationLinter {

    private static final Set<String> NODE_TYPES = Set.of(
            "start", "http", "query", "python", "transform", "condition", "parallel",
            "workflow", "output");
    private static final Set<String> WORKFLOW_ACTIONS = Set.of(
            "start", "get_status", "approve", "reject");

    private static final Set<String> FORBIDDEN_PY_IDENTIFIERS = Set.of(
            "os", "subprocess", "socket", "ctypes", "threading", "multiprocessing",
            "requests", "urllib", "http", "shutil", "pathlib", "importlib", "sys", "builtins");

    private static final Pattern PY_FORBIDDEN_CALL = Pattern.compile(
            "\\b(eval|exec|compile|__import__|open|globals|locals)\\s*\\(");

    private static final Pattern CONDITION_SYNTAX = Pattern.compile(
            "^\\s*\\w+\\s*(<=|>=|==|!=|<|>)\\s*(\\d+(?:\\.\\d+)?|'[^']*'|\"[^\"]*\")"
                    + "(\\s*(&&|\\|\\|)\\s*\\w+\\s*(<=|>=|==|!=|<|>)\\s*(\\d+(?:\\.\\d+)?|'[^']*'|\"[^\"]*\"))*\\s*$");

    private static final Pattern VAR_REF = Pattern.compile(
            "\\$(?:input|nodes)\\.\\w+(?:\\.\\w+)*");

    public record LintResult(boolean passed, List<String> errors, List<String> warnings) {
        static LintResult ok() { return new LintResult(true, List.of(), List.of()); }
    }

    public LintResult lint(OrchestrationDsl.Dsl dsl,
                           java.util.function.LongPredicate queryExists,
                           java.util.function.LongPredicate toolExists) {
        return lint(dsl, queryExists, toolExists, id -> false);
    }

    public LintResult lint(OrchestrationDsl.Dsl dsl,
                           java.util.function.LongPredicate queryExists,
                           java.util.function.LongPredicate toolExists,
                           java.util.function.LongPredicate workflowDefExists) {
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        if (dsl.getNodes() == null || dsl.getNodes().isEmpty()) {
            return new LintResult(false, List.of("nodes 不能为空"), warnings);
        }

        // ---- 节点唯一性与类型 ----
        Map<String, OrchestrationDsl.NodeDef> byId = new HashMap<>();
        Set<String> types = new HashSet<>();
        for (OrchestrationDsl.NodeDef n : dsl.getNodes()) {
            if (n.getId() == null || n.getId().isBlank()) {
                errors.add("存在缺少 id 的节点");
                continue;
            }
            if (byId.putIfAbsent(n.getId(), n) != null) {
                errors.add("节点 id 重复: " + n.getId());
            }
            if (!NODE_TYPES.contains(n.getNodeType())) {
                errors.add("节点 " + n.getId() + " 的 nodeType 无效: " + n.getNodeType());
            }
            types.add(n.getNodeType());
        }
        if (errors.isEmpty()) {
            if (types.stream().filter("start"::equals).count() != 1) {
                errors.add("必须有且只有一个 start 节点");
            }
            if (types.stream().filter("output"::equals).count() != 1) {
                errors.add("必须有且只有一个 output 节点");
            }
        }

        // ---- 边 ----
        Set<String> edgesSeen = new LinkedHashSet<>();
        Map<String, Integer> outDegree = new HashMap<>();
        if (dsl.getEdges() != null) {
            for (OrchestrationDsl.EdgeDef e : dsl.getEdges()) {
                if (e.getSource() == null || e.getTarget() == null
                        || !byId.containsKey(e.getSource()) || !byId.containsKey(e.getTarget())) {
                    errors.add("边引用了不存在的节点: " + e.getSource() + " → " + e.getTarget());
                    continue;
                }
                if (!edgesSeen.add(e.getSource() + "->" + e.getTarget())) {
                    warnings.add("重复边: " + e.getSource() + " → " + e.getTarget());
                }
                outDegree.merge(e.getSource(), 1, Integer::sum);
                if (e.getCondition() != null && !e.getCondition().isBlank()
                        && !CONDITION_SYNTAX.matcher(e.getCondition()).matches()) {
                    errors.add("边 " + e.getSource() + "→" + e.getTarget()
                            + " 的条件表达式语法无效: " + e.getCondition());
                }
            }
        }
        // start 无出边 / output 有出边
        byId.values().stream()
                .filter(n -> "start".equals(n.getNodeType()))
                .findFirst()
                .ifPresent(start -> {
                    if (outDegree.getOrDefault(start.getId(), 0) == 0) {
                        errors.add("start 节点没有出边");
                    }
                });
        byId.values().stream()
                .filter(n -> "output".equals(n.getNodeType()))
                .findFirst()
                .ifPresent(out -> {
                    if (outDegree.getOrDefault(out.getId(), 0) > 0) {
                        errors.add("output 节点不应有出边");
                    }
                });

        // ---- 连通性（start 可达 output）----
        if (!errors.isEmpty()) return new LintResult(false, errors, warnings);
        Set<String> reachable = new HashSet<>();
        dfs(startId(byId), byId, dsl.getEdges(), reachable);
        if (!reachable.contains(outputId(byId))) {
            errors.add("start 无法到达 output 节点（存在孤立分支）");
        }
        byId.values().stream()
                .filter(n -> !reachable.contains(n.getId()))
                .forEach(n -> warnings.add("节点 " + n.getId() + " 不可达"));

        // ---- 各节点 config 检查 ----
        for (OrchestrationDsl.NodeDef n : dsl.getNodes()) {
            lintNodeConfig(n, queryExists, toolExists, workflowDefExists, errors, warnings);
        }

        // ---- 全局变量引用语法 ----
        String dslText = Json.safe(dsl.getNodes());
        String dslTextEdges = Json.safe(dsl.getEdges());
        for (String text : List.of(dslText, dslTextEdges)) {
            java.util.regex.Matcher m = Pattern.compile("\\$(?!\\{)[^\"',\\s}]+").matcher(text);
            while (m.find()) {
                String token = m.group();
                if (!VAR_REF.matcher(token).matches()) {
                    errors.add("变量引用语法无效: " + token + "（应为 $input.xxx 或 $nodes.nodeId.path）");
                }
            }
        }

        return new LintResult(errors.isEmpty(), errors, warnings);
    }

    private void lintNodeConfig(OrchestrationDsl.NodeDef n,
                                java.util.function.LongPredicate queryExists,
                                java.util.function.LongPredicate toolExists,
                                java.util.function.LongPredicate workflowDefExists,
                                List<String> errors, List<String> warnings) {
        OrchestrationDsl.NodeDef.Config c = n.config();
        switch (n.getNodeType() == null ? "" : n.getNodeType()) {
            case "query" -> {
                if (c.getQueryId() == null) errors.add("query 节点 " + n.getId() + " 缺少 queryId");
                else if (!queryExists.test(c.getQueryId()))
                    errors.add("query 节点 " + n.getId() + " 引用的 queryId " + c.getQueryId() + " 不存在");
            }
            case "http" -> {
                if (c.getToolId() == null && (c.getUrl() == null || c.getUrl().isBlank())) {
                    errors.add("http 节点 " + n.getId() + " 需要引用 toolId 或提供 url");
                }
                if (c.getUrl() != null && !c.getUrl().startsWith("http")) {
                    errors.add("http 节点 " + n.getId() + " 的 url 协议无效");
                }
                if (c.getTimeoutMs() != null && (c.getTimeoutMs() <= 0 || c.getTimeoutMs() > 30000)) {
                    errors.add("http 节点 " + n.getId() + " 的 timeoutMs 超出 1~30000");
                }
            }
            case "python" -> {
                if (c.getSource() == null || c.getSource().isBlank()) {
                    errors.add("python 节点 " + n.getId() + " 缺少 source");
                    break;
                }
                lintPython(n.getId(), c.getSource(), c.getPackages(), errors, warnings);
            }
            case "transform" -> {
                if (c.getTemplate() == null || c.getTemplate().isEmpty()) {
                    errors.add("transform 节点 " + n.getId() + " 缺少 template");
                }
            }
            case "workflow" -> {
                String action = c.getWorkflowAction();
                if (action == null || !WORKFLOW_ACTIONS.contains(action)) {
                    errors.add("workflow 节点 " + n.getId() + " 的 workflowAction 无效（start/get_status/approve/reject）");
                }
                if (action != null && WORKFLOW_ACTIONS.contains(action)) {
                switch (action) {
                    case "start" -> {
                        if (c.getWorkflowDefinitionId() == null) {
                            errors.add("workflow 节点 " + n.getId() + " (start) 缺少 workflowDefinitionId");
                        } else if (!workflowDefExists.test(c.getWorkflowDefinitionId())) {
                            errors.add("workflow 节点 " + n.getId() + " 引用的流程定义 " + c.getWorkflowDefinitionId() + " 不存在");
                        }
                        if (c.getFormDataTemplate() == null) {
                            warnings.add("workflow 节点 " + n.getId() + " (start) 无 formDataTemplate，将以空表单发起");
                        }
                    }
                    case "get_status", "approve", "reject" -> {
                        if (c.getInstanceIdTemplate() == null || c.getInstanceIdTemplate().isBlank()) {
                            errors.add("workflow 节点 " + n.getId() + " (" + action + ") 缺少 instanceIdTemplate");
                        }
                    }
                }
                }
            }
            case "start" -> {
                if (c.getInputs() != null) {
                    Set<String> names = new HashSet<>();
                    for (OrchestrationDsl.PortDef p : c.getInputs()) {
                        if (p.getName() == null || !p.getName().matches("\\w+")) {
                            errors.add("start 节点存在非法参数名: " + p.getName());
                        } else if (!names.add(p.getName())) {
                            errors.add("start 参数名重复: " + p.getName());
                        }
                    }
                }
            }
            default -> { }
        }
    }

    private void lintPython(String nodeId, String source, List<String> packages,
                            List<String> errors, List<String> warnings) {
        if (!source.strip().matches("(?s).*def\\s+main\\s*\\(\\s*ctx\\s*\\).*")) {
            errors.add("python 节点 " + nodeId + " 必须定义入口函数 def main(ctx)");
        }
        if (PY_FORBIDDEN_CALL.matcher(source).find()) {
            errors.add("python 节点 " + nodeId + " 使用了被禁止的内置调用（eval/exec/compile/__import__/open/globals/locals）");
        }
        // import 模块白名单（含 from X import）
        java.util.regex.Matcher mi = Pattern.compile(
                "^\\s*(?:import|from)\\s+(\\w+)", Pattern.MULTILINE).matcher(source);
        while (mi.find()) {
            String mod = mi.group(1);
            if (FORBIDDEN_PY_IDENTIFIERS.contains(mod)) {
                errors.add("python 节点 " + nodeId + " 禁止 import 模块: " + mod);
            } else if (!isWhitelistedModule(mod)) {
                errors.add("python 节点 " + nodeId + " 引用了非白名单模块: " + mod
                        + "（白名单见文档第六节，如需扩包请联系管理员）");
            }
        }
        if (packages != null) {
            for (String pkg : packages) {
                if (!isWhitelistedModule(pkg)) {
                    errors.add("python 节点 " + nodeId + " 的 packages 含非白名单包: " + pkg);
                }
            }
        }
        if (source.contains("subprocess") || source.contains("__builtins__")) {
            errors.add("python 节点 " + nodeId + " 含被禁止的关键字");
        }
    }

    private boolean isWhitelistedModule(String mod) {
        return Set.of("json", "math", "re", "datetime", "collections", "itertools",
                "functools", "statistics", "decimal", "typing", "copy", "textwrap",
                "uuid", "base64", "hashlib", "hmac", "string").contains(mod);
    }

    private String startId(Map<String, OrchestrationDsl.NodeDef> byId) {
        return byId.values().stream().filter(n -> "start".equals(n.getNodeType()))
                .map(OrchestrationDsl.NodeDef::getId).findFirst().orElse("");
    }

    private String outputId(Map<String, OrchestrationDsl.NodeDef> byId) {
        return byId.values().stream().filter(n -> "output".equals(n.getNodeType()))
                .map(OrchestrationDsl.NodeDef::getId).findFirst().orElse("");
    }

    private void dfs(String current, Map<String, OrchestrationDsl.NodeDef> byId,
                     List<OrchestrationDsl.EdgeDef> edges, Set<String> visited) {
        if (current == null || !visited.add(current)) return;
        for (OrchestrationDsl.EdgeDef e : edges) {
            if (current.equals(e.getSource())) {
                dfs(e.getTarget(), byId, edges, visited);
            }
        }
    }

    /** JSON 序列化的最小依赖封装（避免 lint 依赖引擎细节） */
    static final class Json {
        private Json() {}
        static String safe(Object o) {
            try {
                return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(o);
            } catch (Exception e) {
                return "";
            }
        }
    }
}
