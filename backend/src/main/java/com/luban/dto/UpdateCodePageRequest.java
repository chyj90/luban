package com.luban.dto;

import lombok.Data;
import java.util.List;

@Data
public class UpdateCodePageRequest {
    private String html;
    private String css;
    private String js;
    private List<String> libraries;
    private List<Long> queryIds;
    private List<Long> toolIds;
}