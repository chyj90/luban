package com.luban.dto;

import lombok.Data;
import java.util.List;
import java.util.Map;

@Data
public class ConceptImportRequest {
    private String sourceType;
    private String content;
    private String url;
    private Long industryId;
    private Long groupId;
    private List<Map<String, Object>> selectedItems;
}