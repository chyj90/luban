package com.luban.dto;

import lombok.Data;
import java.util.Map;

@Data
public class RunQueryRequest {
    private Map<String, Object> params;
}