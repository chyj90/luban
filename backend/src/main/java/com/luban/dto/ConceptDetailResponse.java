package com.luban.dto;

import com.luban.entity.Concept;
import com.luban.entity.ConceptRelation;
import com.luban.entity.ToolConcept;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class ConceptDetailResponse {
    private Long id;
    private String name;
    private Long groupId;
    private String description;
    private String createdAt;
    private String updatedAt;
    private List<RelationInfo> relations = new ArrayList<>();
    private List<ToolBindingInfo> toolBindings = new ArrayList<>();

    @Data
    public static class RelationInfo {
        private Long id;
        private String relationType;
        private Long sourceConceptId;
        private String sourceConceptName;
        private Long targetConceptId;
        private String targetConceptName;
        private String expression;
        private String description;
    }

    @Data
    public static class ToolBindingInfo {
        private Long id;
        private Long toolId;
        private String toolName;
        private String relation;
    }

    public static ConceptDetailResponse from(Concept concept,
                                              List<ConceptRelation> relations,
                                              List<ToolConcept> toolBindings,
                                              java.util.Map<Long, Concept> conceptMap,
                                              java.util.Map<Long, String> toolNameMap) {
        ConceptDetailResponse resp = new ConceptDetailResponse();
        resp.setId(concept.getId());
        resp.setName(concept.getName());
        resp.setGroupId(concept.getGroupId());
        resp.setDescription(concept.getDescription());
        resp.setCreatedAt(concept.getCreatedAt() != null ? concept.getCreatedAt().toString() : null);
        resp.setUpdatedAt(concept.getUpdatedAt() != null ? concept.getUpdatedAt().toString() : null);

        for (ConceptRelation r : relations) {
            RelationInfo ri = new RelationInfo();
            ri.setId(r.getId());
            ri.setRelationType(r.getRelationType());
            ri.setSourceConceptId(r.getSourceConceptId());
            ri.setTargetConceptId(r.getTargetConceptId());
            Concept sourceC = conceptMap.get(r.getSourceConceptId());
            Concept targetC = conceptMap.get(r.getTargetConceptId());
            ri.setSourceConceptName(sourceC != null ? sourceC.getName() : null);
            ri.setTargetConceptName(targetC != null ? targetC.getName() : null);
            ri.setExpression(r.getExpression());
            ri.setDescription(r.getDescription());
            resp.getRelations().add(ri);
        }

        for (ToolConcept tc : toolBindings) {
            ToolBindingInfo tbi = new ToolBindingInfo();
            tbi.setId(tc.getId());
            tbi.setToolId(tc.getToolId());
            tbi.setToolName(toolNameMap.getOrDefault(tc.getToolId(), "ID:" + tc.getToolId()));
            tbi.setRelation(tc.getRelation());
            resp.getToolBindings().add(tbi);
        }

        return resp;
    }
}