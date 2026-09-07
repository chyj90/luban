package com.luban.dto;

import com.luban.constant.BindingType;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class CreateToolConceptBindingRequest {
    @NotNull
    private Long conceptId;
    @NotNull
    private BindingType bindingType;
    private Boolean isDefault;
    private String config;
}