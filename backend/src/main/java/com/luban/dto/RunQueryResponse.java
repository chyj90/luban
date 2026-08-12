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
}