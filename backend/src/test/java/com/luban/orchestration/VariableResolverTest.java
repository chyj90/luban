package com.luban.orchestration;

import com.luban.orchestration.engine.VariableResolver;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** 变量解析器测试：$input / $nodes 路径、类型保真、内嵌插值、缺失路径。 */
class VariableResolverTest {

    private final VariableResolver resolver = new VariableResolver();

    private Map<String, Object> context() {
        Map<String, Object> ctx = new HashMap<>();
        ctx.put("__input__", Map.of(
                "customerId", 42,
                "keyword", "abc",
                "nested", Map.of("a", Map.of("b", "deep"))));
        ctx.put("q1", Map.of(
                "rows", java.util.List.of(Map.of("name", "r0"), Map.of("name", "r1")),
                "totalCount", 15));
        return ctx;
    }

    @Test
    void resolvesExactInputReferenceWithType() {
        // 精确引用返回原始类型（数字保真，不退化成字符串）
        assertThat(resolver.resolveValue("$input.customerId", context())).isEqualTo(42L);
        assertThat(resolver.resolveValue("$input.keyword", context())).isEqualTo("abc");
        assertThat(resolver.resolveValue("$input.nested.a.b", context())).isEqualTo("deep");
    }

    @Test
    void resolvesNodeOutputWithArrayIndex() {
        assertThat(resolver.resolveValue("$nodes.q1.totalCount", context())).isEqualTo(15L);
        assertThat(resolver.resolveValue("$nodes.q1.rows.0.name", context())).isEqualTo("r0");
        assertThat(resolver.resolveValue("$nodes.q1.rows.1.name", context())).isEqualTo("r1");
        assertThat(resolver.resolveValue("$nodes.q1", context())).isEqualTo(
                Map.of("rows", java.util.List.of(Map.of("name", "r0"), Map.of("name", "r1")), "totalCount", 15L));
    }

    @Test
    void missingPathReturnsTemplateUnchanged() {
        // 路径不存在：精确引用返回原字符串（模板原样），由调用方决定缺省
        assertThat(resolver.resolveValue("$nodes.q1.notThere", context())).isEqualTo("$nodes.q1.notThere");
        assertThat(resolver.resolveValue("$input.unknown", context())).isEqualTo("$input.unknown");
    }

    @Test
    void interpolatesEmbeddedReferences() {
        assertThat(resolver.resolveValue("客户 $input.customerId 的订单", context()))
                .isEqualTo("客户 42 的订单");
        assertThat(resolver.resolveValue("total=$nodes.q1.totalCount", context()))
                .isEqualTo("total=15");
    }

    @Test
    void nonStringValuesPassThrough() {
        assertThat(resolver.resolveValue(123, context())).isEqualTo(123);
        assertThat(resolver.resolveValue(null, context())).isNull();
        Map<String, Object> tmpl = Map.of("id", "$input.customerId", "note", "plain");
        assertThat(resolver.resolveTemplate(tmpl, context()))
                .isEqualTo(Map.of("id", 42L, "note", "plain"));
    }

    @Test
    void templateResolutionIsRecursiveForNestedMaps() {
        Map<String, Object> tmpl = new HashMap<>();
        tmpl.put("filters", Map.of("name", "$input.keyword"));
        var out = resolver.resolveTemplate(tmpl, context());
        @SuppressWarnings("unchecked")
        Map<String, Object> filters = (Map<String, Object>) out.get("filters");
        assertThat(filters.get("name")).isEqualTo("abc");
    }
}
