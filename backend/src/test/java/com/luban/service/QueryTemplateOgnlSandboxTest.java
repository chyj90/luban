package com.luban.service;

import ognl.Ognl;
import ognl.OgnlContext;
import ognl.MemberAccess;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 QueryService 模板表达式沙箱：合法的 MyBatis 风格条件可求值，
 * OGNL 静态调用 / 反射链 / 构造调用等 RCE 向量被拒绝。
 */
class QueryTemplateOgnlSandboxTest {

    @Test
    void safeConditionsEvaluate() throws Exception {
        Object result = eval("params.status != null && params.status == 'OK'",
                Map.of("status", "OK"));
        assertThat(result).isEqualTo(true);

        assertThat(eval("params.count > 0", Map.of("count", 3))).isEqualTo(true);
        assertThat(eval("params.count > 0", Map.of("count", 0))).isEqualTo(false);
        assertThat(eval("params.name != null", Map.of())).isEqualTo(false);
        assertThat(eval("(params.page - 1) * params.pageSize", Map.of("page", 3, "pageSize", 10)))
                .isEqualTo(20);
        assertThat(eval("params.items.size() > 0", Map.of("items", java.util.List.of("a"))))
                .isEqualTo(true);
    }

    @Test
    void staticMethodCallIsBlocked() {
        // @java.lang.Runtime@getRuntime().exec(...) —— RCE 主向量，语法层拒绝
        Object r = evalQuietly("@java.lang.Runtime@getRuntime().exec('id')");
        assertThat(r).isEqualTo(Boolean.FALSE);
    }

    @Test
    void reflectionChainViaGetClassIsBlocked() {
        // "".getClass().forName(...) —— 绕过静态语法的经典链，MemberAccess 层拒绝
        Object r = evalQuietly("params.name.getClass().forName('java.lang.Runtime')");
        assertThat(r).isEqualTo(Boolean.FALSE);
    }

    @Test
    void constructorCallIsBlocked() {
        Object r = evalQuietly("new java.lang.String('x')");
        assertThat(r).isEqualTo(Boolean.FALSE);
    }

    @Test
    void execOnRuntimeInstanceIsBlocked() {
        // 即使拿到 Runtime 实例，exec 也不在方法白名单内
        Object r = evalQuietly("params.rt.getRuntime().exec('id')");
        assertThat(r).isEqualTo(Boolean.FALSE);
    }

    // ── helpers：通过反射触达 QueryService 的私有沙箱设施 ──

    private Object eval(String expr, Map<String, Object> params) {
        try {
            return doEval(expr, params);
        } catch (Exception e) {
            throw new AssertionError("求值失败: " + expr + " → " + e.getMessage(), e);
        }
    }

    private Object evalQuietly(String expr) {
        try {
            return doEval(expr, Map.of("name", "x", "rt", Runtime.getRuntime()));
        } catch (Exception e) {
            return Boolean.FALSE;
        }
    }

    private Object doEval(String condition, Map<String, Object> params) throws Exception {
        MemberAccess restricted = sandboxAccess();
        Map<String, Object> wrapper = new HashMap<>();
        wrapper.put("params", params);
        OgnlContext ctx = new OgnlContext(null, null, restricted);
        ctx.setRoot(wrapper);
        return Ognl.getValue(Ognl.parseExpression(condition), ctx, wrapper);
    }

    private MemberAccess sandboxAccess() throws Exception {
        // 通过反射读取 QueryService.RESTRICTED 字段，保证测试与实现同步
        java.lang.reflect.Field f = QueryService.class.getDeclaredField("RESTRICTED");
        f.setAccessible(true);
        return (MemberAccess) f.get(null);
    }
}
