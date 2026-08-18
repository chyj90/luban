package com.luban.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class CreateToolConceptRequest {
    @NotNull
    private Long conceptId;
    @NotBlank
    private String relation;
}