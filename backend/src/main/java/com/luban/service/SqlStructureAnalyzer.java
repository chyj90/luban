package com.luban.service;

import net.sf.jsqlparser.expression.Expression;
import net.sf.jsqlparser.expression.ExpressionVisitorAdapter;
import net.sf.jsqlparser.expression.Function;
import net.sf.jsqlparser.expression.Parenthesis;
import net.sf.jsqlparser.expression.StringValue;
import net.sf.jsqlparser.expression.operators.relational.EqualsTo;
import net.sf.jsqlparser.expression.operators.relational.ExpressionList;
import net.sf.jsqlparser.expression.operators.relational.GreaterThan;
import net.sf.jsqlparser.expression.operators.relational.GreaterThanEquals;
import net.sf.jsqlparser.expression.operators.relational.InExpression;
import net.sf.jsqlparser.expression.operators.relational.MinorThan;
import net.sf.jsqlparser.expression.operators.relational.MinorThanEquals;
import net.sf.jsqlparser.expression.operators.relational.NotEqualsTo;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;
import net.sf.jsqlparser.schema.Column;
import net.sf.jsqlparser.schema.Table;
import net.sf.jsqlparser.statement.Statement;
import net.sf.jsqlparser.statement.select.FromItem;
import net.sf.jsqlparser.statement.select.Join;
import net.sf.jsqlparser.statement.select.ParenthesedSelect;
import net.sf.jsqlparser.statement.select.PlainSelect;
import net.sf.jsqlparser.statement.select.Select;
import net.sf.jsqlparser.statement.select.SetOperationList;
import net.sf.jsqlparser.statement.select.WithItem;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 基于 jsqlparser AST 的 SQL 结构分析，供问数 Agent 的各道闸门使用。
 * 此前 JOIN 白名单 / value_origins / 日期先查范围等校验全部用正则实现，
 * 逗号 JOIN、子查询、别名缺省、IN 列表等形态都会漏检或误检，这里统一 AST 化。
 *
 * 解析失败返回 null（调用方已有 fail-closed 的安全校验兜底，此处 null 仅表示"无法分析"）。
 */
public final class SqlStructureAnalyzer {

    private static final Pattern DATE_LITERAL = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
    private static final Pattern DATE_COLUMN_NAME = Pattern.compile(
            "(date|time|dt|day|month|year)", Pattern.CASE_INSENSITIVE);
    private static final Set<String> RANGE_AGGREGATES = Set.of("MIN", "MAX");

    /** FROM/JOIN 子句中的表（含别名） */
    public record TableRef(String table, String alias) {}

    /**
     * 字符串等值/IN 过滤项。table 为限定符（别名或表名），未限定时为 null。
     */
    public record StringFilter(String table, String column, String value) {

        public String qualifiedRef() {
            return table != null ? table + "." + column : column;
        }
    }

    /**
     * @param fromTables        FROM 及全部 JOIN 的表，按出现顺序
     * @param joinEdges         相邻表对 (left, right)：FROM t1 JOIN t2 JOIN t3 → (t1,t2),(t2,t3)
     * @param stringFilters     WHERE/HAVING/ON/子查询中的字符串等值与 IN 右值
     * @param dateLiteralFilter WHERE 中存在与日期字面量的比较
     * @param dateRangeQuery    SELECT 中存在对日期类列的 MIN/MAX 聚合
     */
    public record Analysis(
            List<TableRef> fromTables,
            List<String[]> joinEdges,
            List<StringFilter> stringFilters,
            boolean dateLiteralFilter,
            boolean dateRangeQuery) {}

    private SqlStructureAnalyzer() {}

    public static Analysis analyze(String sql) {
        if (sql == null || sql.isBlank()) return null;
        try {
            Statement stmt = CCJSqlParserUtil.parse(sql);
            if (!(stmt instanceof Select select)) return null;
            Collector collector = new Collector();
            walkSelect(select, collector);
            return collector.toAnalysis();
        } catch (Exception e) {
            return null;
        }
    }

    private static void walkSelect(Select select, Collector collector) {
        if (select == null) return;
        // Collector 同时实现 SelectVisitor 与 ExpressionVisitor，需显式消歧
        select.accept((net.sf.jsqlparser.statement.select.SelectVisitor) collector);
    }

    private static final class Collector extends ExpressionVisitorAdapter implements net.sf.jsqlparser.statement.select.SelectVisitor {

        final List<TableRef> fromTables = new ArrayList<>();
        final List<String[]> joinEdges = new ArrayList<>();
        final Set<StringFilter> stringFilters = new LinkedHashSet<>();
        boolean dateLiteralFilter = false;
        boolean dateRangeQuery = false;

        // ── SelectVisitor：遍历 SELECT 结构 ──

        @Override
        public void visit(PlainSelect plainSelect) {
            List<String> chain = new ArrayList<>();
            collectFromItem(plainSelect.getFromItem(), chain);
            List<Join> joins = plainSelect.getJoins();
            if (joins != null) {
                for (Join join : joins) {
                    String right = collectFromItem(join.getRightItem(), chain);
                    if (right != null && !chain.isEmpty()) {
                        joinEdges.add(new String[]{chain.get(chain.size() - 2), right});
                    }
                    // ON 条件里也可能有字符串等值/日期过滤
                    if (join.getOnExpressions() != null) {
                        for (Expression on : join.getOnExpressions()) {
                            if (on != null) on.accept(this);
                        }
                    }
                }
            }
            walkExpression(plainSelect.getWhere());
            walkExpression(plainSelect.getHaving());
            if (plainSelect.getSelectItems() != null) {
                for (var item : plainSelect.getSelectItems()) {
                    walkExpression(item.getExpression());
                }
            }
        }

