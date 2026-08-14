package com.luban.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class CreateAppRequest {
    @NotBlank @Size(max = 30)
    private String name;
}