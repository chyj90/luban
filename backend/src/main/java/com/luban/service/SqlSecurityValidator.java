package com.luban.service;

import com.luban.entity.ConceptMapping;
import com.luban.entity.Datasource;
import com.luban.repository.DatasourceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.sf.jsqlparser.JSQLParserException;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;
import net.sf.jsqlparser.statement.Statement;
import net.sf.jsqlparser.statement.select.Select;
import net.sf.jsqlparser.statement.select.PlainSelect;
import net.sf.jsqlparser.statement.select.FromItem;
import net.sf.jsqlparser.schema.Table;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Pattern;

@Slf4j
@Service
@RequiredArgsConstructor
public class SqlSecurityValidator {

    private final DatasourceRepository datasourceRepository;

    private static final Set<String> FORBIDDEN_OPERATIONS = Set.of(
            "DROP", "ALTER", "TRUNCATE", "CREATE", "INSERT", "UPDATE", "DELETE",
            "GRANT", "REVOKE", "EXEC", "EXECUTE", "MERGE", "REPLACE"
    );

    private static final Set<String> FORBIDDEN_FUNCTIONS = Set.of(
            "SLEEP", "BENCHMARK", "LOAD_FILE", "INTO OUTFILE", "INTO DUMPFILE",
            "GET_LOCK", "RELEASE_LOCK", "xp_cmdshell", "EXEC"
    );

    private static final Pattern COMMENT_PATTERN = Pattern.compile(
            "/\\*.*?\\*/|--[^\\n]*", Pattern.DOTALL);

    private static final Pattern UNION_PATTERN = Pattern.compile(
            "\\bUNION\\s+(ALL\\s+)?SELECT\\b", Pattern.CASE_INSENSITIVE);

    private static final int MAX_SQL_LENGTH = 4096;

    public ValidationResult validate(String sql, Long datasourceId, List<ConceptMapping> allowedMappings) {
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        if (sql == null || sql.trim().isEmpty()) {
            errors.add("SQL 不能为空");
            return new ValidationResult(false, errors, warnings);
        }

        sql = sql.trim();

        if (sql.length() > MAX_SQL_LENGTH) {
            errors.add("SQL 长度超过限制: " + MAX_SQL_LENGTH);
            return new ValidationResult(false, errors, warnings);
        }

        String upperSql = sql.toUpperCase();

        for (String op : FORBIDDEN_OPERATIONS) {
            if (upperSql.contains(op)) {
                errors.add("禁止的操作: " + op);
                return new ValidationResult(false, errors, warnings);
            }
        }

        for (String func : FORBIDDEN_FUNCTIONS) {
            if (upperSql.contains(func.toUpperCase())) {
                errors.add("禁止的函数: " + func);
                return new ValidationResult(false, errors, warnings);
            }
        }

        if (COMMENT_PATTERN.matcher(sql).find()) {
            errors.add("SQL 中不允许包含注释");
            return new ValidationResult(false, errors, warnings);
        }

        if (UNION_PATTERN.matcher(sql).find()) {
            warnings.add("SQL 包含 UNION SELECT，可能尝试联合查询");
        }

        try {
            Statement stmt = CCJSqlParserUtil.parse(sql);
            if (!(stmt instanceof Select)) {
                errors.add("只允许 SELECT 查询");
                return new ValidationResult(false, errors, warnings);
            }

            if (allowedMappings != null && !allowedMappings.isEmpty()) {
                validateTableAccess(sql, allowedMappings, errors);
            }

            if (datasourceId != null) {
                validateDatasourceAccess(datasourceId, errors);
            }
        } catch (JSQLParserException e) {
            log.warn("SQL 解析失败: {}", e.getMessage());
            warnings.add("SQL 解析警告: " + e.getMessage());
        }

        return new ValidationResult(errors.isEmpty(), errors, warnings);
    }

    private void validateTableAccess(String sql, List<ConceptMapping> mappings, List<String> errors) {
        Set<String> allowedTables = new HashSet<>();
        for (ConceptMapping m : mappings) {
            allowedTables.add(m.getTableName().toLowerCase());
        }

        try {
            Statement stmt = CCJSqlParserUtil.parse(sql);
            if (stmt instanceof Select selectStmt) {
                Set<String> referencedTables = new HashSet<>();
                extractTableNames(selectStmt.getSelectBody(), referencedTables);
                for (String table : referencedTables) {
                    if (!allowedTables.contains(table.toLowerCase())) {
                        errors.add("SQL 中引用了未授权的表: " + table);
                    }
                }
            }
        } catch (JSQLParserException e) {
            log.warn("Failed to parse SQL for table validation: {}", e.getMessage());
        }
    }

    private void extractTableNames(Object selectBody, Set<String> tables) {
        if (selectBody instanceof PlainSelect plain) {
            if (plain.getFromItem() != null) {
                addTableName(plain.getFromItem(), tables);
            }
            if (plain.getJoins() != null) {
                for (var join : plain.getJoins()) {
                    if (join.getFromItem() != null) {
                        addTableName(join.getFromItem(), tables);
                    }
                }
            }
        } else if (selectBody instanceof net.sf.jsqlparser.statement.select.SetOperationList setOp) {
            if (setOp.getSelects() != null) {
                for (var s : setOp.getSelects()) {
                    extractTableNames(s, tables);
                }
            }
        }
    }

    private void addTableName(FromItem fromItem, Set<String> tables) {
        if (fromItem instanceof Table table) {
            tables.add(table.getName());
        } else if (fromItem instanceof PlainSelect subSelect) {
            extractTableNames(subSelect, tables);
        }
    }

    private void validateDatasourceAccess(Long datasourceId, List<String> errors) {
        datasourceRepository.findById(datasourceId).ifPresentOrElse(
                ds -> {
                    if (!"connected".equals(ds.getStatus())) {
                        errors.add("数据源不可用: " + ds.getName());
                    }
                },
                () -> errors.add("数据源不存在: " + datasourceId)
        );
    }

    public static class ValidationResult {
        private final boolean valid;
        private final List<String> errors;
        private final List<String> warnings;

        public ValidationResult(boolean valid, List<String> errors, List<String> warnings) {
            this.valid = valid;
            this.errors = errors;
            this.warnings = warnings;
        }

        public boolean isValid() { return valid; }
        public List<String> getErrors() { return errors; }
        public List<String> getWarnings() { return warnings; }
    }
}