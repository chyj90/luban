package com.luban.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class ConceptTreeResponse {
    private Long id;
    private String name;
    private Long parentId;
    private Long groupId;
    private String description;
    private List<RelationInfo> relations = new ArrayList<>();
    private List<ConceptTreeResponse> children = new ArrayList<>();

    @Data
    public static class RelationInfo {
        private Long id;
        private String relationType;
        private Long targetConceptId;
        private String targetConceptName;
        private String expression;
        private String description;
    }
}