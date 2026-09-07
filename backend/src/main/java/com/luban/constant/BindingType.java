package com.luban.constant;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public enum BindingType {

    PRODUCES("PRODUCES", "产出", "工具→概念，工具产出概念数据"),
    CONSUMES("CONSUMES", "消费", "概念→工具，工具消费概念数据"),
    INVOKES("INVOKES", "调用算法", "概念→算法，此概念的业务问题可调用此算法"),
    INPUT_OF("INPUT_OF", "算法输入", "概念→算法，此概念的数据是算法的输入参数"),
    OUTPUT_OF("OUTPUT_OF", "算法输出", "算法→概念，算法的输出对应此概念");

    private final String value;
    private final String label;
    private final String description;

    BindingType(String value, String label, String description) {
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

    public static BindingType fromValue(String value) {
        for (BindingType type : values()) {
            if (type.value.equals(value)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown binding type: " + value);
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