        @Override
        public void visit(SetOperationList setOperationList) {
            if (setOperationList.getSelects() != null) {
                for (Select s : setOperationList.getSelects()) {
                    walkSelect(s, this);
                }
            }
        }

        @Override
        public void visit(ParenthesedSelect parenthesedSelect) {
            walkSelect(parenthesedSelect.getSelect(), this);
        }

        @Override
        public void visit(WithItem withItem) {
            walkSelect(withItem.getSelect(), this);
        }

        @Override
        public void visit(net.sf.jsqlparser.statement.select.LateralSubSelect lateralSubSelect) {
            walkSelect(lateralSubSelect.getSelect(), this);
        }

        @Override
        public void visit(net.sf.jsqlparser.statement.select.Values values) {
            // VALUES 无结构可分析
        }

        @Override
        public void visit(net.sf.jsqlparser.statement.select.TableStatement tableStatement) {
            // INSERT/UPDATE 源表语句不在只读闸门关注范围
        }

        /** 记录 FROM/JOIN 表，返回表名（非 Table 形态如派生表返回 null，但其内部 SELECT 会被递归遍历） */
        private String collectFromItem(FromItem fromItem, List<String> chain) {
            if (fromItem == null) return null;
            String tableName = null;
            String alias = fromItem.getAlias() != null ? fromItem.getAlias().getName() : null;
            if (fromItem instanceof Table t) {
                tableName = normalizeIdentifier(t.getName());
                fromTables.add(new TableRef(tableName, alias));
            } else if (fromItem instanceof ParenthesedSelect sub) {
                walkSelect(sub.getSelect(), this);
            }
            chain.add(tableName != null ? tableName : "(derived)" );
            return tableName;
        }

        private void walkExpression(Expression expr) {
            if (expr != null) {
                expr.accept(this);
            }
        }

        // ── ExpressionVisitor：收集字符串过滤与日期特征 ──

        @Override
        public void visit(EqualsTo expr) {
            collectComparison(expr.getLeftExpression(), expr.getRightExpression());
            super.visit(expr);
        }

        @Override
        public void visit(NotEqualsTo expr) {
            collectComparison(expr.getLeftExpression(), expr.getRightExpression());
            super.visit(expr);
        }

        @Override
        public void visit(GreaterThan expr) {
            collectComparison(expr.getLeftExpression(), expr.getRightExpression());
            super.visit(expr);
        }

        @Override
        public void visit(GreaterThanEquals expr) {
            collectComparison(expr.getLeftExpression(), expr.getRightExpression());
            super.visit(expr);
        }

        @Override
        public void visit(MinorThan expr) {
            collectComparison(expr.getLeftExpression(), expr.getRightExpression());
            super.visit(expr);
        }

        @Override
        public void visit(MinorThanEquals expr) {
            collectComparison(expr.getLeftExpression(), expr.getRightExpression());
            super.visit(expr);
        }

        @Override
        public void visit(InExpression expr) {
            Expression left = expr.getLeftExpression();
            Expression right = expr.getRightExpression();
            if (left instanceof Column col && right instanceof ExpressionList list) {
                for (Object itemObj : list.getExpressions()) {
                    if (itemObj instanceof StringValue sv) {
                        addFilter(col, sv.getValue());
                    }
                }
            }
            if (right instanceof ParenthesedSelect sub) {
                // IN (SELECT ...)：递归子查询，其内部过滤条件一并纳入
                walkSelect(sub.getSelect(), this);
            }
            super.visit(expr);
        }

        @Override
        public void visit(Function function) {
            String name = function.getName() != null ? function.getName().toUpperCase(Locale.ROOT) : "";
            if (RANGE_AGGREGATES.contains(name) && function.getParameters() != null) {
                for (Object paramObj : function.getParameters().getExpressions()) {
                    if (paramObj instanceof Column col
                            && DATE_COLUMN_NAME.matcher(col.getColumnName()).find()) {
                        dateRangeQuery = true;
                    }
                }
            }
            super.visit(function);
        }

        private void collectComparison(Expression left, Expression right) {
            if (right instanceof StringValue sv && left instanceof Column col) {
                addFilter(col, sv.getValue());
                if (DATE_LITERAL.matcher(sv.getValue()).find()) {
                    dateLiteralFilter = true;
                }
            } else if (left instanceof StringValue sv && right instanceof Column col) {
                addFilter(col, sv.getValue());
                if (DATE_LITERAL.matcher(sv.getValue()).find()) {
                    dateLiteralFilter = true;
                }
            }
        }

        private void addFilter(Column col, String value) {
            String raw = normalizeIdentifier(col.getFullyQualifiedName());
            if (raw.isEmpty()) return;
            int dot = raw.lastIndexOf('.');
            if (dot > 0) {
                stringFilters.add(new StringFilter(raw.substring(0, dot), raw.substring(dot + 1), value));
            } else {
                stringFilters.add(new StringFilter(null, raw, value));
            }
        }

        private String normalizeIdentifier(String name) {
            if (name == null) return "";
            return name.replace("`", "").replace("\"", "").trim();
        }

        Analysis toAnalysis() {
            // 括号不影响结构，Parenthesis 已由 adapter 递归；这里仅防御性清理
            return new Analysis(List.copyOf(fromTables), List.copyOf(joinEdges),
                    List.copyOf(stringFilters), dateLiteralFilter, dateRangeQuery);
        }
    }
}
