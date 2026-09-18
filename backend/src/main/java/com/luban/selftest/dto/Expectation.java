package com.luban.selftest.dto;

import lombok.Data;

/** assert_sql 的期望。value 支持 ${...} 占位符，但不含表达式求值（安全边界，T4） */
@Data
public class Expectation {
    /** cell_eq（首行首列相等）| rows_count_eq | cell_contains | is_empty */
    private String operator;
    private String value;
}
