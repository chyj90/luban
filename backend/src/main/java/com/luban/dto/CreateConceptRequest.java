package com.luban.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class CreateConceptRequest {
    @NotBlank
    private String name;
    private Long parentId;
    private Long groupId;
    private String description;
}