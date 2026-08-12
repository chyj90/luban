package com.luban.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;
import java.util.Map;

@Data
public class CreateQueryRequest {
    @NotNull
    private Long applicationId;

    @NotNull
    private Long datasourceId;

    @NotBlank
    private String name;

    private String body;
    private Map<String, Object> params;
}