package com.luban.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import java.util.List;

@Data
@AllArgsConstructor
public class RunQueryResponse {
    private List<String> columns;
    private List<List<Object>> rows;
    private long totalCount;
    private long executionTime;
    private String resolvedSql;
    /** INSERT 语句执行后的自增主键（非自增/无主键时为 null）。审批回写场景页面据此把业务记录 id 放进 startWorkflow 的 formData */
    private Long insertId;

    public RunQueryResponse(List<String> columns, List<List<Object>> rows, long totalCount,
                            long executionTime, String resolvedSql) {
        this(columns, rows, totalCount, executionTime, resolvedSql, null);
    }
}