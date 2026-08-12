package com.luban.dto;

import lombok.Data;
import java.util.Map;

@Data
public class UpdateQueryRequest {
    private String name;
    private String body;
    private Map<String, Object> params;
}