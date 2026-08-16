package com.luban.workflow.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
@RequiredArgsConstructor
public class LintService {

    private final ObjectMapper objectMapper;

    private static final List<String> REQUIRED_HTML_PATTERNS = List.of(
        "id=\"workflow-form\"",
        "class=\"form-field\"",
        "data-field=\"",
        "class=\"form-input\"",
        "class=\"field-error\"",
        "class=\"form-label\"",
        "class=\"required-mark\""
    );

    private static final List<String> REQUIRED_CSS_PATTERNS = List.of(
        "#workflow-form",
        ".form-field",
        ".form-input",
        ".field-error",
        ".readonly",
        ".hidden",
        "@media"
    );

    private static final List<String> FORBIDDEN_JS_PATTERNS = List.of(
        "=>",
        "const ",
        "let ",
        "addEventListener",
        "import ",
        "export ",
        "fetch(",
        "axios.",
        "console.log"
    );

    private static final List<String> REQUIRED_JS_PATTERNS = List.of(
        "function getFormData",
        "function validateForm",
        "function submitForm"
    );

    private static final Set<String> VALID_FIELD_TYPES = Set.of(
        "text", "textarea", "number", "amount", "select", "multi_select",
        "radio", "checkbox", "date", "datetime", "switch", "file", "excel",
        "member", "department", "detail_table", "computed", "reference"
    );

    private static final Set<String> VALID_NODE_TYPES = Set.of(
        "start", "approval", "condition", "parallel", "cc", "sub_process", "end"
    );

    public Map<String, Object> lintFormCode(String html, String css, String js) {
        List<Map<String, Object>> errors = new ArrayList<>();
        List<Map<String, Object>> warnings = new ArrayList<>();

        if (html != null && !html.isEmpty()) {
            lintHtml(html, errors, warnings);
        }
        if (css != null && !css.isEmpty()) {
            lintCss(css, errors, warnings);
        }
        if (js != null && !js.isEmpty()) {
            lintJs(js, errors, warnings);
        }

        return buildResult(errors, warnings);
    }

    private void lintHtml(String html, List<Map<String, Object>> errors, List<Map<String, Object>> warnings) {
        for (String pattern : REQUIRED_HTML_PATTERNS) {
            if (!html.contains(pattern)) {
                errors.add(Map.of("category", "HTML", "message", "缺少必填元素: " + pattern, "severity", "ERROR"));
            }
        }

        Pattern dataFieldPattern = Pattern.compile("data-field=\"([^\"]+)\"");
        Pattern namePattern = Pattern.compile("name=\"([^\"]+)\"");
        Matcher dfMatcher = dataFieldPattern.matcher(html);
        Matcher nMatcher = namePattern.matcher(html);

        Set<String> dataFields = new HashSet<>();
        Set<String> names = new HashSet<>();
        while (dfMatcher.find()) dataFields.add(dfMatcher.group(1));
        while (nMatcher.find()) names.add(nMatcher.group(1));

        for (String df : dataFields) {
            if (!names.contains(df)) {
                warnings.add(Map.of("category", "HTML", "message",
                    "data-field=\"" + df + "\" 缺少对应的 name 属性", "severity", "WARNING"));
            }
        }
    }

    private void lintCss(String css, List<Map<String, Object>> errors, List<Map<String, Object>> warnings) {
        for (String pattern : REQUIRED_CSS_PATTERNS) {
            if (!css.contains(pattern)) {
                warnings.add(Map.of("category", "CSS", "message", "缺少建议样式: " + pattern, "severity", "WARNING"));
            }
        }
    }

    private void lintJs(String js, List<Map<String, Object>> errors, List<Map<String, Object>> warnings) {
        for (String pattern : FORBIDDEN_JS_PATTERNS) {
            if (js.contains(pattern)) {
                errors.add(Map.of("category", "JS", "message", "使用了禁止语法: " + pattern, "severity", "ERROR"));
            }
        }
        for (String pattern : REQUIRED_JS_PATTERNS) {
            if (!js.contains(pattern)) {
                errors.add(Map.of("category", "JS", "message", "缺少必填函数: " + pattern, "severity", "ERROR"));
            }
        }
    }

