package com.luban.service;

import com.luban.entity.*;
import com.luban.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.sql.*;
import java.util.*;
import java.util.regex.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class SqlExecutionService {

    private final DataSource dataSource;
    private final ConceptMappingRepository conceptMappingRepository;
    private final ConceptRepository conceptRepository;
    private final ConceptJoinMappingRepository conceptJoinMappingRepository;
    private final ConceptRelationRepository conceptRelationRepository;
    private final SqlSecurityValidator sqlSecurityValidator;
    private final DatasourceService datasourceService;
    private final DatasourceRepository datasourceRepository;

    private static final int MAX_RESULT_ROWS = 200;
    private static final Logger sqlDebug = LoggerFactory.getLogger("sql-debug");
    private static final int MAX_STRING_LENGTH = 500;

    public Map<String, Object> execute(String sql, List<Long> conceptIds, Long userId,
            Map<String, Map<String, Object>> valueOrigins, AgentStateData state) {
        long t0 = System.currentTimeMillis();
        Map<String, Object> result = new LinkedHashMap<>();

        try {
            sqlSecurityValidator.validate(sql, userId);
        } catch (Exception e) {
            result.put("error", "SQL 安全校验失败: " + e.getMessage());
            result.put("rows", 0);
            return result;
        }

        List<ConceptMapping> mappings = conceptMappingRepository.findByConceptIdIn(conceptIds);
        List<ConceptJoinMapping> joins = conceptJoinMappingRepository.findByConceptIdIn(conceptIds);

        Long datasourceId = resolveDatasourceId(mappings, joins, conceptIds);

        String error = validateStringEqualityFilters(sql, valueOrigins, mappings, joins, datasourceId);
        if (error != null) {
            result.put("error", error);
            result.put("rows", 0);
            return result;
        }

        try (Connection conn = getConnection(datasourceId);
             Statement stmt = conn.createStatement()) {
            stmt.setQueryTimeout(30);

            sqlDebug.info("========== SQL DEBUG START ==========");
            sqlDebug.info("FULL SQL: {}", sql);
            sqlDebug.info("datasourceId: {}, conceptIds: {}", datasourceId, conceptIds);

            try (Statement diagStmt = conn.createStatement()) {
                diagStmt.setQueryTimeout(10);
                try (ResultSet rs = diagStmt.executeQuery("SELECT DATABASE() AS db")) {
                    if (rs.next()) sqlDebug.info("CURRENT DATABASE: {}", rs.getString("db"));
                }
                try (ResultSet rs = diagStmt.executeQuery("SELECT COUNT(*) AS cnt FROM dedicated_lines")) {
                    if (rs.next()) sqlDebug.info("dedicated_lines COUNT: {}", rs.getInt("cnt"));
                }
                try (ResultSet rs = diagStmt.executeQuery("SELECT * FROM dedicated_lines")) {
                    int diagRow = 0;
                    while (rs.next()) {
                        diagRow++;
                        ResultSetMetaData m = rs.getMetaData();
                        StringBuilder sb = new StringBuilder();
                        for (int i = 1; i <= m.getColumnCount(); i++) {
                            if (i > 1) sb.append(" | ");
                            sb.append(m.getColumnName(i)).append("=").append(rs.getString(i));
                        }
                        sqlDebug.info("dedicated_lines row#{}: {}", diagRow, sb);
                    }
                }
                try (ResultSet rs = diagStmt.executeQuery("SELECT COUNT(*) AS cnt FROM stations")) {
                    if (rs.next()) sqlDebug.info("stations COUNT: {}", rs.getInt("cnt"));
                }
                try (ResultSet rs = diagStmt.executeQuery("SELECT * FROM stations")) {
                    int diagRow = 0;
                    while (rs.next()) {
                        diagRow++;
                        ResultSetMetaData m = rs.getMetaData();
                        StringBuilder sb = new StringBuilder();
                        for (int i = 1; i <= m.getColumnCount(); i++) {
                            if (i > 1) sb.append(" | ");
                            sb.append(m.getColumnName(i)).append("=").append(rs.getString(i));
                        }
                        sqlDebug.info("stations row#{}: {}", diagRow, sb);
                    }
                }
            } catch (SQLException diagErr) {
                sqlDebug.info("DIAG QUERY FAILED: {}", diagErr.getMessage());
            }

            try (ResultSet rs = stmt.executeQuery(sql)) {
                ResultSetMetaData meta = rs.getMetaData();
                int columnCount = meta.getColumnCount();
                List<String> columns = new ArrayList<>();
                for (int i = 1; i <= columnCount; i++) columns.add(meta.getColumnLabel(i));
                List<Map<String, Object>> rows = new ArrayList<>();
                int rowCount = 0;
                while (rs.next() && rowCount < MAX_RESULT_ROWS) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    for (String col : columns) {
                        String val = rs.getString(col);
                        if (val != null && val.length() > MAX_STRING_LENGTH) val = val.substring(0, MAX_STRING_LENGTH) + "...";
                        row.put(col, val);
                    }
                    rows.add(row);
                    rowCount++;
                }
                result.put("columns", columns);
                result.put("rows", rows);
                result.put("rowCount", rowCount);
                result.put("truncated", rowCount >= MAX_RESULT_ROWS);

                sqlDebug.info("MAIN QUERY RESULT: columns={}, rowCount={}", columns, rowCount);
                if (rowCount > 0 && !rows.isEmpty()) {
                    sqlDebug.info("FIRST ROW: {}", rows.get(0));
                }
                sqlDebug.info("========== SQL DEBUG END ==========");
            }
        } catch (SQLException e) {
            sqlDebug.info("MAIN QUERY ERROR: {}", e.getMessage());
            sqlDebug.info("========== SQL DEBUG END ==========");
            result.put("error", "SQL 执行失败: " + e.getMessage());
            result.put("rows", 0);
        }

        log.info("SqlExecution: {}ms, sql={}, rows={}", System.currentTimeMillis() - t0,
                sql.length() > 100 ? sql.substring(0, 100) + "..." : sql, result.getOrDefault("rowCount", 0));
        return result;
    }

    String validateStringEqualityFilters(String sql, Map<String, Map<String, Object>> valueOrigins,
            List<ConceptMapping> mappings, List<ConceptJoinMapping> joins, Long datasourceId) {
        if (sql == null) return null;

        Pattern pattern = Pattern.compile("(?i)\\b(\\w+)\\s*(!?=)\\s*'([^']+)'");
        Matcher matcher = pattern.matcher(sql);
        boolean hasStringFilter = false;
        List<String[]> filters = new ArrayList<>();

        while (matcher.find()) {
            String column = matcher.group(1);
            String value = matcher.group(3);
            if (value.matches("\\d+")) continue;
            hasStringFilter = true;
            filters.add(new String[]{column, value});
        }

        if (!hasStringFilter) return null;

        if (valueOrigins == null || valueOrigins.isEmpty()) {
            return "SQL 包含字符串等值条件但缺少 value_origins 声明。"
                    + "按规则在 nl2sql JSON 中为每个字符串右值声明 value_origins。"
                    + " 涉及的列: " + filters.stream().map(f -> f[0] + "='" + f[1] + "'")
                    .collect(Collectors.joining(", "));
        }

        for (String[] filter : filters) {
            String column = filter[0];
            String value = filter[1];
            Map<String, Object> origin = valueOrigins.get(value);
            if (origin == null) {
                return "字符串右值 '" + value + "' 未在 value_origins 中声明来源。"
                        + " 涉及列: " + column + "。请声明该值的 origin。";
            }

            String originType = (String) origin.get("origin");
            if ("previous_sql".equals(originType)) {
                continue;
            }

            if ("table_column".equals(originType)) {
                String table = (String) origin.get("table");
                String col = (String) origin.get("column");
                if (table == null || col == null) {
                    return "value_origins 中 '" + value + "' 的 table_column 类型缺少 table 或 column 字段。";
                }
                if (!verifyValueExists(table, col, value, sql, datasourceId)) {
                    return "字符串右值 '" + value + "' 在表 " + table + "." + col + " 中不存在。"
                            + " 请检查枚举值是否正确，不要根据用户问题臆造右值。"
                            + " 例如用户说\"致命告警\"，数据库实际值可能是\"CRITICAL\"。";
                }
                continue;
            }

            return "value_origins 中 '" + value + "' 的 origin 类型无效: " + originType
                    + "。仅支持 table_column 和 previous_sql。";
        }

        return null;
    }

    private boolean verifyValueExists(String table, String column, String value, String originalSql, Long datasourceId) {
        try (Connection conn = getConnection(datasourceId);
             Statement stmt = conn.createStatement()) {
            stmt.setQueryTimeout(10);
            String verifySql = "SELECT 1 FROM " + table + " WHERE " + column + " = '" + value.replace("'", "''") + "' LIMIT 1";
            try (ResultSet rs = stmt.executeQuery(verifySql)) {
                return rs.next();
            }
        } catch (SQLException e) {
            log.warn("Right-value verification failed for {}.{}='{}': {}", table, column, value, e.getMessage());
            return true;
        }
    }

    private Long resolveDatasourceId(List<ConceptMapping> mappings, List<ConceptJoinMapping> joins, List<Long> conceptIds) {
        Set<Long> ids = new LinkedHashSet<>();
        boolean hasComputed = false;
        for (ConceptMapping m : mappings) {
            if (m.getDatasourceId() != null) ids.add(m.getDatasourceId());
            if ("computed".equals(m.getMappingType())) hasComputed = true;
        }
        for (ConceptJoinMapping j : joins) {
            if (j.getDatasourceId() != null) ids.add(j.getDatasourceId());
        }
        if (ids.size() == 1) {
            return ids.iterator().next();
        }
        if (ids.size() > 1) {
            log.warn("resolveDatasourceId: 多个数据源冲突 ids={}, 无法确定唯一数据源", ids);
            return null;
        }
        if (ids.isEmpty() && !conceptIds.isEmpty()) {
            if (hasComputed) {
                List<ConceptRelation> drillRelations = conceptRelationRepository.findBySourceConceptIdIn(conceptIds)
                        .stream().filter(r -> "DRILLS_INTO".equals(r.getRelationType())).toList();
                if (!drillRelations.isEmpty()) {
                    List<Long> childIds = drillRelations.stream()
                            .map(ConceptRelation::getTargetConceptId).distinct().toList();
                    List<ConceptMapping> childMappings = conceptMappingRepository.findByConceptIdIn(childIds);
                    Set<Long> childDsIds = childMappings.stream()
                            .map(ConceptMapping::getDatasourceId).filter(Objects::nonNull).collect(Collectors.toSet());
                    if (childDsIds.size() == 1) {
                        log.info("resolveDatasourceId: computed concept, fallback to child concepts {} → datasourceId={}",
                                childIds, childDsIds.iterator().next());
                        return childDsIds.iterator().next();
                    }
                }
                log.warn("resolveDatasourceId: computed concept but no child with unique datasource, conceptIds={}", conceptIds);
            } else {
                log.error("resolveDatasourceId: 概念缺少表映射，请为概念添加 direct/computed 类型的 ConceptMapping, conceptIds={}",
                        conceptIds);
            }
        }
        log.info("resolveDatasourceId: conceptIds={}, mappings={}, joins={}, ids={}, resolved=null",
                conceptIds,
                mappings.stream().map(m -> m.getConceptId() + "→" + m.getMappingType() + "→ds" + m.getDatasourceId()).collect(Collectors.toList()),
                joins.stream().map(j -> j.getConceptId() + "→ds" + j.getDatasourceId()).collect(Collectors.toList()),
                ids);
        return null;
    }

    private Connection getConnection(Long datasourceId) throws SQLException {
        if (datasourceId == null) {
            throw new SQLException("无法确定数据源：当前查询涉及的概念缺少表映射配置，请检查本体配置是否完整");
        }
        Datasource ds = datasourceRepository.findById(datasourceId).orElse(null);
        if (ds == null) {
            throw new SQLException("数据源不存在：datasourceId=" + datasourceId + "，请检查数据源配置");
        }
        Map<String, Object> config = datasourceService.fromJsonMap(ds.getConfig());
        String url = datasourceService.buildJdbcUrl(ds.getType(), config);
        log.info("getConnection: datasourceId={}, type={}, url={}", datasourceId, ds.getType(), url);
        return DriverManager.getConnection(url,
                String.valueOf(config.get("username")),
                String.valueOf(config.get("password")));
    }

    public Set<String> extractTableNames(String sql) {
        if (sql == null) return Set.of();
        Set<String> tables = new LinkedHashSet<>();
        Pattern pattern = Pattern.compile("(?i)\\bFROM\\s+`?(\\w+)`?|\\bJOIN\\s+`?(\\w+)`?", Pattern.CASE_INSENSITIVE);
        Matcher matcher = pattern.matcher(sql);
        while (matcher.find()) {
            String t = matcher.group(1) != null ? matcher.group(1) : matcher.group(2);
            if (t != null) tables.add(t);
        }
        return tables;
    }

    public String formatResult(Map<String, Object> result) {
        if (result == null) return "SQL 执行结果为空";
        if (result.containsKey("error")) return (String) result.get("error");
        @SuppressWarnings("unchecked")
        List<String> columns = (List<String>) result.get("columns");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = (List<Map<String, Object>>) result.get("rows");
        int rowCount = (int) result.getOrDefault("rowCount", rows != null ? rows.size() : 0);
        boolean truncated = (boolean) result.getOrDefault("truncated", false);
        StringBuilder sb = new StringBuilder();
        if (rowCount == 0) {
            sb.append("SQL 查询返回 0 行。");
        } else {
            sb.append("SQL 查询返回 ").append(rowCount).append(" 行");
            if (truncated) sb.append("（已截断至 ").append(MAX_RESULT_ROWS).append(" 行）");
            sb.append("。\n\n");
            if (columns != null && rows != null) {
                sb.append("| ").append(String.join(" | ", columns)).append(" |\n");
                sb.append("|").append("|".repeat(columns.size()).replace("|", "---|")).append("\n");
                for (Map<String, Object> row : rows) {
                    sb.append("| ");
                    for (String col : columns) {
                        Object v = row.get(col);
                        sb.append(v != null ? v.toString().replace("|", "\\|").replace("\n", " ") : "-");
                        sb.append(" | ");
                    }
                    sb.append("\n");
                }
            }
        }
        return sb.toString();
    }
}