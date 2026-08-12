package com.luban.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;
import java.util.List;

@Data
public class CreateCodePageRequest {
    @NotNull
    private Long applicationId;

    @NotBlank @Size(max = 30)
    private String name;

    private String html;
    private String css;
    private String js;
    private List<String> libraries;
    private List<Long> queryIds;
}