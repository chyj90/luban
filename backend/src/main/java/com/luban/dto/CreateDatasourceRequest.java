package com.luban.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;
import java.util.Map;

@Data
public class CreateDatasourceRequest {
    @NotNull
    private Long applicationId;

    @NotBlank
    private String name;

    @NotBlank
    private String type;

    private Map<String, Object> config;
}