package com.luban.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class CreateRelationRequest {
    @NotNull
    private Long targetConceptId;
    @NotBlank
    private String relationType;
    private String expression;
    private String description;
}