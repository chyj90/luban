package com.luban.service;

import com.luban.service.SqlStructureAnalyzer.Analysis;
import com.luban.service.SqlStructureAnalyzer.StringFilter;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SqlStructureAnalyzerTest {

    @Test
    void joinEdgesCoverMultiHopChain() {
        Analysis a = SqlStructureAnalyzer.analyze(
                "SELECT * FROM t_a x JOIN t_b y ON x.id = y.a_id JOIN t_c z ON y.id = z.b_id");
        assertThat(a).isNotNull();
        // 原正则只抓 JOIN 表与 FROM 表的对，链式多跳的第二段 (t_b,t_c) 会漏检
        assertThat(a.joinEdges()).contains(
                new String[]{"t_a", "t_b"},
                new String[]{"t_b", "t_c"});
        assertThat(a.fromTables()).extracting(SqlStructureAnalyzer.TableRef::table)
                .containsExactly("t_a", "t_b", "t_c");
    }

    @Test
    void commaJoinProducesEdges() {
        Analysis a = SqlStructureAnalyzer.analyze("SELECT * FROM t_a, t_b WHERE t_a.id = t_b.a_id");
        assertThat(a).isNotNull();
        assertThat(a.joinEdges()).contains(new String[]{"t_a", "t_b"});
    }

    @Test
    void collectsQualifiedEqualityAndInValues() {
        // 原正则漏检 IN 列表与 ON 条件里的字符串值
        Analysis a = SqlStructureAnalyzer.analyze(
                "SELECT o.id FROM orders o JOIN lines l ON o.id = l.order_id AND l.type = 'CRITICAL' "
                        + "WHERE o.status IN ('OPEN', 'CLOSED') AND o.region = 'CN'");
        assertThat(a).isNotNull();
        assertThat(a.stringFilters()).extracting(StringFilter::value)
                .contains("CRITICAL", "OPEN", "CLOSED", "CN");
        assertThat(a.stringFilters()).anySatisfy(f -> {
            assertThat(f.table()).isEqualTo("o");
            assertThat(f.column()).isEqualTo("region");
            assertThat(f.qualifiedRef()).isEqualTo("o.region");
        });
    }

    @Test
    void numericStringValuesStillCollected() {
        Analysis a = SqlStructureAnalyzer.analyze("SELECT * FROM t WHERE code = '123'");
        assertThat(a).isNotNull();
        // 收集但调用方按纯数字放行，与原逻辑一致
        assertThat(a.stringFilters()).hasSize(1);
    }

    @Test
    void dateLiteralInComparisonDetected() {
        Analysis a = SqlStructureAnalyzer.analyze(
                "SELECT * FROM t WHERE created_at > '2024-01-01'");
        assertThat(a).isNotNull();
        assertThat(a.dateLiteralFilter()).isTrue();
    }

    @Test
    void dateLiteralInSelectListIsNotFilter() {
        // 字面量出现在 SELECT 列而非比较条件中，不应触发日期先查范围闸门
        Analysis a = SqlStructureAnalyzer.analyze("SELECT '2024-01-01' AS d FROM t");
        assertThat(a).isNotNull();
        assertThat(a.dateLiteralFilter()).isFalse();
    }

    @Test
    void minMaxOnDateColumnIsRangeQuery() {
        Analysis a = SqlStructureAnalyzer.analyze(
                "SELECT MIN(create_time), MAX(create_time) FROM t");
        assertThat(a).isNotNull();
        assertThat(a.dateRangeQuery()).isTrue();
    }

    @Test
    void minMaxOnNonDateColumnIsNotRangeQuery() {
        Analysis a = SqlStructureAnalyzer.analyze("SELECT MIN(amount) FROM t");
        assertThat(a).isNotNull();
        assertThat(a.dateRangeQuery()).isFalse();
    }

    @Test
    void subqueryFiltersAreCollected() {
        Analysis a = SqlStructureAnalyzer.analyze(
                "SELECT * FROM t WHERE id IN (SELECT id FROM s WHERE s.state = 'FAIL')");
        assertThat(a).isNotNull();
        assertThat(a.stringFilters()).extracting(StringFilter::value).contains("FAIL");
    }

    @Test
    void unionBranchesAreCovered() {
        Analysis a = SqlStructureAnalyzer.analyze(
                "SELECT a FROM t1 WHERE a = 'x' UNION SELECT b FROM t2 WHERE b = 'y'");
        assertThat(a).isNotNull();
        assertThat(a.stringFilters()).extracting(StringFilter::value).contains("x", "y");
    }

    @Test
    void unparseableReturnsNull() {
        assertThat(SqlStructureAnalyzer.analyze("SELECT oops((( ")).isNull();
        assertThat(SqlStructureAnalyzer.analyze(null)).isNull();
    }

    @Test
    void unqualifiedColumnHasNullTable() {
        Analysis a = SqlStructureAnalyzer.analyze("SELECT * FROM t WHERE status = 'OPEN'");
        assertThat(a).isNotNull();
        assertThat(a.stringFilters()).contains(new StringFilter(null, "status", "OPEN"));
    }
}
