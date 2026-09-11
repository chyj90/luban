package com.luban.workflow.service;

import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 条件分支表达式求值器。
 *
 * 背景：原实现依赖 JDK 内置 JS 引擎（Nashorn），JDK 15+ 已移除 → 条件恒 true，
 * 条件分支永不生效；且把表单数据注入 JS eval 存在注入面。本求值器为确定性实现，
 * 零外部依赖，覆盖条件分支的实际形态：
 *
 * <pre>
 *   leaveDays <= 3
 *   leaveDays > 3 && amount >= 1000
 *   status == "VIP" || status == "重点"
 * </pre>
 *
 * 支持：字段名（左）+ 比较符（&lt; &lt;= &gt; &gt;= == !=）+ 字面量（数字/单双引号字符串）；
 * 逻辑：&amp;&amp;（与）、||（或）。无法解析的表达式打告警并返回 true（保持流程可推进，
 * 与旧行为一致），但可解析的条件会严格判定。
 */
public final class ConditionEvaluator {

    private ConditionEvaluator() {}

    private static final Pattern COMPARISON = Pattern.compile(
            "^\\s*([\\w\\[\\]\\.]+)\\s*(<=|>=|==|!=|<|>)\\s*(\\d+(?:\\.\\d+)?|'[^']*'|\"[^\"]*\"|[\\w\\[\\]\\.]+)\\s*$");

    public static boolean evaluate(String condition, Map<String, Object> formData) {
        if (condition == null || condition.isBlank()) {
            return true; // 无条件，始终通过
        }
        String expr = condition.trim();

        if (expr.contains("&&")) {
            for (String part : expr.split("&&")) {
                if (!evaluate(part.trim(), formData)) return false;
            }
            return true;
        }
        if (expr.contains("||")) {
            for (String part : expr.split("\\|\\|")) {
                if (evaluate(part.trim(), formData)) return true;
            }
            return false;
        }

        Matcher m = COMPARISON.matcher(expr);
        if (m.matches()) {
            String field = m.group(1);
            String op = m.group(2);
            String rawRight = m.group(3);
            Object left = resolvePath(formData, field);
            Object right = resolveRight(formData, rawRight);
            return compare(op, left, right);
        }

        // 解析不了的表达式：告警并按旧行为放行，避免流程卡死
        org.slf4j.LoggerFactory.getLogger(ConditionEvaluator.class)
                .warn("无法解析的条件表达式，按通过处理: {}", condition);
        return true;
    }

    /**
     * 解析嵌套路径。支持：
     * <pre>
     *   age              → 顶层字段
     *   user.name        → 嵌套对象
     *   rows[0].name     → 数组索引（也支持 rows.0.name）
     *   data.users[0].address.city  → 多层嵌套
     * </pre>
     */
    private static Object resolvePath(Map<String, Object> formData, String path) {
        // 无点无括号 → 直接取顶层 key
        if (path.indexOf('.') < 0 && path.indexOf('[') < 0) {
            return formData.get(path);
        }
        // 拆分段：rows[0].name → ["rows","0","name"]；user.address.city → ["user","address","city"]
        String[] parts = path.split("\\[|\\]|\\.", -1);
        Object current = null;
        boolean first = true;
        for (String part : parts) {
            if (part.isEmpty()) continue;
            if (first) {
                current = formData.get(part);
                first = false;
            } else if (current instanceof Map) {
                current = ((Map<?, ?>) current).get(part);
            } else if (current instanceof List) {
                try {
                    int idx = Integer.parseInt(part);
                    List<?> list = (List<?>) current;
                    current = idx >= 0 && idx < list.size() ? list.get(idx) : null;
                } catch (NumberFormatException e) {
                    return null;
                }
            } else {
                return null;
            }
            if (current == null) return null;
        }
        return current;
    }

    /**
     * 解析右值。优先级：数字字面量 → 引号字符串字面量 → 字段引用。
     */
    private static Object resolveRight(Map<String, Object> formData, String raw) {
        if (raw.matches("^\\d+(?:\\.\\d+)?$")) {
            return Double.valueOf(raw);
        }
        if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith("\"") && raw.endsWith("\""))) {
            return raw.substring(1, raw.length() - 1);
        }
        return resolvePath(formData, raw);
    }

    private static boolean compare(String op, Object left, Object right) {
        if (left == null || right == null) {
            return false;
        }
        if (right instanceof Number) {
            double r = ((Number) right).doubleValue();
            double l;
            try {
                l = Double.parseDouble(String.valueOf(left));
            } catch (NumberFormatException e) {
                return false;
            }
            switch (op) {
                case "<": return l < r;
                case "<=": return l <= r;
                case ">": return l > r;
                case ">=": return l >= r;
                case "==": return l == r;
                case "!=": return l != r;
                default: return false;
            }
        }
        String l = String.valueOf(left);
        String r = String.valueOf(right);
        switch (op) {
            case "==": return l.equals(r);
            case "!=": return !l.equals(r);
            case "<": return l.compareTo(r) < 0;
            case "<=": return l.compareTo(r) <= 0;
            case ">": return l.compareTo(r) > 0;
            case ">=": return l.compareTo(r) >= 0;
            default: return false;
        }
    }
}