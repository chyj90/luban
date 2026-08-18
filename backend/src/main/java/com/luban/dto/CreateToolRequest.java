package com.luban.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class CreateToolRequest {
    @NotBlank
    private String name;
    private String displayName;
    @NotBlank
    private String description;
    @NotBlank
    private String toolType;
    @NotBlank
    private Long groupId;
    private String inputSchema;
    private String outputSchema;
    @NotBlank
    private String config;
}