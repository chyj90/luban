package com.luban.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class CreateToolGroupRequest {
    @NotBlank
    private String name;
    @NotBlank
    private String code;
    private String description;
    private String systemPromptHint;
    private String icon;
    private String defaultConfig;
    private Integer sortOrder;
}