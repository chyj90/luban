package com.luban.service;

import com.luban.constant.OntologyOperationType.BuiltinRelation;
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
    private final RoleConceptPermissionService roleConceptPermissionService;

    private static final int MAX_RESULT_ROWS = 200;
    private static final Logger sqlDebug = LoggerFactory.getLogger("sql-debug");
    private static final int MAX_STRING_LENGTH = 500;

    /** 标识符（表名/列名）白名单字符集，用于 value_origins 溯源查询的拼接防注入 */
    private static final Pattern SAFE_IDENTIFIER = Pattern.compile("^[A-Za-z_][A-Za-z0-9_$]*$");

    public Map<String, Object> execute(String sql, List<Long> conceptIds, Long userId,
            Map<String, Map<String, Object>> valueOrigins, AgentStateData state) {
        long t0 = System.currentTimeMillis();
        Map<String, Object> result = new LinkedHashMap<>();

        // 先解析数据源，安全校验需要按数据源类型与状态判定
        List<ConceptMapping> mappings = conceptMappingRepository.findByConceptIdIn(conceptIds);
        List<ConceptJoinMapping> joins = conceptJoinMappingRepository.findByConceptIdIn(conceptIds);
        Long datasourceId = resolveDatasourceId(mappings, joins, conceptIds);

        String permError = checkConceptPermission(userId, conceptIds);
        if (permError != null) {
            result.put("error", permError);
            result.put("rows", 0);
            return result;
        }

        // 校验参数是 datasourceId（此前误传 userId，导致按数据源类型的规则随机失效）
        try {
            var validation = sqlSecurityValidator.validate(sql, datasourceId);
            if (!validation.isValid()) {
                result.put("error", "SQL 安全校验失败: " + String.join("; ", validation.getErrors()));
                result.put("rows", 0);
                return result;
            }
        } catch (Exception e) {
            result.put("error", "SQL 安全校验失败: " + e.getMessage());
            result.put("rows", 0);
            return result;
        }

        String error = validateStringEqualityFilters(sql, valueOrigins, mappings, joins, datasourceId);
        if (error != null) {
            result.put("error", error);
            result.put("rows", 0);
            return result;
        }

        try (Connection conn = getConnection(datasourceId);
             Statement stmt = conn.createStatement()) {
            stmt.setQueryTimeout(30);

            sqlDebug.info("SQL EXEC: datasourceId={}, conceptIds={}, sql={}", datasourceId, conceptIds, sql);

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

                sqlDebug.info("SQL RESULT: rowCount={}, truncated={}", rowCount, rowCount >= MAX_RESULT_ROWS);
            }
        } catch (SQLException e) {
            sqlDebug.info("SQL ERROR: {}", e.getMessage());
            result.put("error", "SQL 执行失败: " + e.getMessage());
            result.put("rows", 0);
        }

        log.info("SqlExecution: {}ms, sql={}, rows={}", System.currentTimeMillis() - t0,
                sql.length() > 100 ? sql.substring(0, 100) + "..." : sql, result.getOrDefault("rowCount", 0));
        if (datasourceId != null) {
            result.put("_datasourceId", datasourceId);
        }
        return result;
    }

    String validateStringEqualityFilters(String sql, Map<String, Map<String, Object>> valueOrigins,
            List<ConceptMapping> mappings, List<ConceptJoinMapping> joins, Long datasourceId) {
        if (sql == null) return null;

        // AST 提取字符串等值与 IN 右值（原正则会漏掉 IN 列表和 ON 条件里的值）
        SqlStructureAnalyzer.Analysis analysis = SqlStructureAnalyzer.analyze(sql);
        if (analysis == null) return null;

        boolean hasStringFilter = false;
        List<String[]> filters = new ArrayList<>();
        for (SqlStructureAnalyzer.StringFilter f : analysis.stringFilters()) {
            if (f.value().matches("\\d+")) continue;
            hasStringFilter = true;
            filters.add(new String[]{f.qualifiedRef(), f.value()});
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

    /**
     * 执行期概念权限硬校验。语义与 ContextBuilder 一致（无分组/未配置的域放行，
     * 显式无权限拒绝），但校验异常时 fail-closed 拒绝执行，而不是像 prompt 层那样放行。
     * 返回的错误信息以"未授权"开头，AgentService 据此跳过 SQL 重试、直接引导用户申请权限。
     */
    private String checkConceptPermission(Long userId, List<Long> conceptIds) {
        if (userId == null || conceptIds == null || conceptIds.isEmpty()) return null;
        try {
            Map<Long, Boolean> perms = roleConceptPermissionService.batchCheckQueryPermission(userId, conceptIds);
            List<Long> denied = conceptIds.stream()
                    .filter(id -> !perms.getOrDefault(id, false))
                    .toList();
            if (!denied.isEmpty()) {
                log.warn("SQL execution denied: userId={}, unauthorizedConceptIds={}", userId, denied);
                return "未授权: 概念 " + denied + " 不在当前用户的可查询域内，请申请对应域的概念查询权限后再试";
            }
        } catch (Exception e) {
            log.warn("Concept permission check failed, rejecting execution: userId={}, error={}", userId, e.getMessage());
            return "未授权: 概念权限校验服务异常，为安全起见本次查询已拒绝，请稍后重试或联系管理员";
        }
        return null;
    }

    private boolean verifyValueExists(String table, String column, String value, String originalSql, Long datasourceId) {
        // 表名/列名来自 LLM 声明，先过标识符白名单再拼接，防止标识符注入
        if (!isSafeQualifiedName(table) || !isSafeIdentifier(column)) {
            log.warn("Right-value verification rejected unsafe identifier: table={}, column={}", table, column);
            return false;
        }
        try (Connection conn = getConnection(datasourceId);
             Statement stmt = conn.createStatement()) {
            stmt.setQueryTimeout(10);
            String verifySql = "SELECT 1 FROM " + table + " WHERE " + column + " = '" + value.replace("'", "''") + "' LIMIT 1";
            try (ResultSet rs = stmt.executeQuery(verifySql)) {
                return rs.next();
            }
        } catch (SQLException e) {
            // 校验失败按"值不存在"处理（fail-closed），原实现放行会导致溯源校验形同虚设
            log.warn("Right-value verification failed for {}.{}='{}': {}", table, column, value, e.getMessage());
            return false;
        }
    }

    /** 支持 schema.table 形式，每段都必须是安全标识符 */
    private boolean isSafeQualifiedName(String name) {
        if (name == null || name.isBlank()) return false;
        for (String part : name.split("\\.")) {
            if (!SAFE_IDENTIFIER.matcher(part).matches()) return false;
        }
        return true;
    }

    private boolean isSafeIdentifier(String name) {
        return name != null && SAFE_IDENTIFIER.matcher(name).matches();
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
                        .stream().filter(r -> BuiltinRelation.DRILLS_INTO.name().equals(r.getRelationType())).toList();
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
        String password = datasourceService.decryptPassword(config);
        log.info("getConnection: datasourceId={}, type={}, url={}", datasourceId, ds.getType(), url);
        return DriverManager.getConnection(url,
                String.valueOf(config.get("username")),
                password);
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

    public String formatResult(Map<String, Object> result, String sql, Long datasourceId) {
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
            sb.append("SQL 查询返回 0 行。\n");
            if (sql != null && datasourceId != null) {
                Set<String> tables = extractTableNames(sql);
                if (!tables.isEmpty()) {
                    sb.append("涉及表: ").append(String.join(", ", tables)).append("\n");
                    Map<String, Long> existence = checkTableExistence(tables, datasourceId);
                    List<String> existing = new ArrayList<>();
                    List<String> empty = new ArrayList<>();
                    List<String> missing = new ArrayList<>();
                    for (String t : tables) {
                        Long count = existence.get(t);
                        if (count == null || count < 0) {
                            missing.add(t);
                        } else if (count == 0) {
                            empty.add(t);
                        } else {
                            existing.add(t + "（共 " + count + " 行）");
                        }
                    }
                    if (!empty.isEmpty()) {
                        sb.append("【系统校验】表 ").append(String.join(", ", empty))
                                .append(" 在数据源中为空表（0 行），任何查询该表的 SQL 都会返回 0 行。\n");
                        sb.append("请检查是否应从其他表获取数据，或告知用户该表无数据。\n");
                    }
                    if (!existing.isEmpty()) {
                        sb.append("【系统校验】表 ").append(String.join(", ", existing))
                                .append(" 在数据源中存在且有数据。0 行表示当前 WHERE/JOIN 条件不匹配，并非表结构缺失。\n");
                        sb.append("禁止将 0 行归因为\"表不可用\"或\"映射缺失\"。\n");
                    }
                    if (!missing.isEmpty()) {
                        sb.append("【系统校验】表 ").append(String.join(", ", missing))
                                .append(" 在数据源中不存在，SQL 可能有误。\n");
                    }
                }
            }
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

    Map<String, Long> checkTableExistence(Set<String> tables, Long datasourceId) {
        Map<String, Long> result = new LinkedHashMap<>();
        if (tables == null || tables.isEmpty() || datasourceId == null) return result;
        try (Connection conn = getConnection(datasourceId);
             Statement stmt = conn.createStatement()) {
            stmt.setQueryTimeout(5);
            for (String table : tables) {
                try {
                    ResultSet rs = stmt.executeQuery("SELECT COUNT(*) FROM " + table);
                    if (rs.next()) {
                        result.put(table, rs.getLong(1));
                    } else {
                        result.put(table, -1L);
                    }
                    rs.close();
                } catch (SQLException e) {
                    result.put(table, -1L);
                }
            }
        } catch (SQLException e) {
            log.warn("checkTableExistence failed: {}", e.getMessage());
        }
        return result;
    }
}