    public Map<String, Object> lintFieldSchema(String fieldsJson) {
        List<Map<String, Object>> errors = new ArrayList<>();
        List<Map<String, Object>> warnings = new ArrayList<>();

        try {
            JsonNode fields = objectMapper.readTree(fieldsJson);
            if (!fields.isArray()) {
                errors.add(Map.of("category", "Schema", "message", "fields 必须是数组", "severity", "ERROR"));
                return buildResult(errors, warnings);
            }

            Set<String> keys = new HashSet<>();
            for (JsonNode field : fields) {
                if (!field.has("key")) {
                    errors.add(Map.of("category", "Schema", "message", "字段缺少 key", "severity", "ERROR"));
                } else {
                    String key = field.get("key").asText();
                    if (keys.contains(key)) {
                        errors.add(Map.of("category", "Schema", "message",
                            "字段 key 重复: " + key, "severity", "ERROR"));
                    }
                    keys.add(key);
                }

                if (!field.has("type")) {
                    errors.add(Map.of("category", "Schema", "message", "字段缺少 type", "severity", "ERROR"));
                } else {
                    String type = field.get("type").asText();
                    if (!VALID_FIELD_TYPES.contains(type)) {
                        warnings.add(Map.of("category", "Schema", "message",
                            "未知字段类型: " + type, "severity", "WARNING"));
                    }
                    if (Set.of("select", "multi_select", "radio", "checkbox").contains(type)) {
                        if (!field.has("options") || field.get("options").isEmpty()) {
                            String fieldKey = field.has("key") ? field.get("key").asText() : "unknown";
                            warnings.add(Map.of("category", "Schema", "message",
                                "选择类字段 " + fieldKey + " 缺少 options", "severity", "WARNING"));
                        }
                    }
                }

                if (!field.has("label")) {
                    warnings.add(Map.of("category", "Schema", "message", "字段缺少 label", "severity", "WARNING"));
                }
            }
        } catch (JsonProcessingException e) {
            errors.add(Map.of("category", "Schema", "message",
                "JSON 格式错误: " + e.getMessage(), "severity", "ERROR"));
        }

        return buildResult(errors, warnings);
    }

