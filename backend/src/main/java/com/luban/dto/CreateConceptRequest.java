package com.luban.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class CreateConceptRequest {
    @NotBlank
    private String name;
    private Long groupId;
    private String description;
    private String anomalyThresholdExpr;
    private String anomalyThresholdDesc;
    /** 语义角色：DIMENSION/METRIC/ENTITY，可空=未分类 */
    private String conceptType;
    /** 指标默认聚合：SUM/COUNT/AVG/MAX/MIN/NONE，仅 METRIC 有意义 */
    private String defaultAggregation;
    /** 指标单位（元、%、件…） */
    private String unit;
    /** 指标时间戳列（如 stat_date） */
    private String timestampColumn;
}
