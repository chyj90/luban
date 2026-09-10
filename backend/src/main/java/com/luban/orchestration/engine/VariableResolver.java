package com.luban.orchestration.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.orchestration.dsl.OrchestrationDsl;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 编排变量解析器：把 DSL 中的 $input.xxx / $nodes.nodeId.path 引用
 * 替换为执行上下文中的实际值（支持对象路径与数字数组下标）。
 *
 * 设计约束：**无 eval**——路径按 "." 逐段取值，天然防注入。
 */
@Component
public class VariableResolver {

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 解析模板值：字符串精确匹配引用时返回原始类型（数字/布尔保持类型）；
     * 字符串内嵌引用（如 "前缀${$nodes.a.x}"）替换为字符串插值。
     */
    public Object resolveValue(Object templateValue, Map<String, Object> context) {
        if (!(templateValue instanceof String s)) return templateValue;

        String trimmed = s.trim();
        // 精确引用 → 类型保真
        Object exact = tryResolvePath(trimmed, context);
        if (exact != PATH_NOT_FOUND) return exact;

        // 内嵌引用插值
        if (s.contains("$input.") || s.contains("$nodes.")) {
            java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile("\\$(?:input|nodes)(?:\\.\\w+)+").matcher(s);
            StringBuilder sb = new StringBuilder();
            int last = 0;
            while (m.find()) {
                Object v = tryResolvePath(m.group(), context);
                sb.append(s, last, m.start())
                  .append(v == PATH_NOT_FOUND ? m.group() : String.valueOf(v));
                last = m.end();
            }
            sb.append(s.substring(last));
            return sb.toString();
        }
        return s;
    }

    /** 解析 Map 中的所有字符串模板值（递归一层 Map/List） */
    public Map<String, Object> resolveTemplate(Map<String, Object> template, Map<String, Object> context) {
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        if (template == null) return out;
        template.forEach((k, v) -> {
            if (v instanceof String sv) {
                out.put(k, resolveValue(sv, context));
            } else if (v instanceof Map<?, ?> m) {
                @SuppressWarnings("unchecked")
                Map<String, Object> sub = (Map<String, Object>) m;
                out.put(k, resolveTemplate(sub, context));
            } else {
                out.put(k, v);
            }
        });
        return out;
    }

    static final Object PATH_NOT_FOUND = new Object();

    /** 解析实例引用模板为 Long（$input.xxx / $nodes.x / 字面量数字）；不存在返回 null */
    Long resolveInstanceId(String template, Map<String, Object> context) {
        if (template == null || template.isBlank()) return null;
        Object v = tryResolvePath(template.trim(), context);
        if (v == PATH_NOT_FOUND || v == null) {
            try { return Long.parseLong(template.trim()); } catch (NumberFormatException e) { return null; }
        }
        if (v instanceof Number n) return n.longValue();
        try { return Long.parseLong(String.valueOf(v)); } catch (NumberFormatException e) { return null; }
    }

    /** 解析 "$input.a.b" / "$nodes.nodeId.0.field"；路径不存在返回 PATH_NOT_FOUND */
    Object tryResolvePath(String path, Map<String, Object> context) {
        try {
            if (path.startsWith(OrchestrationDsl.PREFIX_INPUT)) {
                JsonNode node = objectMapper.valueToTree(context.getOrDefault("__input__", Map.of()));
                return resolveJsonPath(node, path.substring(OrchestrationDsl.PREFIX_INPUT.length()));
            }
            if (path.startsWith(OrchestrationDsl.PREFIX_NODE)) {
                String rest = path.substring(OrchestrationDsl.PREFIX_NODE.length());
                int dot = rest.indexOf('.');
                String nodeId = dot < 0 ? rest : rest.substring(0, dot);
                Object nodeOut = context.get(nodeId);
                if (nodeOut == null) return PATH_NOT_FOUND;
                JsonNode node = objectMapper.valueToTree(nodeOut);
                return resolveJsonPath(node, dot < 0 ? "" : rest.substring(dot + 1));
            }
        } catch (Exception ignored) {
            return PATH_NOT_FOUND;
        }
        return PATH_NOT_FOUND;
    }

    private Object resolveJsonPath(JsonNode root, String path) {
        JsonNode cur = root;
        if (!path.isBlank()) {
            for (String seg : path.split("\\.")) {
                if (cur == null) return PATH_NOT_FOUND;
                cur = cur.isArray() && seg.matches("\\d+") ? cur.get(Integer.parseInt(seg)) : cur.get(seg);
            }
        }
        if (cur == null || cur.isMissingNode()) return PATH_NOT_FOUND;
        return jsonNodeToValue(cur);
    }

    private Object jsonNodeToValue(JsonNode n) {
        if (n.isNumber()) return n.isIntegralNumber() ? n.longValue() : n.decimalValue();
        if (n.isBoolean()) return n.booleanValue();
        if (n.isTextual()) return n.textValue();
        if (n.isNull()) return null;
        if (n.isArray()) {
            List<Object> list = new ArrayList<>();
            n.forEach(x -> list.add(jsonNodeToValue(x)));
            return list;
        }
        Map<String, Object> map = new java.util.LinkedHashMap<>();
        n.fields().forEachRemaining(e -> map.put(e.getKey(), jsonNodeToValue(e.getValue())));
        return map;
    }
}
