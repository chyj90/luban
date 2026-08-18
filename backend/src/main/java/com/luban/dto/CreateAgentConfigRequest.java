package com.luban.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class CreateAgentConfigRequest {
    @NotBlank
    private String name;
    @NotBlank
    private String modelEndpoint;
    @NotBlank
    private String modelName;
    @NotBlank
    private String secretKey;
    private Boolean isDefault;
}