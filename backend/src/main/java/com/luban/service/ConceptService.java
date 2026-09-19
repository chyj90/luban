package com.luban.service;

import com.luban.dto.*;
import com.luban.entity.Concept;
import com.luban.entity.ConceptRelation;
import com.luban.entity.OntologyGroup;
import com.luban.entity.ConceptToolBinding;
import com.luban.entity.ToolDefinition;
import com.luban.repository.ConceptRelationRepository;
import com.luban.repository.ConceptRepository;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptJoinMappingRepository;
import com.luban.repository.ConceptEmbeddingTaskRepository;
import com.luban.repository.RelationTypeRepository;
import com.luban.repository.OntologyGroupRepository;
import com.luban.repository.ConceptToolBindingRepository;
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
    private final RelationTypeRepository relationTypeRepository;
    private final OntologyGroupRepository ontologyGroupRepository;
    private final ConceptToolBindingRepository conceptToolBindingRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final OntologyService ontologyService;
    private final ConceptEmbeddingService conceptEmbeddingService;

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
    public Optional<Concept> findById(Long id) {
        return conceptRepository.findById(id);
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

        List<ConceptToolBinding> toolBindings = conceptToolBindingRepository.findByConceptId(id);

        // 只加载关系两端涉及的概念，替代全表 findAll
        Set<Long> relatedIds = new HashSet<>();
        for (ConceptRelation r : relations) {
            relatedIds.add(r.getSourceConceptId());
            relatedIds.add(r.getTargetConceptId());
        }
        Map<Long, Concept> conceptMap = relatedIds.isEmpty() ? Map.of()
                : conceptRepository.findAllById(relatedIds).stream()
                        .collect(Collectors.toMap(Concept::getId, c -> c));

        Map<Long, String> toolNameMap = new HashMap<>();
        for (ConceptToolBinding ctb : toolBindings) {
            toolDefinitionRepository.findById(ctb.getToolId()).ifPresent(t -> toolNameMap.put(ctb.getToolId(), t.getDisplayName()));
        }

        return ConceptDetailResponse.from(concept, relations, toolBindings, conceptMap, toolNameMap);
    }

    @Transactional
    public Concept create(CreateConceptRequest request) {
        Concept concept = new Concept();
        concept.setName(request.getName());
        concept.setGroupId(request.getGroupId());
        concept.setDescription(request.getDescription());
        concept.setAnomalyThresholdExpr(request.getAnomalyThresholdExpr());
        concept.setAnomalyThresholdDesc(request.getAnomalyThresholdDesc());
        applySemanticFields(concept, request.getConceptType(), request.getDefaultAggregation(),
                request.getUnit(), request.getTimestampColumn());
        Concept saved = conceptRepository.save(concept);
        ontologyService.reloadAfterCommit();
        // 与导入/LLM 变更入口对齐：事务提交后自动生成向量并入 FAISS，避免"建完搜不到"
        conceptEmbeddingService.scheduleEmbeddingAfterCommit(List.of(saved.getId()), false);
        return saved;
    }

    @Transactional
    public Concept update(Long id, CreateConceptRequest request) {
        Concept concept = conceptRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("Concept not found: " + id));
        concept.setName(request.getName());
        concept.setGroupId(request.getGroupId());
        concept.setDescription(request.getDescription());
        concept.setAnomalyThresholdExpr(request.getAnomalyThresholdExpr());
        concept.setAnomalyThresholdDesc(request.getAnomalyThresholdDesc());
        applySemanticFields(concept, request.getConceptType(), request.getDefaultAggregation(),
                request.getUnit(), request.getTimestampColumn());
        concept.setUpdatedAt(java.time.LocalDateTime.now());
        Concept saved = conceptRepository.save(concept);
        ontologyService.reloadAfterCommit();
        // 名称/描述变了，旧向量已过期，强制重生成
        conceptEmbeddingService.scheduleEmbeddingAfterCommit(List.of(saved.getId()), true);
        return saved;
    }

    /**
     * 语义字段归一化：conceptType 只接受 DIMENSION/METRIC/ENTITY（未知值置空），
     * 聚合方式只接受 SUM/COUNT/AVG/MAX/MIN/NONE；非 METRIC 概念的指标元数据清空，
     * 避免维度/实体上挂着无意义的聚合配置。
     */
    private void applySemanticFields(Concept concept, String conceptType,
            String defaultAggregation, String unit, String timestampColumn) {
        com.luban.constant.ConceptType type = com.luban.constant.ConceptType.fromNullable(conceptType);
        concept.setConceptType(type != null ? type.name() : null);
        if (type == com.luban.constant.ConceptType.METRIC) {
            String agg = defaultAggregation != null ? defaultAggregation.trim().toUpperCase() : null;
            concept.setDefaultAggregation(Set.of("SUM", "COUNT", "AVG", "MAX", "MIN", "NONE").contains(agg) ? agg : null);
            concept.setUnit(unit);
            concept.setTimestampColumn(timestampColumn);
        } else {
            concept.setDefaultAggregation(null);
            concept.setUnit(null);
            concept.setTimestampColumn(null);
        }
    }

    @Transactional
    public void delete(Long id) {
        deleteCore(Collections.singletonList(id));
        conceptEmbeddingService.scheduleRebuildAfterCommit();
        ontologyService.reloadAfterCommit();
    }

    @Transactional
    public void deleteBatch(List<Long> ids) {
        if (ids == null || ids.isEmpty()) return;
        deleteCore(ids);
        conceptEmbeddingService.scheduleRebuildAfterCommit();
        ontologyService.reloadAfterCommit();
    }

    // 概念删除后的索引清理改为全量重建（scheduleRebuildAfterCommit）：
    // 多副本下增量 remove 只会落到单个 EB 实例，是索引发散的根源；
    // 索引以 MySQL 为唯一事实源，全量重建（IndexFlatIP 毫秒级）+ 定时对账兜底。

    private void deleteCore(List<Long> ids) {
        conceptMappingRepository.deleteByConceptIdIn(ids);
        conceptJoinMappingRepository.deleteByConceptIdIn(ids);
        conceptEmbeddingTaskRepository.deleteByConceptIdIn(ids);

        List<ConceptRelation> relations = conceptRelationRepository.findBySourceConceptIdIn(ids);
        relations.addAll(conceptRelationRepository.findByTargetConceptIdIn(ids));
        if (!relations.isEmpty()) {
            conceptRelationRepository.deleteAll(relations);
        }

        conceptToolBindingRepository.deleteByConceptIdIn(ids);

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

        Map<Long, Concept> conceptMap = concepts.stream()
                .collect(Collectors.toMap(Concept::getId, c -> c));

        List<ConceptRelation> allRelations = conceptRelationRepository.findAll();
        Map<Long, List<ConceptRelation>> relationMap = new HashMap<>();
        for (ConceptRelation r : allRelations) {
            relationMap.computeIfAbsent(r.getSourceConceptId(), k -> new ArrayList<>()).add(r);
        }

        Map<String, Boolean> sourceToTargetMap = loadSourceToTargetMap();

        Map<Long, Long> computedParentId = computeParentId(allRelations, sourceToTargetMap);

        Map<Long, List<Concept>> childrenMap = new HashMap<>();
        List<Concept> roots = new ArrayList<>();
        for (Concept c : concepts) {
            Long pid = computedParentId.get(c.getId());
            if (pid == null || !conceptMap.containsKey(pid)) {
                roots.add(c);
            } else {
                childrenMap.computeIfAbsent(pid, k -> new ArrayList<>()).add(c);
            }
        }

        return roots.stream()
                .map(root -> buildTree(root, childrenMap, relationMap, conceptMap))
                .collect(Collectors.toList());
    }

    private Map<String, Boolean> loadSourceToTargetMap() {
        Map<String, Boolean> map = new HashMap<>();
        try {
            List<com.luban.entity.RelationType> relationTypes = relationTypeRepository.findAll();
            for (com.luban.entity.RelationType rt : relationTypes) {
                map.putIfAbsent(rt.getRelationType(), rt.getSourceToTarget());
            }
        } catch (Exception e) {
            log.warn("Failed to load RelationType for parentId computation, using defaults", e);
        }
        return map;
    }

    private Map<Long, Long> computeParentId(List<ConceptRelation> allRelations, Map<String, Boolean> sourceToTargetMap) {
        Map<Long, Long> parentId = new HashMap<>();
        for (ConceptRelation r : allRelations) {
            Boolean sourceToTarget = sourceToTargetMap.get(r.getRelationType());
            if (sourceToTarget != null && sourceToTarget) {
                parentId.putIfAbsent(r.getTargetConceptId(), r.getSourceConceptId());
            }
        }
        return parentId;
    }

    private ConceptTreeResponse buildTree(Concept concept,
                                           Map<Long, List<Concept>> childrenMap,
                                           Map<Long, List<ConceptRelation>> relationMap,
                                           Map<Long, Concept> conceptMap) {
        ConceptTreeResponse node = new ConceptTreeResponse();
        node.setId(concept.getId());
        node.setName(concept.getName());
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
        validateRelationType(sourceConceptId, request.getRelationType());
        ConceptRelation relation = new ConceptRelation();
        relation.setSourceConceptId(sourceConceptId);
        relation.setTargetConceptId(request.getTargetConceptId());
        relation.setRelationType(request.getRelationType());
        relation.setExpression(request.getExpression());
        relation.setDescription(request.getDescription());
        ConceptRelation saved = conceptRelationRepository.save(relation);
        ontologyService.reloadAfterCommit();
        return saved;
    }

    @Transactional
    public ConceptRelation updateRelation(Long relationId, CreateRelationRequest request) {
        ConceptRelation relation = conceptRelationRepository.findById(relationId)
                .orElseThrow(() -> new NoSuchElementException("Relation not found: " + relationId));
        validateRelationType(relation.getSourceConceptId(), request.getRelationType());
        relation.setTargetConceptId(request.getTargetConceptId());
        relation.setRelationType(request.getRelationType());
        relation.setExpression(request.getExpression());
        relation.setDescription(request.getDescription());
        ConceptRelation saved = conceptRelationRepository.save(relation);
        ontologyService.reloadAfterCommit();
        return saved;
    }

    private void validateRelationType(Long conceptId, String relationType) {
        conceptRepository.findById(conceptId)
                .orElseThrow(() -> new NoSuchElementException("Concept not found: " + conceptId));
        boolean registered = relationTypeRepository.findByRelationType(relationType).isPresent();
        if (!registered) {
            throw new IllegalArgumentException(
                    "关系类型 '" + relationType + "' 未注册，请先在关系类型管理中注册");
        }
    }

    @Transactional
    public void deleteRelation(Long relationId) {
        conceptRelationRepository.deleteById(relationId);
        ontologyService.reloadAfterCommit();
    }

    @Transactional(readOnly = true)
    public List<ConceptToolBinding> getToolConcepts(Long toolId) {
        return conceptToolBindingRepository.findByToolId(toolId);
    }

    @Transactional
    public ConceptToolBinding bindToolConcept(Long toolId, CreateToolConceptBindingRequest request) {
        ConceptToolBinding binding = new ConceptToolBinding();
        binding.setToolId(toolId);
        binding.setConceptId(request.getConceptId());
        binding.setBindingType(request.getBindingType());
        binding.setIsDefault(request.getIsDefault() != null ? request.getIsDefault() : false);
        binding.setConfig(request.getConfig());
        ConceptToolBinding saved = conceptToolBindingRepository.save(binding);
        ontologyService.reloadAfterCommit();
        return saved;
    }

    @Transactional
    public void unbindToolConcept(Long bindId) {
        conceptToolBindingRepository.deleteById(bindId);
        ontologyService.reloadAfterCommit();
    }

    @Transactional(readOnly = true)
    public List<ConceptToolBinding> getConceptTools(Long conceptId) {
        return conceptToolBindingRepository.findByConceptId(conceptId);
    }
}