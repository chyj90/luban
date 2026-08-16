package com.luban.dto;

import lombok.Data;

@Data
public class ExecuteSqlRequest {
    private Long datasourceId;
    private String sql;
}