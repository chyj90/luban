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
}