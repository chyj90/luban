package com.luban.service;

import com.luban.dto.*;
import com.luban.entity.Concept;
import com.luban.entity.ConceptRelation;
import com.luban.entity.ToolConcept;
import com.luban.entity.ToolDefinition;
import com.luban.repository.ConceptRelationRepository;
import com.luban.repository.ConceptRepository;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptJoinMappingRepository;
import com.luban.repository.ConceptEmbeddingTaskRepository;
import com.luban.repository.ToolConceptRepository;
import com.luban.repository.ToolDefinitionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class ConceptService {

    private final ConceptRepository conceptRepository;
    private final ConceptRelationRepository conceptRelationRepository;
    private final ConceptMappingRepository conceptMappingRepository;
    private final ConceptJoinMappingRepository conceptJoinMappingRepository;
    private final ConceptEmbeddingTaskRepository conceptEmbeddingTaskRepository;
    private final ToolConceptRepository toolConceptRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final OntologyService ontologyService;

    @Transactional(readOnly = true)
    public List<Concept> list(Long groupId, String keyword) {
        List<Concept> concepts;
        if (groupId != null) {
            concepts = conceptRepository.findByGroupId(groupId);
        } else {
            concepts = conceptRepository.findAll();
        }

        if (keyword != null && !keyword.isBlank()) {
            concepts = concepts.stream()
                    .filter(c -> c.getName().contains(keyword))
                    .toList();
        }

        // 填充映射状态
        Set<Long> mappedConceptIds = new HashSet<>(conceptMappingRepository.findDistinctConceptIds());
        for (Concept c : concepts) {
            c.setMapped(mappedConceptIds.contains(c.getId()));
        }

        return concepts;
    }

    @Transactional(readOnly = true)
    public List<Concept> findByIds(List<Long> ids) {
        List<Concept> concepts = conceptRepository.findByIdIn(ids);
        Set<Long> mappedConceptIds = new HashSet<>(conceptMappingRepository.findDistinctConceptIds());
        for (Concept c : concepts) {
            c.setMapped(mappedConceptIds.contains(c.getId()));
        }
        return concepts;
    }

    @Transactional(readOnly = true)
    public Concept getConceptById(Long id) {
        return conceptRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("Concept not found: " + id));
    }

    @Transactional(readOnly = true)
    public ConceptDetailResponse getById(Long id) {
        Concept concept = conceptRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("Concept not found: " + id));

        List<ConceptRelation> relations = new ArrayList<>();
        relations.addAll(conceptRelationRepository.findBySourceConceptId(id));
        relations.addAll(conceptRelationRepository.findByTargetConceptId(id));

        List<ToolConcept> toolBindings = toolConceptRepository.findByConceptId(id);

        Map<Long, Concept> conceptMap = conceptRepository.findAll().stream()
                .collect(Collectors.toMap(Concept::getId, c -> c));

        Map<Long, String> toolNameMap = new HashMap<>();
        for (ToolConcept tc : toolBindings) {
            toolDefinitionRepository.findById(tc.getToolId()).ifPresent(t -> toolNameMap.put(tc.getToolId(), t.getDisplayName()));
        }

        return ConceptDetailResponse.from(concept, relations, toolBindings, conceptMap, toolNameMap);
    }

    @Transactional
    public Concept create(CreateConceptRequest request) {
        Concept concept = new Concept();
        concept.setName(request.getName());
        concept.setParentId(request.getParentId());
        concept.setGroupId(request.getGroupId());
        concept.setDescription(request.getDescription());
        concept.setAnomalyThresholdExpr(request.getAnomalyThresholdExpr());
        concept.setAnomalyThresholdDesc(request.getAnomalyThresholdDesc());
        Concept saved = conceptRepository.save(concept);
        ontologyService.reload();
        return saved;
    }

    @Transactional
    public Concept update(Long id, CreateConceptRequest request) {
        Concept concept = conceptRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("Concept not found: " + id));
        concept.setName(request.getName());
        concept.setParentId(request.getParentId());
        concept.setGroupId(request.getGroupId());
        concept.setDescription(request.getDescription());
        concept.setAnomalyThresholdExpr(request.getAnomalyThresholdExpr());
        concept.setAnomalyThresholdDesc(request.getAnomalyThresholdDesc());
        concept.setUpdatedAt(java.time.LocalDateTime.now());
        Concept saved = conceptRepository.save(concept);
        ontologyService.reload();
        return saved;
    }

    @Transactional
    public void delete(Long id) {
        deleteCore(Collections.singletonList(id));
        ontologyService.reload();
    }

    @Transactional
    public void deleteBatch(List<Long> ids) {
        if (ids == null || ids.isEmpty()) return;
        deleteCore(ids);
        ontologyService.reload();
    }

    private void deleteCore(List<Long> ids) {
        conceptMappingRepository.deleteByConceptIdIn(ids);
        conceptJoinMappingRepository.deleteByConceptIdIn(ids);
        conceptEmbeddingTaskRepository.deleteByConceptIdIn(ids);

        List<ConceptRelation> relations = conceptRelationRepository.findBySourceConceptIdIn(ids);
        relations.addAll(conceptRelationRepository.findByTargetConceptIdIn(ids));
        if (!relations.isEmpty()) {
            conceptRelationRepository.deleteAll(relations);
        }

        List<ToolConcept> bindings = toolConceptRepository.findByConceptIdIn(ids);
        if (!bindings.isEmpty()) {
            toolConceptRepository.deleteAll(bindings);
        }

        conceptRepository.deleteAllById(ids);
    }

    @Transactional(readOnly = true)
    public List<ConceptTreeResponse> getTree(Long groupId) {
        List<Concept> concepts;
        if (groupId != null) {
            concepts = conceptRepository.findByGroupId(groupId);
        } else {
            concepts = conceptRepository.findAll();
        }

        List<ConceptRelation> allRelations = conceptRelationRepository.findAll();
        Map<Long, List<ConceptRelation>> relationMap = new HashMap<>();
        for (ConceptRelation r : allRelations) {
            relationMap.computeIfAbsent(r.getSourceConceptId(), k -> new ArrayList<>()).add(r);
        }

        Map<Long, Concept> conceptMap = concepts.stream()
                .collect(Collectors.toMap(Concept::getId, c -> c));

        Map<Long, List<Concept>> childrenMap = new HashMap<>();
        List<Concept> roots = new ArrayList<>();
        for (Concept c : concepts) {
            if (c.getParentId() == null || !conceptMap.containsKey(c.getParentId())) {
                roots.add(c);
            } else {
                childrenMap.computeIfAbsent(c.getParentId(), k -> new ArrayList<>()).add(c);
            }
        }

        return roots.stream()
                .map(root -> buildTree(root, childrenMap, relationMap, conceptMap))
                .collect(Collectors.toList());
    }

    private ConceptTreeResponse buildTree(Concept concept,
                                           Map<Long, List<Concept>> childrenMap,
                                           Map<Long, List<ConceptRelation>> relationMap,
                                           Map<Long, Concept> conceptMap) {
        ConceptTreeResponse node = new ConceptTreeResponse();
        node.setId(concept.getId());
        node.setName(concept.getName());
        node.setParentId(concept.getParentId());
        node.setGroupId(concept.getGroupId());
        node.setDescription(concept.getDescription());

        List<ConceptRelation> sourceRelations = relationMap.getOrDefault(concept.getId(), Collections.emptyList());
        for (ConceptRelation r : sourceRelations) {
            ConceptTreeResponse.RelationInfo ri = new ConceptTreeResponse.RelationInfo();
            ri.setId(r.getId());
            ri.setRelationType(r.getRelationType());
            ri.setTargetConceptId(r.getTargetConceptId());
            Concept target = conceptMap.get(r.getTargetConceptId());
            ri.setTargetConceptName(target != null ? target.getName() : null);
            ri.setExpression(r.getExpression());
            ri.setDescription(r.getDescription());
            node.getRelations().add(ri);
        }

        List<Concept> children = childrenMap.getOrDefault(concept.getId(), Collections.emptyList());
        for (Concept child : children) {
            node.getChildren().add(buildTree(child, childrenMap, relationMap, conceptMap));
        }

        return node;
    }

    @Transactional(readOnly = true)
    public List<ConceptRelation> getRelations(Long conceptId) {
        List<ConceptRelation> all = new ArrayList<>();
        all.addAll(conceptRelationRepository.findBySourceConceptId(conceptId));
        all.addAll(conceptRelationRepository.findByTargetConceptId(conceptId));
        return all;
    }

    @Transactional(readOnly = true)
    public List<ConceptRelation> listAllRelations(Long groupId) {
        if (groupId != null) {
            List<Concept> concepts = conceptRepository.findByGroupId(groupId);
            List<Long> conceptIds = concepts.stream().map(Concept::getId).toList();
            return conceptRelationRepository.findAll().stream()
                    .filter(r -> conceptIds.contains(r.getSourceConceptId()) || conceptIds.contains(r.getTargetConceptId()))
                    .toList();
        }
        return conceptRelationRepository.findAll();
    }

    @Transactional
    public ConceptRelation createRelation(Long sourceConceptId, CreateRelationRequest request) {
        ConceptRelation relation = new ConceptRelation();
        relation.setSourceConceptId(sourceConceptId);
        relation.setTargetConceptId(request.getTargetConceptId());
        relation.setRelationType(request.getRelationType());
        relation.setExpression(request.getExpression());
        relation.setDescription(request.getDescription());
        ConceptRelation saved = conceptRelationRepository.save(relation);
        ontologyService.reload();
        return saved;
    }

    @Transactional
    public ConceptRelation updateRelation(Long relationId, CreateRelationRequest request) {
        ConceptRelation relation = conceptRelationRepository.findById(relationId)
                .orElseThrow(() -> new NoSuchElementException("Relation not found: " + relationId));
        relation.setTargetConceptId(request.getTargetConceptId());
        relation.setRelationType(request.getRelationType());
        relation.setExpression(request.getExpression());
        relation.setDescription(request.getDescription());
        ConceptRelation saved = conceptRelationRepository.save(relation);
        ontologyService.reload();
        return saved;
    }

    @Transactional
    public void deleteRelation(Long relationId) {
        conceptRelationRepository.deleteById(relationId);
        ontologyService.reload();
    }

    @Transactional(readOnly = true)
    public List<ToolConcept> getToolConcepts(Long toolId) {
        return toolConceptRepository.findByToolId(toolId);
    }

    @Transactional
    public ToolConcept bindToolConcept(Long toolId, CreateToolConceptRequest request) {
        ToolConcept binding = new ToolConcept();
        binding.setToolId(toolId);
        binding.setConceptId(request.getConceptId());
        binding.setRelation(request.getRelation());
        ToolConcept saved = toolConceptRepository.save(binding);
        ontologyService.reload();
        return saved;
    }

    @Transactional
    public void unbindToolConcept(Long bindId) {
        toolConceptRepository.deleteById(bindId);
        ontologyService.reload();
    }

    @Transactional(readOnly = true)
    public List<ToolConcept> getConceptTools(Long conceptId) {
        return toolConceptRepository.findByConceptId(conceptId);
    }
}