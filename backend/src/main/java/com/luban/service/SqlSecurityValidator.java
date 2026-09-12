package com.luban.service;

import com.luban.entity.Datasource;
import com.luban.repository.DatasourceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.sf.jsqlparser.JSQLParserException;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;
import net.sf.jsqlparser.statement.Statement;
import net.sf.jsqlparser.statement.select.Select;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Slf4j
@Service
@RequiredArgsConstructor
public class SqlSecurityValidator {

    private final DatasourceRepository datasourceRepository;

    /**
     * 语句级禁用操作按"词元"精确匹配，不做子串匹配：
     * 否则 updated_at 命中 UPDATE、created_at 命中 CREATE 这类列名会被误杀。
     * 主要防线仍是 AST 类型检查（必须解析为 Select），词元检查是方言兜底。
     */
    private static final Set<String> FORBIDDEN_OPERATIONS = Set.of(
            "DROP", "ALTER", "TRUNCATE", "CREATE", "INSERT", "UPDATE", "DELETE",
            "GRANT", "REVOKE", "EXEC", "EXECUTE", "MERGE", "REPLACE", "CALL", "SET", "USE", "LOCK"
    );

    private static final Set<String> FORBIDDEN_FUNCTIONS = Set.of(
            "SLEEP", "BENCHMARK", "LOAD_FILE", "GET_LOCK", "RELEASE_LOCK", "IS_FREE_LOCK",
            "XP_CMDSHELL", "EXTRACTVALUE", "UPDATEXML", "SYS_EXEC", "SYS_EVAL", "MULTIPOINT", "GEOMCOLLECTION"
    );

    private static final Pattern COMMENT_PATTERN = Pattern.compile(
            "/\\*.*?\\*/|--[^\\n]*|#[^\\n]*", Pattern.DOTALL);

    private static final Pattern STRING_LITERAL_PATTERN = Pattern.compile("'([^']|'')*'|\"([^\"]|\"\")*\"");

    private static final Pattern INTO_FILE_PATTERN = Pattern.compile(
            "\\bINTO\\s+(OUTFILE|DUMPFILE)\\b", Pattern.CASE_INSENSITIVE);

    private static final Pattern TOKEN_PATTERN = Pattern.compile("[A-Za-z_][A-Za-z0-9_$]*");

    private static final Pattern UNION_PATTERN = Pattern.compile(
            "\\bUNION\\s+(ALL\\s+)?SELECT\\b", Pattern.CASE_INSENSITIVE);

    private static final int MAX_SQL_LENGTH = 4096;

    public ValidationResult validate(String sql, Long datasourceId) {
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

        // AST 检查是主防线：只接受可解析的 SELECT，解析失败一律拒绝（fail-closed），
        // 同时天然拒绝多语句（; 分隔的第二条语句会解析报错）。
        try {
            Statement stmt = CCJSqlParserUtil.parse(sql);
            if (!(stmt instanceof Select)) {
                errors.add("只允许 SELECT 查询");
                return new ValidationResult(false, errors, warnings);
            }
        } catch (JSQLParserException e) {
            log.warn("SQL 解析失败，拒绝执行: {}", e.getMessage());
            errors.add("SQL 无法解析为受支持的 SELECT 语句，已拒绝执行: " + e.getMessage());
            return new ValidationResult(false, errors, warnings);
        }

        // 先剥离字符串字面量，再检测/移除注释：既保留"禁止注释"的原策略，
        // 又避免字面量内容（如 WHERE note = '/* xxx'）误触发
        String noLiterals = STRING_LITERAL_PATTERN.matcher(sql).replaceAll("''");
        if (COMMENT_PATTERN.matcher(noLiterals).find()) {
            errors.add("SQL 中不允许包含注释");
            return new ValidationResult(false, errors, warnings);
        }
        String cleaned = COMMENT_PATTERN.matcher(noLiterals).replaceAll(" ");

        Set<String> tokens = tokenize(cleaned);
        for (String token : tokens) {
            if (getForbiddenOps().contains(token)) {
                errors.add("禁止的操作: " + token);
                return new ValidationResult(false, errors, warnings);
            }
        }
        for (String func : FORBIDDEN_FUNCTIONS) {
            if (tokens.contains(func)) {
                errors.add("禁止的函数: " + func);
                return new ValidationResult(false, errors, warnings);
            }
        }

        if (INTO_FILE_PATTERN.matcher(cleaned).find()) {
            errors.add("禁止 INTO OUTFILE/DUMPFILE 文件写出");
            return new ValidationResult(false, errors, warnings);
        }

        if (UNION_PATTERN.matcher(sql).find()) {
            warnings.add("SQL 包含 UNION SELECT，可能尝试联合查询");
        }

        if (datasourceId != null) {
            validateDatasourceAccess(datasourceId, errors);
        }

        return new ValidationResult(errors.isEmpty(), errors, warnings);
    }

    private Set<String> tokenize(String cleanedSql) {
        Set<String> tokens = new HashSet<>();
        Matcher matcher = TOKEN_PATTERN.matcher(cleanedSql);
        while (matcher.find()) {
            tokens.add(matcher.group().toUpperCase(Locale.ROOT));
        }
        return tokens;
    }

    /**
     * 问数链路是只读分析场景，所有数据源方言统一使用最严操作集合；
     * 旧的按方言放宽（如 ClickHouse 放行 DELETE）没有业务必要性，且扩大攻击面。
     */
    private Set<String> getForbiddenOps() {
        return FORBIDDEN_OPERATIONS;
    }

    private void validateDatasourceAccess(Long datasourceId, List<String> errors) {
        Datasource ds = datasourceRepository.findById(datasourceId).orElse(null);
        if (ds == null) {
            errors.add("数据源不存在: " + datasourceId);
        } else if (!"connected".equals(ds.getStatus())) {
            errors.add("数据源不可用: " + ds.getName());
        }
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