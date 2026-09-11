package com.luban.workflow.service;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
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

    @Test
    void nestedObjectPath() {
        Map<String, Object> user = new HashMap<>();
        user.put("name", "张三");
        user.put("age", 30);
        user.put("vip", true);
        assertThat(ConditionEvaluator.evaluate("user.name == '张三'", form("user", user))).isTrue();
        assertThat(ConditionEvaluator.evaluate("user.name == '李四'", form("user", user))).isFalse();
        assertThat(ConditionEvaluator.evaluate("user.age > 20", form("user", user))).isTrue();
    }

    @Test
    void arrayIndexPath() {
        Map<String, Object> row0 = Map.of("name", "张三", "amount", 500);
        Map<String, Object> row1 = Map.of("name", "李四", "amount", 2000);
        Map<String, Object> data = Map.of("rows", List.of(row0, row1));
        assertThat(ConditionEvaluator.evaluate("rows[0].name == '张三'", data)).isTrue();
        assertThat(ConditionEvaluator.evaluate("rows[1].name == '张三'", data)).isFalse();
        assertThat(ConditionEvaluator.evaluate("rows[0].amount >= 500", data)).isTrue();
        assertThat(ConditionEvaluator.evaluate("rows[1].amount >= 1000", data)).isTrue();
        // 也支持点分隔的数组索引：rows.1.amount
        assertThat(ConditionEvaluator.evaluate("rows.1.amount > 1000", data)).isTrue();
        assertThat(ConditionEvaluator.evaluate("rows.0.amount < 100", data)).isFalse();
    }

    @Test
    void multiLevelNesting() {
        Map<String, Object> addr = Map.of("city", "杭州", "zip", "310000");
        Map<String, Object> user = Map.of("profile", Map.of("address", addr));
        Map<String, Object> wrapper = Map.of("data", user);
        assertThat(ConditionEvaluator.evaluate("data.profile.address.city == '杭州'", wrapper)).isTrue();
        assertThat(ConditionEvaluator.evaluate("data.profile.address.city == '北京'", wrapper)).isFalse();
    }

    @Test
    void invalidPathReturnsFalse() {
        Map<String, Object> user = Map.of("name", "张三");
        // 路径不存在 → null → 无法数字比较 → false
        assertThat(ConditionEvaluator.evaluate("user.age > 20", form("user", user))).isFalse();
        // 路径中途不是对象也不是数组 → null → false
        assertThat(ConditionEvaluator.evaluate("user.name.length > 0", form("user", user))).isFalse();
    }

    @Test
    void rightSideFieldReference() {
        // 右值也是字段引用：当前分数 >= 分数线
        assertThat(ConditionEvaluator.evaluate("score >= passLine", form("score", 85, "passLine", 60))).isTrue();
        assertThat(ConditionEvaluator.evaluate("score >= passLine", form("score", 50, "passLine", 60))).isFalse();
    }

    @Test
    void rightSideNestedFieldReference() {
        Map<String, Object> user1 = Map.of("name", "张三", "dept", "A");
        Map<String, Object> user2 = Map.of("name", "张三", "dept", "B");
        // 比较两个嵌套字段是否相等
        assertThat(ConditionEvaluator.evaluate("user1.name == user2.name", Map.of("user1", user1, "user2", user2))).isTrue();
        assertThat(ConditionEvaluator.evaluate("user1.dept == user2.dept", Map.of("user1", user1, "user2", user2))).isFalse();
    }

    @Test
    void mixedLiteralAndFieldRef() {
        // 左值字段引用 vs 右值字面量（原有行为不变）
        assertThat(ConditionEvaluator.evaluate("age > 18", form("age", 20))).isTrue();
        // 右值字段引用 vs 左值字面量 —— 字面量必须在右，左值必须是字段名
        assertThat(ConditionEvaluator.evaluate("age >= minAge", form("age", 65, "minAge", 60))).isTrue();
    }
}