    public Map<String, Object> lintWorkflow(String nodesJson, String edgesJson, String fieldsJson) {
        List<Map<String, Object>> errors = new ArrayList<>();
        List<Map<String, Object>> warnings = new ArrayList<>();

        try {
            JsonNode nodes = objectMapper.readTree(nodesJson);
            JsonNode edges = objectMapper.readTree(edgesJson);
            Set<String> nodeIds = new HashSet<>();
            Set<String> fieldKeys = extractFieldKeys(fieldsJson);

            if (!nodes.isArray()) {
                errors.add(Map.of("category", "Workflow", "message", "nodes 必须是数组", "severity", "ERROR"));
                return buildResult(errors, warnings);
            }

            boolean hasStart = false, hasEnd = false;
            boolean hasNodeTypeHint = false;
            for (JsonNode node : nodes) {
                if (!node.has("nodeId")) {
                    errors.add(Map.of("category", "Workflow", "message", "节点缺少 nodeId", "severity", "ERROR"));
                    continue;
                }
                String nodeId = node.get("nodeId").asText();
                nodeIds.add(nodeId);

                if (node.has("nodeType")) {
                    String nodeType = node.get("nodeType").asText();
                    if ("start".equals(nodeType)) hasStart = true;
                    if ("end".equals(nodeType)) hasEnd = true;
                    if (!VALID_NODE_TYPES.contains(nodeType)) {
                        warnings.add(Map.of("category", "Workflow", "message",
                            "未知节点类型: " + nodeType + " (节点: " + nodeId + ")，有效值: " + VALID_NODE_TYPES, "severity", "WARNING"));
                    }
                } else {
                    if (node.has("data") && node.get("data").has("nodeType")) {
                        hasNodeTypeHint = true;
                    }
                    errors.add(Map.of("category", "Workflow", "message",
                        "节点 " + nodeId + " 缺少顶层 nodeType 字段，lint 通过 node.has(\"nodeType\") 读取节点类型，请将 nodeType 放在节点顶层（与 nodeId 同级），不要放在 data 内部", "severity", "ERROR"));
                }
            }

            if (!hasStart) {
                String hint = hasNodeTypeHint
                    ? "（你可能把 nodeType 放在了 data 内部，lint 只读取节点顶层的 nodeType 字段，请将 nodeType: \"start\" 移到节点顶层）"
                    : "（需要有一个节点顶层 nodeType 为 \"start\"）";
                errors.add(Map.of("category", "Workflow", "message", "缺少开始节点" + hint, "severity", "ERROR"));
            }
            if (!hasEnd) {
                String hint = hasNodeTypeHint
                    ? "（你可能把 nodeType 放在了 data 内部，lint 只读取节点顶层的 nodeType 字段，请将 nodeType: \"end\" 移到节点顶层）"
                    : "（需要有一个节点顶层 nodeType 为 \"end\"）";
                errors.add(Map.of("category", "Workflow", "message", "缺少结束节点" + hint, "severity", "ERROR"));
            }

            if (edges.isArray()) {
                for (JsonNode edge : edges) {
                    if (edge.has("source") && !nodeIds.contains(edge.get("source").asText())) {
                        errors.add(Map.of("category", "Workflow", "message",
                            "边引用了不存在的源节点: " + edge.get("source").asText(), "severity", "ERROR"));
                    }
                    if (edge.has("target") && !nodeIds.contains(edge.get("target").asText())) {
                        errors.add(Map.of("category", "Workflow", "message",
                            "边引用了不存在的目标节点: " + edge.get("target").asText(), "severity", "ERROR"));
                    }
                }
            }

            // 孤立节点检测
            Set<String> connectedNodes = new HashSet<>();
            if (edges.isArray()) {
                for (JsonNode edge : edges) {
                    if (edge.has("source")) connectedNodes.add(edge.get("source").asText());
                    if (edge.has("target")) connectedNodes.add(edge.get("target").asText());
                }
            }
            for (String nodeId : nodeIds) {
                if (!connectedNodes.contains(nodeId)) {
                    warnings.add(Map.of("category", "Workflow", "message",
                        "孤立节点: " + nodeId + " (未连接到任何边)", "severity", "WARNING"));
                }
            }
        } catch (JsonProcessingException e) {
            errors.add(Map.of("category", "Workflow", "message",
                "JSON 格式错误: " + e.getMessage(), "severity", "ERROR"));
        }

        return buildResult(errors, warnings);
    }

    public Map<String, Object> lintCondition(String expression, String fieldsJson) {
        List<Map<String, Object>> errors = new ArrayList<>();
        List<Map<String, Object>> warnings = new ArrayList<>();

        if (expression == null || expression.trim().isEmpty()) {
            warnings.add(Map.of("category", "Condition", "message", "条件表达式为空", "severity", "WARNING"));
            return buildResult(errors, warnings);
        }

        Set<String> fieldKeys = extractFieldKeys(fieldsJson);
        for (String key : fieldKeys) {
            if (expression.contains(key)) {
                return buildResult(errors, warnings);
            }
        }
        warnings.add(Map.of("category", "Condition", "message",
            "条件表达式未引用任何已知字段", "severity", "WARNING"));

        return buildResult(errors, warnings);
    }

    private Set<String> extractFieldKeys(String fieldsJson) {
        Set<String> keys = new HashSet<>();
        try {
            if (fieldsJson != null && !fieldsJson.isEmpty()) {
                JsonNode fields = objectMapper.readTree(fieldsJson);
                for (JsonNode field : fields) {
                    if (field.has("key")) keys.add(field.get("key").asText());
                }
            }
        } catch (Exception ignored) {}
        return keys;
    }

    private Map<String, Object> buildResult(List<Map<String, Object>> errors, List<Map<String, Object>> warnings) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("passed", errors.isEmpty());
        result.put("errors", errors);
        result.put("warnings", warnings);
        result.put("errorCount", errors.size());
        result.put("warningCount", warnings.size());
        return result;
    }
}