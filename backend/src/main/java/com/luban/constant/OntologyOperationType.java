package com.luban.constant;

import java.util.Set;
import java.util.stream.Collectors;
import java.util.Arrays;

/**
 * 本体变更操作类型枚举，统一管理操作码、实体类型、LLM JSON 格式和内置关系类型。
 */
public enum OntologyOperationType {

    ADD_CONCEPT(1, true, "CONCEPT", "concept",
            "{\"name\":\"概念名\",\"description\":\"描述\",\"industryId\":1,\"anomalyThresholdExpr\":\"CRITICAL\",\"anomalyThresholdDesc\":\">0触发CRITICAL告警\",\"groupName\":\"所属领域\",\"parentConceptName\":\"父概念名\"}",
            "新增概念"),
    ADD_MAPPING(2, true, "MAPPING", "mapping",
            "{\"conceptName\":\"概念名\",\"tableName\":\"表名\",\"columnName\":\"列名\",\"mappingType\":\"direct\",\"dataSourceId\":1}",
            "新增概念映射"),
    ADD_JOIN_MAPPING(3, true, "JOIN_MAPPING", "joinMapping",
            "{\"conceptName\":\"概念名\",\"joinTable\":\"表B\",\"joinCondition\":\"表A.id = 表B.a_id\",\"relationType\":\"LEFT JOIN\",\"dataSourceId\":1,\"targetConcept\":\"表B对应的概念名\"}",
            "新增表连接映射"),
    ADD_RELATION(4, true, "RELATION", "relation",
            "{\"sourceConceptName\":\"源概念\",\"targetConceptName\":\"目标概念\",\"relationType\":\"DRILLS_INTO\",\"description\":\"关系描述\"}",
            "新增概念关系"),

    UPDATE_CONCEPT(5, true, "CONCEPT", "concept",
            "{\"id\":1,\"name\":\"概念名\",\"description\":\"更新描述\",\"anomalyThresholdExpr\":\"CRITICAL\",\"anomalyThresholdDesc\":\"异常阈值说明\"}",
            "更新概念"),
    UPDATE_MAPPING(6, true, "MAPPING", "mapping",
            "{\"mappingId\":1,\"tableName\":\"表名\",\"columnName\":\"列名\",\"mappingType\":\"direct\",\"dataSourceId\":1}",
            "更新概念映射"),
    UPDATE_JOIN_MAPPING(7, true, "JOIN_MAPPING", "joinMapping",
            "{\"joinMappingId\":1,\"joinTable\":\"表名\",\"joinCondition\":\"连接条件\",\"relationType\":\"LEFT JOIN\"}",
            "更新表连接映射"),
    UPDATE_RELATION(8, true, "RELATION", "relation",
            "{\"id\":1,\"sourceConceptName\":\"源概念\",\"targetConceptName\":\"目标概念\",\"relationType\":\"DRILLS_INTO\",\"description\":\"关系描述\"}",
            "更新概念关系"),

    DELETE_RELATION(9, false, "RELATION", null,
            "{\"relationId\":1}",
            "删除概念关系"),
    DELETE_JOIN_MAPPING(10, false, "JOIN_MAPPING", null,
            "{\"joinMappingId\":1}",
            "删除表连接映射"),
    DELETE_MAPPING(11, false, "MAPPING", null,
            "{\"mappingId\":1}",
            "删除概念映射"),
    DELETE_CONCEPT(12, false, "CONCEPT", null,
            "{\"conceptId\":1}",
            "删除概念（也可用 conceptName 按名称删除）");

    private final int sortOrder;
    private final boolean nested;
    private final String entityType;
    private final String dataKey;
    private final String jsonSchema;
    private final String description;

    OntologyOperationType(int sortOrder, boolean nested, String entityType, String dataKey, String jsonSchema, String description) {
        this.sortOrder = sortOrder;
        this.nested = nested;
        this.entityType = entityType;
        this.dataKey = dataKey;
        this.jsonSchema = jsonSchema;
        this.description = description;
    }

    public int sortOrder() {
        return sortOrder;
    }

    public boolean nested() {
        return nested;
    }

    public String entityType() {
        return entityType;
    }

    public String dataKey() {
        return dataKey;
    }

    public String jsonSchema() {
        return jsonSchema;
    }

    public String description() {
        return description;
    }

    public static OntologyOperationType from(String operation) {
        if (operation == null) return null;
        for (OntologyOperationType t : values()) {
            if (t.name().equalsIgnoreCase(operation)) {
                return t;
            }
        }
        return null;
    }

    public static Set<String> allOperationNames() {
        return Arrays.stream(values())
                .map(Enum::name)
                .collect(Collectors.toSet());
    }

    public static String toOperationList() {
        return Arrays.stream(values())
                .map(Enum::name)
                .collect(Collectors.joining("、"));
    }

    public static String toPromptExamples() {
        StringBuilder sb = new StringBuilder();
        for (OntologyOperationType t : values()) {
            sb.append("  ").append(t.name()).append(": ");
            if (t.nested) {
                sb.append("{\"operation\":\"").append(t.name())
                        .append("\",\"entity_type\":\"").append(t.entityType)
                        .append("\",\"").append(t.dataKey)
                        .append("\":").append(t.jsonSchema).append("}");
            } else {
                sb.append("{\"operation\":\"").append(t.name())
                        .append("\",\"entity_type\":\"").append(t.entityType)
                        .append("\",");
                // 去掉 jsonSchema 的首尾大括号，拼到上层
                String inner = t.jsonSchema.trim();
                if (inner.startsWith("{") && inner.endsWith("}")) {
                    inner = inner.substring(1, inner.length() - 1);
                }
                sb.append(inner).append("}");
            }
            sb.append("\n");
        }
        return sb.toString();
    }

    /**
     * 内置关系类型（行业创建时自动注册）。
     */
    public enum BuiltinRelation {
        DRILLS_INTO("可下钻到子维度，纯分析导航"),
        DRILLED_FROM("上卷维度，DRILLS_INTO 的逆，自动推导"),
        CORRELATED("关联维度，交叉分析提示");

        private final String description;

        BuiltinRelation(String description) {
            this.description = description;
        }

        public String description() {
            return description;
        }

        public static String toPromptList() {
            StringBuilder sb = new StringBuilder();
            for (BuiltinRelation r : values()) {
                sb.append("  - ").append(r.name())
                        .append(": ").append(r.description).append("\n");
            }
            return sb.toString();
        }
    }
}