package com.luban.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class TestDatasourceResponse {
    private boolean success;
    private String message;
}