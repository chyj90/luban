package com.luban.dto;

import com.luban.constant.BindingType;
import com.luban.entity.Concept;
import com.luban.entity.ConceptRelation;
import com.luban.entity.ConceptToolBinding;
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
        private BindingType bindingType;
        private Boolean isDefault;
    }

    public static ConceptDetailResponse from(Concept concept,
                                              List<ConceptRelation> relations,
                                              List<ConceptToolBinding> toolBindings,
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

        for (ConceptToolBinding ctb : toolBindings) {
            ToolBindingInfo tbi = new ToolBindingInfo();
            tbi.setId(ctb.getId());
            tbi.setToolId(ctb.getToolId());
            tbi.setToolName(toolNameMap.getOrDefault(ctb.getToolId(), "ID:" + ctb.getToolId()));
            tbi.setBindingType(ctb.getBindingType());
            tbi.setIsDefault(ctb.getIsDefault());
            resp.getToolBindings().add(tbi);
        }

        return resp;
    }
}