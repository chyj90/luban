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
            "workflow", "subflow", "output");
    private static final Set<String> WORKFLOW_ACTIONS = Set.of(
            "start", "get_status", "approve", "reject");

    private static final Set<String> FORBIDDEN_PY_IDENTIFIERS = Set.of(
            "os", "subprocess", "socket", "ctypes", "threading", "multiprocessing",
            "requests", "urllib", "http", "shutil", "pathlib", "importlib", "sys", "builtins");

    private static final Pattern PY_FORBIDDEN_CALL = Pattern.compile(
            "\\b(eval|exec|compile|__import__|open|globals|locals)\\s*\\(");

    private static final Pattern CONDITION_SYNTAX = Pattern.compile(
            "^\\s*[\\w\\[\\]\\.]+\\s*(<=|>=|==|!=|<|>)\\s*(\\d+(?:\\.\\d+)?|'[^']*'|\"[^\"]*\"|[\\w\\[\\]\\.]+)"
                    + "(\\s*(&&|\\|\\|)\\s*[\\w\\[\\]\\.]+\\s*(<=|>=|==|!=|<|>)\\s*(\\d+(?:\\.\\d+)?|'[^']*'|\"[^\"]*\"|[\\w\\[\\]\\.]+))*\\s*$");

    private static final Pattern VAR_REF = Pattern.compile(
            "\\$(?:input|nodes)\\.\\w+(?:\\.\\w+)*");

    public record LintResult(boolean passed, List<String> errors, List<String> warnings) {
        static LintResult ok() { return new LintResult(true, List.of(), List.of()); }
    }

    /** DSL 顶层已知字段 */
    private static final Set<String> KNOWN_DSL_KEYS = Set.of("nodes", "edges");
    /** 节点顶层已知字段（React Flow 风格结构） */
    private static final Set<String> KNOWN_NODE_KEYS = Set.of("id", "nodeType", "position", "data");
    /** data 已知字段 */
    private static final Set<String> KNOWN_DATA_KEYS = Set.of("label", "config");
    /** data.config 已知字段（与 OrchestrationDsl.NodeDef.Config 对齐） */
    private static final Set<String> KNOWN_CONFIG_KEYS = Set.of(
            "inputs", "toolId", "url", "method", "headers", "paramsTemplate", "bodyTemplate",
            "workflowAction", "workflowDefinitionId", "instanceIdTemplate", "formDataTemplate",
            "comment", "timeoutMs", "retries", "queryId", "source", "entry", "packages",
            "template", "strategy", "subOrchestrationId");

    /**
     * 常见字段名错误的纠正提示（LLM 生成的 DSL 高频踩坑点）。
     * 反序列化标了 ignoreUnknown=true 会把错误字段静默丢弃，这里把丢弃变成显式报错，
     * 否则节点会反序列化成 nodeType=null 的空壳，调用方只能看到莫名 500。
     */
    private static final Map<String, String> FIELD_SUGGESTIONS = Map.of(
            "type", "字段名应为 nodeType（不是 type）",
            "params", "start 入参应写为 data.config.inputs（数组，元素含 name/type/required）",
            "code", "python 代码应写为 data.config.source（入口必须 def main(ctx)）",
            "processName", "workflow 节点不支持按名称引用，应写 data.config.workflowAction + data.config.workflowDefinitionId（数字 ID，必须已存在）",
            "formData", "发起流程的表单应写为 data.config.formDataTemplate",
            "url", "http 直连地址应写为 data.config.url（且仅限 IpGuard 白名单地址，写库请用 query 节点 + 已有查询）",
            "method", "http 方法应写为 data.config.method",
            "body", "http 请求体应写为 data.config.bodyTemplate",
            "queryId", "query 节点的查询 ID 应写为 data.config.queryId",
            "result", "output 节点无配置；编排返回值为各节点输出按节点 id 组成的字典，最终结构请在 python 节点中整形");

    /**
     * 对原始 DSL JSON 做未知字段扫描（解析失败时返回空，由 parseDsl 报错）。
     * 节点级未知字段计为 error（会静默改变语义），顶层未知字段计为 warning（通常是误放的元数据）。
     */
    public LintResult checkUnknownFields(String dslJson) {
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        if (dslJson == null || dslJson.isBlank()) return new LintResult(true, errors, warnings);
        com.fasterxml.jackson.databind.JsonNode root;
        try {
            root = new com.fasterxml.jackson.databind.ObjectMapper().readTree(dslJson);
        } catch (Exception e) {
            return new LintResult(true, errors, warnings); // JSON 语法错误由 parseDsl 负责
        }
        if (!root.isObject()) return new LintResult(true, errors, warnings);

        root.fieldNames().forEachRemaining(f -> {
            if (!KNOWN_DSL_KEYS.contains(f)) {
                warnings.add("DSL 顶层存在未知字段 \"" + f + "\"（将被忽略；DSL 顶层仅支持 nodes/edges）");
            }
        });

        com.fasterxml.jackson.databind.JsonNode nodes = root.get("nodes");
        if (nodes != null && nodes.isArray()) {
            for (com.fasterxml.jackson.databind.JsonNode node : nodes) {
                if (!node.isObject()) continue;
                String nodeId = node.path("id").asText("(缺少id)");
                node.fieldNames().forEachRemaining(f -> {
                    if (KNOWN_NODE_KEYS.contains(f)) return;
                    errors.add("节点 " + nodeId + " 存在未知字段 \"" + f + "\"（将被忽略）"
                            + (FIELD_SUGGESTIONS.containsKey(f) ? "：" + FIELD_SUGGESTIONS.get(f) : ""));
                });
                com.fasterxml.jackson.databind.JsonNode data = node.get("data");
                if (data != null && data.isObject()) {
                    data.fieldNames().forEachRemaining(f -> {
                        if (KNOWN_DATA_KEYS.contains(f)) return;
                        errors.add("节点 " + nodeId + " 的 data 存在未知字段 \"" + f + "\"（将被忽略）："
                                + (FIELD_SUGGESTIONS.containsKey(f) ? FIELD_SUGGESTIONS.get(f) : "节点配置应放在 data.config 下"));
                    });
                    com.fasterxml.jackson.databind.JsonNode config = data.get("config");
                    if (config != null && config.isObject()) {
                        config.fieldNames().forEachRemaining(f -> {
                            if (KNOWN_CONFIG_KEYS.contains(f)) return;
                            errors.add("节点 " + nodeId + " 的 data.config 存在未知字段 \"" + f + "\"（将被忽略）"
                                    + (FIELD_SUGGESTIONS.containsKey(f) ? "：" + FIELD_SUGGESTIONS.get(f) : ""));
                        });
                    }
                }
            }
        }
        return new LintResult(errors.isEmpty(), errors, warnings);
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
        return lint(dsl, queryExists, toolExists, workflowDefExists, id -> false);
    }

    public LintResult lint(OrchestrationDsl.Dsl dsl,
                           java.util.function.LongPredicate queryExists,
                           java.util.function.LongPredicate toolExists,
                           java.util.function.LongPredicate workflowDefExists,
                           java.util.function.LongPredicate orchestrationExists) {
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
            // Set.of 不可变集合 contains(null) 会抛 NPE（对外表现为无诊断信息的 500），
            // 必须先判空；null 恰恰是最常见的契约错误（LLM 写成 "type" 被 ignoreUnknown 静默丢弃）
            String nodeType = n.getNodeType();
            if (nodeType == null || nodeType.isBlank()) {
                errors.add("节点 " + n.getId() + " 缺少 nodeType（字段名必须是 nodeType 而不是 type，"
                        + "节点配置必须嵌套在 data.config 下，参见 DSL 契约示例）");
            } else if (!NODE_TYPES.contains(nodeType)) {
                errors.add("节点 " + n.getId() + " 的 nodeType 无效: " + nodeType
                        + "（有效类型: " + String.join("/", NODE_TYPES) + "）");
            }
            // 名称建议：缺 label 不阻塞，但提醒
            if (n.getData() == null || n.getData().getLabel() == null || n.getData().getLabel().isBlank()) {
                warnings.add("节点 " + n.getId() + " 缺少名称（label），建议为每个节点设置可读名称");
            }
            if (nodeType != null) {
                types.add(nodeType);
            }
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
            lintNodeConfig(n, queryExists, toolExists, workflowDefExists, orchestrationExists, errors, warnings);
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
                                java.util.function.LongPredicate orchestrationExists,
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
            case "subflow" -> {
                if (c.getSubOrchestrationId() == null) {
                    errors.add("subflow 节点 " + n.getId() + " 缺少 subOrchestrationId");
                } else if (!orchestrationExists.test(c.getSubOrchestrationId())) {
                    errors.add("subflow 节点 " + n.getId() + " 引用的编排定义 " + c.getSubOrchestrationId() + " 不存在");
                }
                if (c.getParamsTemplate() == null) {
                    warnings.add("subflow 节点 " + n.getId() + " 无 paramsTemplate，子编排将以空入参执行");
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
        for (OrchestrationDsl.EdgeDef e : edges == null ? List.<OrchestrationDsl.EdgeDef>of() : edges) {
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