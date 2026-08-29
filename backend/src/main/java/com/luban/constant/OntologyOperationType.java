package com.luban.constant;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

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
            "{\"sourceConceptName\":\"源概念\",\"targetConceptName\":\"目标概念\",\"relationType\":\"DRILLS_INTO\",\"description\":\"关系描述\",\"expression\":\"可选的计算公式，仅COMPUTED_FROM/DERIVED_FROM需要\"}",
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
            "{\"id\":1,\"sourceConceptName\":\"源概念\",\"targetConceptName\":\"目标概念\",\"relationType\":\"DRILLS_INTO\",\"description\":\"关系描述\",\"expression\":\"可选的计算公式，仅COMPUTED_FROM/DERIVED_FROM需要\"}",
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
        DRILLS_INTO("可下钻到子维度，纯分析导航", "可下钻", "#1677ff", "子维度", "父维度", false, true, false, 0),
        DRILLED_FROM("上卷维度，DRILLS_INTO 的逆，自动推导", "上卷", "#8c8c8c", "父维度", "子维度", false, true, false, 1),
        CORRELATED("关联维度，交叉分析提示，双向对称", "关联", "#faad14", "维度A", "维度B", false, false, true, 2),
        INVOKES("概念调用算法，概念→算法", "调用算法", "#f5222d", "概念", "算法", true, false, false, 3),
        INPUT_OF("算法输入参数绑定概念，算法→概念", "算法输入", "#2f54eb", "算法", "概念", true, false, false, 4),
        OUTPUT_OF("算法输出参数绑定概念，概念←算法", "算法输出", "#389e0d", "概念", "算法", true, false, false, 5),
        COMPUTED_FROM("概念由其他概念计算而来，概念→计算源", "计算得出", "#722ed1", "计算结果", "计算因子", true, true, false, 6),
        DERIVED_FROM("概念派生自其他概念，概念→派生源", "条件触发", "#eb2f96", "派生结果", "派生条件", true, true, false, 7),
        EQUIVALENT_TO("等价概念，双向对称", "等同于", "#52c41a", "概念A", "概念B", false, true, true, 8);

        private final String description;
        private final String label;
        private final String color;
        private final String sourceRole;
        private final String targetRole;
        private final boolean sourceToTarget;
        private final boolean isTransitive;
        private final boolean isSymmetric;
        private final int sortOrder;

        BuiltinRelation(String description, String label, String color, String sourceRole, String targetRole,
                boolean sourceToTarget, boolean isTransitive, boolean isSymmetric, int sortOrder) {
            this.description = description;
            this.label = label;
            this.color = color;
            this.sourceRole = sourceRole;
            this.targetRole = targetRole;
            this.sourceToTarget = sourceToTarget;
            this.isTransitive = isTransitive;
            this.isSymmetric = isSymmetric;
            this.sortOrder = sortOrder;
        }

        public String description() { return description; }
        public String label() { return label; }
        public String color() { return color; }
        public String sourceRole() { return sourceRole; }
        public String targetRole() { return targetRole; }
        public boolean sourceToTarget() { return sourceToTarget; }
        public boolean isTransitive() { return isTransitive; }
        public boolean isSymmetric() { return isSymmetric; }
        public int sortOrder() { return sortOrder; }

        public static String toPromptList() {
            StringBuilder sb = new StringBuilder();
            for (BuiltinRelation r : values()) {
                sb.append("  - ").append(r.name())
                        .append(": ").append(r.description).append("\n");
                sb.append("    sourceConceptName=").append(r.sourceRole)
                        .append(", targetConceptName=").append(r.targetRole);
                if (r == COMPUTED_FROM || r == DERIVED_FROM) {
                    sb.append("\n    **必须提供 expression 字段**，如 expression=\"OEE = 可用率 × 性能率 × 质量率\"");
                }
                sb.append("\n");
            }
            return sb.toString();
        }

        public static List<Map<String, Object>> toApiList() {
            List<Map<String, Object>> list = new ArrayList<>();
            for (BuiltinRelation r : values()) {
                Map<String, Object> map = new LinkedHashMap<>();
                map.put("name", r.name());
                map.put("description", r.description());
                map.put("label", r.label());
                map.put("color", r.color());
                map.put("sourceRole", r.sourceRole());
                map.put("targetRole", r.targetRole());
                map.put("sourceToTarget", r.sourceToTarget());
                map.put("transitive", r.isTransitive());
                map.put("symmetric", r.isSymmetric());
                map.put("sortOrder", r.sortOrder());
                list.add(map);
            }
            return list;
        }
    }
}