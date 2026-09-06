package com.luban.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class CreateToolConceptBindingRequest {
    @NotNull
    private Long conceptId;
    @NotBlank
    private String bindingType;
    private Boolean isDefault;
    private String config;
}