package com.luban.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class CreateAppRequest {
    @NotNull
    private Long workspaceId;

    @NotBlank @Size(max = 30)
    private String name;
}