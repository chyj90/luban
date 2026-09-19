package com.luban.constant;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 概念 ↔ 工具绑定语义（一套，非两代并存）：
 * - CONSUMES：工具消费概念的数据（概念数据是工具的输入）；
 * - PRODUCES：工具产出概念的数据；
 * - INVOKES：此概念的业务问题可调用该工具/算法。
 * 问数链路中 ContextBuilder 按 INVOKES 为概念挂载算法，OntologyService 工具扩展
 * 按 CONSUMES（找消费命中概念的 API 工具）→ 概念图扩展 → PRODUCES（扩展概念被哪些工具产出）检索。
 */
public enum BindingType {

    PRODUCES("PRODUCES", "产出", "工具→概念，工具产出概念数据"),
    CONSUMES("CONSUMES", "消费", "工具→概念，工具消费概念数据作为输入"),
    INVOKES("INVOKES", "调用算法", "概念→工具，此概念的业务问题可调用此算法");

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