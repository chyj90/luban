package com.luban.service;

import com.luban.repository.DatasourceRepository;
import com.luban.service.SqlSecurityValidator.ValidationResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.lenient;

@ExtendWith(MockitoExtension.class)
class SqlSecurityValidatorTest {

    @Mock
    private DatasourceRepository datasourceRepository;

    private SqlSecurityValidator validator;

    @BeforeEach
    void setUp() {
        validator = new SqlSecurityValidator(datasourceRepository);
        // datasourceId=null 走默认规则，不触发仓储查询
        lenient().when(datasourceRepository.findById(anyLong())).thenReturn(Optional.empty());
    }

    private ValidationResult validate(String sql) {
        return validator.validate(sql, null);
    }

    @Test
    void allowsPlainSelectWithAuditColumns() {
        // 修复前: upperSql.contains("UPDATE") 会被 updated_at 误杀
        ValidationResult r = validate("SELECT id, updated_at, created_at, deleted FROM orders WHERE created_at > '2024-01-01'");
        assertThat(r.isValid()).as("errors=%s", r.getErrors()).isTrue();
    }

    @Test
    void allowsUpdateAtColumnWithUnderscore() {
        ValidationResult r = validate("SELECT updated_at FROM dedicated_lines");
        assertThat(r.isValid()).as("errors=%s", r.getErrors()).isTrue();
    }

    @Test
    void rejectsDmlStatements() {
        assertThat(validate("DELETE FROM orders WHERE id = 1").isValid()).isFalse();
        assertThat(validate("UPDATE orders SET status = 'x' WHERE id = 1").isValid()).isFalse();
        assertThat(validate("DROP TABLE orders").isValid()).isFalse();
        assertThat(validate("INSERT INTO orders(id) VALUES (1)").isValid()).isFalse();
        assertThat(validate("TRUNCATE TABLE orders").isValid()).isFalse();
    }

    @Test
    void rejectsUnparseableSql_failClosed() {
        // 修复前: 解析失败仅 warning 放行
        ValidationResult r = validate("SELECT oops((( FROM !!");
        assertThat(r.isValid()).isFalse();
        assertThat(r.getErrors().get(0)).contains("无法解析");
    }

    @Test
    void rejectsMultiStatements() {
        ValidationResult r = validate("SELECT 1; DROP TABLE orders");
        assertThat(r.isValid()).isFalse();
    }

    @Test
    void rejectsForbiddenFunctions() {
        assertThat(validate("SELECT SLEEP(5)").isValid()).isFalse();
        assertThat(validate("SELECT BENCHMARK(1000000, MD5('x'))").isValid()).isFalse();
        assertThat(validate("SELECT LOAD_FILE('/etc/passwd')").isValid()).isFalse();
    }

    @Test
    void rejectsIntoOutfile() {
        ValidationResult r = validate("SELECT * FROM orders INTO OUTFILE '/tmp/x'");
        assertThat(r.isValid()).isFalse();
    }

    @Test
    void rejectsComments() {
        assertThat(validate("SELECT 1 /* hidden */").isValid()).isFalse();
        assertThat(validate("SELECT 1 -- tail").isValid()).isFalse();
    }

    @Test
    void allowsLiteralContainingDangerousWords() {
        // 字面量内的敏感词不构成语句级风险，不应误杀
        ValidationResult r = validate("SELECT note FROM orders WHERE note = 'please do not UPDATE this row'");
        assertThat(r.isValid()).as("errors=%s", r.getErrors()).isTrue();
    }

    @Test
    void allowsUnionSelectButWarns() {
        ValidationResult r = validate("SELECT a FROM t1 UNION SELECT b FROM t2");
        assertThat(r.isValid()).isTrue();
        assertThat(r.getWarnings()).anyMatch(w -> w.contains("UNION"));
    }

    @Test
    void rejectsEmptyAndOversizedSql() {
        assertThat(validate(null).isValid()).isFalse();
        assertThat(validate("   ").isValid()).isFalse();
        assertThat(validate("SELECT '" + "x".repeat(5000) + "'").isValid()).isFalse();
    }
}
