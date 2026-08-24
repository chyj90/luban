package com.luban.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class AgentConfigTestRequest {
    @NotBlank
    private String modelEndpoint;
    @NotBlank
    private String secretKey;
}