package com.luban.workflow.service;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 条件分支求值器测试（E2E-2 暴露的引擎缺陷回归：JDK15+ 无 JS 引擎 → 条件恒 true）。
 * 覆盖：数字比较、字符串比较、逻辑组合、缺失字段、非法表达式。
 */
class ConditionEvaluatorTest {

    private Map<String, Object> form(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @Test
    void numericComparisons() {
        assertThat(ConditionEvaluator.evaluate("leaveDays <= 3", form("leaveDays", 2))).isTrue();
        assertThat(ConditionEvaluator.evaluate("leaveDays <= 3", form("leaveDays", 3))).isTrue();
        assertThat(ConditionEvaluator.evaluate("leaveDays > 3", form("leaveDays", 2))).isFalse();
        assertThat(ConditionEvaluator.evaluate("leaveDays > 3", form("leaveDays", 5))).isTrue();
        assertThat(ConditionEvaluator.evaluate("amount >= 1000", form("amount", 1000.0))).isTrue();
        assertThat(ConditionEvaluator.evaluate("amount != 0", form("amount", 0))).isFalse();
    }

    @Test
    void stringComparisons() {
        assertThat(ConditionEvaluator.evaluate("status == 'VIP'", form("status", "VIP"))).isTrue();
        assertThat(ConditionEvaluator.evaluate("status == \"VIP\"", form("status", "VIP"))).isTrue();
        assertThat(ConditionEvaluator.evaluate("status != 'VIP'", form("status", "普通"))).isTrue();
        assertThat(ConditionEvaluator.evaluate("status == 'VIP'", form("status", "普通"))).isFalse();
    }

    @Test
    void logicalCombinations() {
        assertThat(ConditionEvaluator.evaluate("leaveDays > 3 && amount >= 1000", form("leaveDays", 5, "amount", 2000))).isTrue();
        assertThat(ConditionEvaluator.evaluate("leaveDays > 3 && amount >= 1000", form("leaveDays", 5, "amount", 500))).isFalse();
        assertThat(ConditionEvaluator.evaluate("leaveDays > 3 || amount >= 1000", form("leaveDays", 2, "amount", 500))).isFalse();
        assertThat(ConditionEvaluator.evaluate("leaveDays > 3 || amount >= 1000", form("leaveDays", 2, "amount", 2000))).isTrue();
    }

    @Test
    void missingAndBlank() {
        // 缺失字段：数字比较 false、空条件 true、无法解析的表达式按通过处理（保持流程可推进）
        assertThat(ConditionEvaluator.evaluate("leaveDays <= 3", form())).isFalse();
        assertThat(ConditionEvaluator.evaluate("", form("leaveDays", 2))).isTrue();
        assertThat(ConditionEvaluator.evaluate(null, form("leaveDays", 2))).isTrue();
        assertThat(ConditionEvaluator.evaluate("some weird js()", form("leaveDays", 2))).isTrue();
    }

    @Test
    void stringFieldNumericLiteralCoercion() {
        // 表单字段即使以字符串存储（"5"），数字比较也按数值判定
        assertThat(ConditionEvaluator.evaluate("leaveDays > 3", form("leaveDays", "5"))).isTrue();
        assertThat(ConditionEvaluator.evaluate("leaveDays > 3", form("leaveDays", "2"))).isFalse();
    }
}
