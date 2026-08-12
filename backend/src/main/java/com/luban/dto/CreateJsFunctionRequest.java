package com.luban.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class CreateJsFunctionRequest {
    @NotNull
    private Long pageId;

    @NotBlank
    private String name;

    private String body;
}