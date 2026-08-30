package com.luban.constant;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public enum ToolType {

    HTTP("HTTP", "HTTP 接口", "调用外部 REST API"),
    MCP_PASSTHROUGH("MCP_PASSTHROUGH", "MCP 透传", "透传 MCP Server 工具");

    private final String value;
    private final String label;
    private final String description;

    ToolType(String value, String label, String description) {
        this.value = value;
        this.label = label;
        this.description = description;
    }

    public String getValue() {
        return value;
    }

    public String getLabel() {
        return label;
    }

    public String getDescription() {
        return description;
    }

    public static ToolType fromValue(String value) {
        for (ToolType type : values()) {
            if (type.value.equals(value)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown tool type: " + value);
    }

    public static List<Map<String, String>> toList() {
        return Arrays.stream(values())
                .map(t -> {
                    Map<String, String> map = new LinkedHashMap<>();
                    map.put("value", t.value);
                    map.put("label", t.label);
                    map.put("description", t.description);
                    return map;
                })
                .toList();
    }
}