package com.luban.workflow.service;

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
            "^\\s*(\\w+)\\s*(<=|>=|==|!=|<|>)\\s*(\\d+(?:\\.\\d+)?|'[^']*'|\"[^\"]*\")\\s*$");

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
            String raw = m.group(3);
            Object val = formData.get(field);
            return compare(op, raw, val);
        }

        // 解析不了的表达式：告警并按旧行为放行，避免流程卡死
        org.slf4j.LoggerFactory.getLogger(ConditionEvaluator.class)
                .warn("无法解析的条件表达式，按通过处理: {}", condition);
        return true;
    }

    private static boolean compare(String op, String rawLiteral, Object fieldValue) {
        if (isStringLiteral(rawLiteral)) {
            String expect = rawLiteral.substring(1, rawLiteral.length() - 1);
            String actual = fieldValue == null ? null : String.valueOf(fieldValue);
            switch (op) {
                case "==": return expect.equals(actual);
                case "!=": return !expect.equals(actual);
                case "<": return actual != null && actual.compareTo(expect) < 0;
                case "<=": return actual != null && actual.compareTo(expect) <= 0;
                case ">": return actual != null && actual.compareTo(expect) > 0;
                case ">=": return actual != null && actual.compareTo(expect) >= 0;
                default: return false;
            }
        }
        double expect = Double.parseDouble(rawLiteral);
        if (fieldValue == null) return false;
        double actual;
        try {
            actual = Double.parseDouble(String.valueOf(fieldValue));
        } catch (NumberFormatException e) {
            return false;
        }
        switch (op) {
            case "<": return actual < expect;
            case "<=": return actual <= expect;
            case ">": return actual > expect;
            case ">=": return actual >= expect;
            case "==": return actual == expect;
            case "!=": return actual != expect;
            default: return false;
        }
    }

    private static boolean isStringLiteral(String raw) {
        return raw.startsWith("'") || raw.startsWith("\"");
    }
}
