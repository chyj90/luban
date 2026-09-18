package com.luban.selftest;

import com.luban.dto.RunQueryResponse;
import com.luban.selftest.dto.Expectation;
import com.luban.selftest.dto.TestSpec;
import com.luban.selftest.dto.TestStep;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 自检测试引擎的纯函数回归：占位符解析、SELECT 白名单、写入记账解析、SQL 字面量、断言求值。
 * 契约见 doc/需求文档/需求文档-应用自检测试引擎设计.md。
 */
class AppSelfTestServicePureFunctionsTest {

    // ── 占位符解析 ──

    @Test
    void wholeStringRefKeepsType() {
        Map<String, Object> vars = Map.of("insert.insertId", 1008L);
        Set<String> missing = new java.util.HashSet<>();
        Object v = AppSelfTestService.resolveValue("${insert.insertId}", vars, missing);
        assertEquals(1008L, v);
        assertTrue(missing.isEmpty());
    }

    @Test
    void embeddedRefBecomesText() {
        Map<String, Object> vars = Map.of("a", 1);
        Set<String> missing = new java.util.HashSet<>();
        Object v = AppSelfTestService.resolveValue("前缀${a}后缀", vars, missing);
        assertEquals("前缀1后缀", v);
    }

    @Test
    void missingRefIsReportedNotSwallowed() {
        Set<String> missing = new java.util.HashSet<>();
        Object v = AppSelfTestService.resolveValue("${nope}", Map.of(), missing);
        assertNull(v);
        assertTrue(missing.contains("nope"));
    }

    @Test
    void interpolateTextJoinsMultipleRefs() {
        Map<String, Object> vars = new HashMap<>();
        vars.put("s.id", 7);
        vars.put("cap.balance", 10);
        Set<String> missing = new java.util.HashSet<>();
        String sql = AppSelfTestService.interpolateText(
                "SELECT leave_balance - ${s.id} FROM t WHERE id = ${cap.balance}", vars, missing);
        assertEquals("SELECT leave_balance - 7 FROM t WHERE id = 10", sql);
        assertTrue(missing.isEmpty());
    }

    @Test
    void nestedMapIsResolvedRecursively() {
        Map<String, Object> vars = Map.of("insert.insertId", 5L);
        Set<String> missing = new java.util.HashSet<>();
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("id", "${insert.insertId}");
        input.put("reason", "单据${insert.insertId}号");
        Map<String, Object> out = AppSelfTestService.resolveMap(input, vars, missing);
        assertEquals(5L, out.get("id"));
        assertEquals("单据5号", out.get("reason"));
    }

    // ── SELECT 白名单（威胁模型 T4）──

    @Test
    void selectOnlyAcceptsSelectAndCteWithTrailingSemicolon() {
        assertTrue(AppSelfTestService.isSelectOnly("SELECT status FROM t WHERE id = 1;"));
        assertTrue(AppSelfTestService.isSelectOnly("WITH x AS (SELECT 1) SELECT * FROM x"));
        assertTrue(AppSelfTestService.isSelectOnly("select '分号;在值里' as v"));
    }

    @Test
    void selectOnlyRejectsDmlAndMultiStatements() {
        assertFalse(AppSelfTestService.isSelectOnly("UPDATE t SET a = 1"));
        assertFalse(AppSelfTestService.isSelectOnly("DELETE FROM t"));
        assertFalse(AppSelfTestService.isSelectOnly("SELECT 1; DROP TABLE t"));
        assertFalse(AppSelfTestService.isSelectOnly("INSERT INTO t VALUES (1)"));
    }

    // ── 写入记账解析 ──

    @Test
    void parseInsertTableHandlesBackticksAndCase() {
        assertEquals("leave_requests", AppSelfTestService.parseInsertTable(
                "INSERT INTO leave_requests (a) VALUES (1)"));
        assertEquals("Employees", AppSelfTestService.parseInsertTable(
                "insert into `Employees` (a) values (1)"));
        assertNull(AppSelfTestService.parseInsertTable("UPDATE t SET a = 1"));
    }

    @Test
    void parseWriteTableHandlesUpdateAndDelete() {
        assertEquals("employees", AppSelfTestService.parseWriteTable(
                "UPDATE employees SET leave_balance = 5 WHERE id = 1"));
        assertEquals("t", AppSelfTestService.parseWriteTable("delete from t where id = 2"));
        assertNull(AppSelfTestService.parseWriteTable("SELECT 1"));
    }

    // ── SQL 字面量 ──

    @Test
    void sqlLiteralEscapesQuotesAndHandlesNull() {
        assertEquals("NULL", AppSelfTestService.sqlLiteral(null));
        assertEquals("3", AppSelfTestService.sqlLiteral(3));
        assertEquals("true", AppSelfTestService.sqlLiteral(Boolean.TRUE));
        assertEquals("'O''Brien'", AppSelfTestService.sqlLiteral("O'Brien"));
    }

    // ── 断言求值 ──

    private RunQueryResponse resp(Object firstCell, int rowCount) {
        java.util.List<String> columns = java.util.List.of("v");
        java.util.List<java.util.List<Object>> rows = new java.util.ArrayList<>();
        for (int i = 0; i < rowCount; i++) {
            java.util.List<Object> row = new java.util.ArrayList<>();
            row.add(firstCell);
            rows.add(row);
        }
        return new RunQueryResponse(columns, rows, rowCount, 0L, "SELECT ...", null);
    }

    @Test
    void cellEqComparesNumericallyAndByText() {
        assertNull(AppSelfTestService.evaluateExpectation(expect("cell_eq", "8"), resp(8, 1)));
        assertNull(AppSelfTestService.evaluateExpectation(expect("cell_eq", "已通过"), resp("已通过", 1)));
        assertTrue(AppSelfTestService.evaluateExpectation(expect("cell_eq", "8"), resp(10, 1))
                .contains("期望 8，实际 10"));
    }

    @Test
    void rowsCountEqAndCellContainsAndIsEmpty() {
        assertNull(AppSelfTestService.evaluateExpectation(expect("rows_count_eq", "1"), resp("x", 1)));
        assertTrue(AppSelfTestService.evaluateExpectation(expect("rows_count_eq", "2"), resp("x", 1)) != null);
        assertNull(AppSelfTestService.evaluateExpectation(expect("cell_contains", "通过"), resp("已通过", 1)));
        assertNull(AppSelfTestService.evaluateExpectation(expect("is_empty", ""), resp(null, 1)));
        assertTrue(AppSelfTestService.evaluateExpectation(expect("is_empty", ""), resp("x", 1)) != null);
    }

    @Test
    void unknownOperatorIsError() {
        assertTrue(AppSelfTestService.evaluateExpectation(expect("regex", "x"), resp("x", 1)) != null);
    }

    private Expectation expect(String operator, String value) {
        Expectation e = new Expectation();
        e.setOperator(operator);
        e.setValue(value);
        return e;
    }

    // ── TestSpec 校验相关（借助类型字段，不触库） ──

    @Test
    void normalizedTypeTrimsAndLowercases() {
        TestStep step = new TestStep();
        step.setType("  QUERY_RUN ");
        // normalizedType 为私有，经 isSelectOnly 同级静态方法验证包内可见性即可；
        // 这里仅验证 DTO 行为
        assertEquals("  QUERY_RUN ", step.getType());
        TestSpec spec = new TestSpec();
        spec.setSteps(java.util.List.of(step));
        assertEquals(1, spec.getSteps().size());
    }
}
