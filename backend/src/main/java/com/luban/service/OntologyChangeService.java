package com.luban.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.Concept;
import com.luban.entity.ConceptJoinMapping;
import com.luban.entity.ConceptMapping;
import com.luban.entity.ConceptRelation;
import com.luban.entity.IndustryRelation;
import com.luban.entity.OntologyChangeLog;
import com.luban.entity.OntologyGroup;
import com.luban.repository.ConceptJoinMappingRepository;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptRelationRepository;
import com.luban.repository.ConceptRepository;
import com.luban.repository.IndustryRelationRepository;
import com.luban.repository.OntologyChangeLogRepository;
import com.luban.repository.OntologyGroupRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

@Slf4j
@Service
public class OntologyChangeService {

    private final OntologyChangeLogRepository changeLogRepository;
    private final ConceptRepository conceptRepository;
    private final ConceptMappingRepository conceptMappingRepository;
    private final ConceptJoinMappingRepository conceptJoinMappingRepository;
    private final ConceptRelationRepository conceptRelationRepository;
    private final IndustryRelationRepository industryRelationRepository;
    private final OntologyGroupRepository ontologyGroupRepository;
    private final OntologyService ontologyService;
    private final ObjectMapper objectMapper;

    public OntologyChangeService(OntologyChangeLogRepository changeLogRepository,
                                  ConceptRepository conceptRepository,
                                  ConceptMappingRepository conceptMappingRepository,
                                  ConceptJoinMappingRepository conceptJoinMappingRepository,
                                  ConceptRelationRepository conceptRelationRepository,
                                  IndustryRelationRepository industryRelationRepository,
                                  OntologyGroupRepository ontologyGroupRepository,
                                  OntologyService ontologyService,
                                  ObjectMapper objectMapper) {
        this.changeLogRepository = changeLogRepository;
        this.conceptRepository = conceptRepository;
        this.conceptMappingRepository = conceptMappingRepository;
        this.conceptJoinMappingRepository = conceptJoinMappingRepository;
        this.conceptRelationRepository = conceptRelationRepository;
        this.industryRelationRepository = industryRelationRepository;
        this.ontologyGroupRepository = ontologyGroupRepository;
        this.ontologyService = ontologyService;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public OntologyChangeLog recordChange(String sessionId, String operation, String entityType,
                                          Long entityId, String beforeSnapshot, String afterSnapshot,
                                          Long operatorId, String operatorName, String triggerType,
                                          String reasoning) {
        OntologyChangeLog log = new OntologyChangeLog();
        log.setSessionId(sessionId);
        log.setChangeId(UUID.randomUUID().toString());
        log.setOperation(operation);
        log.setEntityType(entityType);
        log.setEntityId(entityId);
        log.setBeforeSnapshot(beforeSnapshot);
        log.setAfterSnapshot(afterSnapshot);
        log.setStatus("PENDING");
        log.setOperatorId(operatorId);
        log.setOperatorName(operatorName);
        log.setTriggerType(triggerType);
        log.setReasoning(reasoning);
        return changeLogRepository.save(log);
    }

    @Transactional
    public void approveChange(Long changeId) {
        OntologyChangeLog changeLog = changeLogRepository.findById(changeId)
                .orElseThrow(() -> new NoSuchElementException("变更记录不存在: " + changeId));
        try {
            executeChange(changeLog);
            changeLog.setStatus("APPROVED");
            changeLog.setExecutedAt(LocalDateTime.now());
            changeLogRepository.save(changeLog);
            log.info("Ontology change {} ({}) executed and approved", changeId, changeLog.getOperation());
        } catch (Exception e) {
            log.error("Failed to execute ontology change {}: {}", changeId, e.getMessage(), e);
            throw new RuntimeException("变更执行失败: " + e.getMessage(), e);
        }
    }

    @Transactional
    public void rejectChange(Long changeId) {
        changeLogRepository.deleteById(changeId);
    }

    @Transactional
    public void batchApproveChanges(List<Long> changeIds) {
        List<OntologyChangeLog> logs = changeLogRepository.findAllById(changeIds);
        for (OntologyChangeLog log : logs) {
            executeChange(log);
            log.setStatus("APPROVED");
            log.setExecutedAt(LocalDateTime.now());
        }
        changeLogRepository.saveAll(logs);
        ontologyService.reload();
    }

    @Transactional
    public void batchRejectChanges(List<Long> changeIds) {
        changeLogRepository.deleteAllById(changeIds);
    }

    public List<OntologyChangeLog> getSessionChanges(String sessionId) {
        return changeLogRepository.findBySessionIdOrderByCreatedAt(sessionId);
    }

    public List<OntologyChangeLog> getPendingChanges(String sessionId) {
        return changeLogRepository.findBySessionIdAndStatus(sessionId, "PENDING");
    }

    public List<OntologyChangeLog> getAllPendingChanges() {
        return changeLogRepository.findByStatusOrderByCreatedAt("PENDING");
    }

    private void executeChange(OntologyChangeLog log) {
        String operation = log.getOperation();
        Map<String, Object> data = parseSnapshot(log.getAfterSnapshot());
        if (data == null) {
            throw new RuntimeException("无法解析变更快照");
        }
        switch (operation) {
            case "ADD_CONCEPT" -> executeAddConcept(data);
            case "UPDATE_CONCEPT" -> executeUpdateConcept(data);
            case "DELETE_CONCEPT" -> executeDeleteConcept(data);
            case "ADD_RELATION" -> executeAddRelation(data);
            case "DELETE_RELATION" -> executeDeleteRelation(data);
            case "ADD_MAPPING" -> executeAddMapping(data);
            case "UPDATE_MAPPING" -> executeUpdateMapping(data);
            case "DELETE_MAPPING" -> executeDeleteMapping(data);
            case "ADD_JOIN_MAPPING" -> executeAddJoinMapping(data);
            case "UPDATE_JOIN_MAPPING" -> executeUpdateJoinMapping(data);
            case "DELETE_JOIN_MAPPING" -> executeDeleteJoinMapping(data);
            default -> throw new RuntimeException("不支持的操作类型: " + operation);
        }
        ontologyService.reload();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseSnapshot(String snapshot) {
        if (snapshot == null || snapshot.isEmpty()) return null;
        try {
            return objectMapper.readValue(snapshot, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            log.warn("Failed to parse snapshot JSON: {}", e.getMessage());
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    private void executeAddConcept(Map<String, Object> data) {
        Map<String, Object> conceptData = (Map<String, Object>) data.get("concept");
        if (conceptData == null) {
            throw new RuntimeException("ADD_CONCEPT 缺少 concept 数据");
        }
        String name = (String) conceptData.get("name");
        String description = (String) conceptData.get("description");
        Object industryIdObj = conceptData.get("industryId");

        if (name == null || name.isEmpty()) {
            throw new RuntimeException("概念名称为空");
        }

        Concept concept = new Concept();
        concept.setName(name);
        concept.setDescription(description);

        if (industryIdObj instanceof Number) {
            Long industryId = ((Number) industryIdObj).longValue();
            List<OntologyGroup> groups = ontologyGroupRepository.findByIndustryId(industryId);
            if (!groups.isEmpty()) {
                concept.setGroupId(groups.get(0).getId());
            }
        }

        // 如果有 parentConceptName，查找父概念
        Object parentName = conceptData.get("parentConceptName");
        if (parentName instanceof String && !((String) parentName).isEmpty()) {
            List<Concept> parents = conceptRepository.findByName((String) parentName);
            if (!parents.isEmpty()) {
                concept.setParentId(parents.get(0).getId());
            }
        }

        Concept saved = conceptRepository.save(concept);
        log.info("ADD_CONCEPT executed: id={}, name={}", saved.getId(), saved.getName());
    }

    @SuppressWarnings("unchecked")
    private void executeUpdateConcept(Map<String, Object> data) {
        Map<String, Object> conceptData = (Map<String, Object>) data.get("concept");
        if (conceptData == null) {
            throw new RuntimeException("UPDATE_CONCEPT 缺少 concept 数据");
        }
        String name = (String) conceptData.get("name");
        if (name == null || name.isEmpty()) {
            throw new RuntimeException("概念名称为空");
        }
        List<Concept> concepts = conceptRepository.findByName(name);
        if (concepts.isEmpty()) {
            throw new RuntimeException("概念不存在: " + name);
        }
        Concept concept = concepts.get(0);
        if (conceptData.containsKey("description")) {
            concept.setDescription((String) conceptData.get("description"));
        }
        concept.setUpdatedAt(LocalDateTime.now());
        conceptRepository.save(concept);
        log.info("UPDATE_CONCEPT executed: id={}, name={}", concept.getId(), concept.getName());
    }

    private void executeDeleteConcept(Map<String, Object> data) {
        Object conceptIdObj = data.get("conceptId");
        String conceptName = (String) data.get("conceptName");
        if (conceptIdObj instanceof Number) {
            conceptRepository.deleteById(((Number) conceptIdObj).longValue());
            log.info("DELETE_CONCEPT executed: id={}", conceptIdObj);
        } else if (conceptName != null && !conceptName.isEmpty()) {
            List<Concept> concepts = conceptRepository.findByName(conceptName);
            if (!concepts.isEmpty()) {
                conceptRepository.delete(concepts.get(0));
                log.info("DELETE_CONCEPT executed: name={}", conceptName);
            }
        }
    }

    @SuppressWarnings("unchecked")
    private void executeAddRelation(Map<String, Object> data) {
        Map<String, Object> relationData = (Map<String, Object>) data.get("relation");
        if (relationData == null) {
            throw new RuntimeException("ADD_RELATION 缺少 relation 数据");
        }
        String sourceName = (String) relationData.get("sourceConceptName");
        String targetName = (String) relationData.get("targetConceptName");
        String relationType = (String) relationData.get("relationType");
        String description = (String) relationData.get("description");

        if (sourceName == null || targetName == null || relationType == null) {
            throw new RuntimeException("ADD_RELATION 缺少必填字段");
        }

        List<Concept> sources = conceptRepository.findByName(sourceName);
        List<Concept> targets = conceptRepository.findByName(targetName);
        if (sources.isEmpty()) throw new RuntimeException("源概念不存在: " + sourceName);
        if (targets.isEmpty()) throw new RuntimeException("目标概念不存在: " + targetName);

        Long sourceId = sources.get(0).getId();
        Long targetId = targets.get(0).getId();

        // 确保关系类型在行业中注册，不存在则自动创建
        ensureRelationTypeRegistered(sourceId, relationType, description);

        ConceptRelation relation = new ConceptRelation();
        relation.setSourceConceptId(sourceId);
        relation.setTargetConceptId(targetId);
        relation.setRelationType(relationType);
        relation.setDescription(description);
        conceptRelationRepository.save(relation);
        log.info("ADD_RELATION executed: {} -[{}]-> {}", sourceName, relationType, targetName);
    }

    private void ensureRelationTypeRegistered(Long conceptId, String relationType, String description) {
        Concept concept = conceptRepository.findById(conceptId)
                .orElseThrow(() -> new RuntimeException("概念不存在: " + conceptId));
        Long industryId = null;
        if (concept.getGroupId() != null) {
            OntologyGroup group = ontologyGroupRepository.findById(concept.getGroupId()).orElse(null);
            if (group != null) {
                industryId = group.getIndustryId();
            }
        }
        if (industryId == null) return;

        boolean exists = industryRelationRepository
                .findByIndustryIdAndRelationType(industryId, relationType).isPresent();
        if (!exists) {
            IndustryRelation ir = new IndustryRelation();
            ir.setIndustryId(industryId);
            ir.setRelationType(relationType);
            ir.setDescription(description != null ? description : "LLM自动生成的关系类型");
            ir.setIsBuiltin(false);
            ir.setIsTransitive(false);
            ir.setIsSymmetric(false);
            List<IndustryRelation> existing = industryRelationRepository.findByIndustryIdOrderBySortOrder(industryId);
            ir.setSortOrder(existing.size());
            industryRelationRepository.save(ir);
            log.info("Auto-registered relation type '{}' for industry {}", relationType, industryId);
        }
    }

    private void executeDeleteRelation(Map<String, Object> data) {
        Object relationIdObj = data.get("relationId");
        if (relationIdObj instanceof Number) {
            conceptRelationRepository.deleteById(((Number) relationIdObj).longValue());
            log.info("DELETE_RELATION executed: id={}", relationIdObj);
        }
    }

    @SuppressWarnings("unchecked")
    private void executeAddMapping(Map<String, Object> data) {
        Map<String, Object> mappingData = (Map<String, Object>) data.get("mapping");
        if (mappingData == null) {
            throw new RuntimeException("ADD_MAPPING 缺少 mapping 数据");
        }
        String conceptName = (String) mappingData.get("conceptName");
        String tableName = (String) mappingData.get("tableName");
        String columnName = (String) mappingData.get("columnName");
        String mappingType = (String) mappingData.getOrDefault("mappingType", "direct");

        if (conceptName == null || tableName == null || columnName == null) {
            throw new RuntimeException("ADD_MAPPING 缺少必填字段");
        }

        List<Concept> concepts = conceptRepository.findByName(conceptName);
        if (concepts.isEmpty()) throw new RuntimeException("概念不存在: " + conceptName);

        ConceptMapping mapping = new ConceptMapping();
        mapping.setConceptId(concepts.get(0).getId());
        mapping.setTableName(tableName);
        mapping.setColumnName(columnName);
        mapping.setMappingType(mappingType);
        mapping.setIsAuto(false);
        if (mappingData.get("dataSourceId") instanceof Number dsId) {
            mapping.setDatasourceId(dsId.longValue());
        } else {
            throw new RuntimeException("ADD_MAPPING 缺少 dataSourceId 字段，请确保在生成本体变更前先选择数据源");
        }
        conceptMappingRepository.save(mapping);
        log.info("ADD_MAPPING executed: {} -> {}.{}", conceptName, tableName, columnName);
    }

    @SuppressWarnings("unchecked")
    private void executeUpdateMapping(Map<String, Object> data) {
        Map<String, Object> mappingData = (Map<String, Object>) data.get("mapping");
        if (mappingData == null) return;
        Object mappingIdObj = mappingData.get("mappingId");
        if (!(mappingIdObj instanceof Number)) return;
        Long mappingId = ((Number) mappingIdObj).longValue();
        ConceptMapping mapping = conceptMappingRepository.findById(mappingId)
                .orElseThrow(() -> new RuntimeException("映射不存在: " + mappingId));
        if (mappingData.containsKey("tableName")) mapping.setTableName((String) mappingData.get("tableName"));
        if (mappingData.containsKey("columnName")) mapping.setColumnName((String) mappingData.get("columnName"));
        if (mappingData.containsKey("mappingType")) mapping.setMappingType((String) mappingData.get("mappingType"));
        if (mappingData.get("dataSourceId") instanceof Number dsId) {
            mapping.setDatasourceId(dsId.longValue());
        }
        conceptMappingRepository.save(mapping);
        log.info("UPDATE_MAPPING executed: id={}", mappingId);
    }

    private void executeDeleteMapping(Map<String, Object> data) {
        Object mappingIdObj = data.get("mappingId");
        if (mappingIdObj instanceof Number) {
            conceptMappingRepository.deleteById(((Number) mappingIdObj).longValue());
            log.info("DELETE_MAPPING executed: id={}", mappingIdObj);
        }
    }

    @SuppressWarnings("unchecked")
    private void executeAddJoinMapping(Map<String, Object> data) {
        Map<String, Object> joinData = (Map<String, Object>) data.get("joinMapping");
        if (joinData == null) {
            throw new RuntimeException("ADD_JOIN_MAPPING 缺少 joinMapping 数据");
        }

        String conceptName = (String) joinData.get("conceptName");
        String joinTable = (String) joinData.get("joinTable");
        String joinCondition = (String) joinData.get("joinCondition");
        String relationType = (String) joinData.get("relationType");
        String targetConcept = (String) joinData.get("targetConcept");

        String leftTable = (String) joinData.get("leftTable");
        String rightTable = (String) joinData.get("rightTable");
        String leftColumn = (String) joinData.get("leftColumn");
        String rightColumn = (String) joinData.get("rightColumn");
        String joinType = (String) joinData.get("joinType");

        if (leftTable != null && rightTable != null && leftColumn != null && rightColumn != null) {
            if (joinTable == null) joinTable = rightTable;
            if (joinCondition == null) joinCondition = leftTable + "." + leftColumn + " = " + rightTable + "." + rightColumn;
            if (relationType == null && joinType != null) relationType = joinType + " JOIN";
            if (conceptName == null) {
                List<com.luban.entity.ConceptMapping> mappings = conceptMappingRepository.findByTableNameIn(List.of(leftTable));
                if (!mappings.isEmpty()) {
                    Long cid = mappings.get(0).getConceptId();
                    var c = conceptRepository.findById(cid).orElse(null);
                    if (c != null) conceptName = c.getName();
                }
            }
        }

        if (conceptName == null || joinTable == null || joinCondition == null) {
            throw new RuntimeException("ADD_JOIN_MAPPING 缺少必填字段");
        }

        List<Concept> concepts = conceptRepository.findByName(conceptName);
        if (concepts.isEmpty()) throw new RuntimeException("概念不存在: " + conceptName);

        ConceptJoinMapping join = new ConceptJoinMapping();
        join.setConceptId(concepts.get(0).getId());
        join.setJoinTable(joinTable);
        join.setJoinCondition(joinCondition);
        join.setRelationType(relationType != null ? relationType : "LEFT JOIN");
        join.setJoinType("LEFT");
        if (targetConcept != null) join.setTargetConcept(targetConcept);
        conceptJoinMappingRepository.save(join);
        log.info("ADD_JOIN_MAPPING executed: {} JOIN {} ON {}", conceptName, joinTable, joinCondition);
    }

    @SuppressWarnings("unchecked")
    private void executeUpdateJoinMapping(Map<String, Object> data) {
        Map<String, Object> joinData = (Map<String, Object>) data.get("joinMapping");
        if (joinData == null) return;
        Object joinIdObj = joinData.get("joinMappingId");
        if (!(joinIdObj instanceof Number)) return;
        Long joinId = ((Number) joinIdObj).longValue();
        ConceptJoinMapping join = conceptJoinMappingRepository.findById(joinId)
                .orElseThrow(() -> new RuntimeException("JOIN映射不存在: " + joinId));
        if (joinData.containsKey("joinTable")) join.setJoinTable((String) joinData.get("joinTable"));
        if (joinData.containsKey("joinCondition")) join.setJoinCondition((String) joinData.get("joinCondition"));
        if (joinData.containsKey("relationType")) join.setRelationType((String) joinData.get("relationType"));
        conceptJoinMappingRepository.save(join);
        log.info("UPDATE_JOIN_MAPPING executed: id={}", joinId);
    }

    private void executeDeleteJoinMapping(Map<String, Object> data) {
        Object joinIdObj = data.get("joinMappingId");
        if (joinIdObj instanceof Number) {
            conceptJoinMappingRepository.deleteById(((Number) joinIdObj).longValue());
            log.info("DELETE_JOIN_MAPPING executed: id={}", joinIdObj);
        }
    }
}