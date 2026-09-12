package com.luban.constant;

/**
 * 概念语义角色。空值表示未分类（兼容存量概念）。
 */
public enum ConceptType {
    DIMENSION("维度，用于分组、筛选、下钻的视角"),
    METRIC("指标，可聚合度量的数值，优先使用其 default_aggregation"),
    ENTITY("实体，业务对象本身（如设备、产线），通常作为主表或关联主键");

    private final String description;

    ConceptType(String description) {
        this.description = description;
    }

    public String description() {
        return description;
    }

    public static String toPromptList() {
        StringBuilder sb = new StringBuilder();
        for (ConceptType t : values()) {
            sb.append("  - ").append(t.name()).append(": ").append(t.description()).append("\n");
        }
        return sb.toString();
    }

    /** 容错解析：未知/空值返回 null（未分类），不抛异常 */
    public static ConceptType fromNullable(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return valueOf(value.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
