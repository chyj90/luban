package com.luban.service;

import com.luban.entity.ConceptSnapshot;
import com.luban.entity.Concept;
import com.luban.entity.ConceptRelation;
import com.luban.entity.ConceptMapping;
import com.luban.entity.ConceptJoinMapping;
import com.luban.entity.ConceptToolBinding;
import com.luban.repository.ConceptRepository;
import com.luban.repository.ConceptRelationRepository;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptJoinMappingRepository;
import com.luban.repository.ConceptToolBindingRepository;
import com.luban.repository.ConceptSnapshotRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class ConceptSnapshotService {

    private final ConceptSnapshotRepository snapshotRepository;
    private final ConceptRepository conceptRepository;
    private final ConceptRelationRepository conceptRelationRepository;
    private final ConceptMappingRepository conceptMappingRepository;
    private final ConceptJoinMappingRepository conceptJoinMappingRepository;
    private final ConceptToolBindingRepository conceptToolBindingRepository;
    private final ConceptEmbeddingService conceptEmbeddingService;
    private final ObjectMapper objectMapper;

    public ConceptSnapshot createSnapshot(Long groupId, String version, String comment, String createdBy) {
        List<Concept> concepts = conceptRepository.findByGroupId(groupId);

        if (version == null || version.isBlank()) {
            long count = snapshotRepository.countByGroupId(groupId);
            version = "v" + (count + 1);
        }

        List<Long> conceptIds = concepts.stream().map(Concept::getId).toList();

        String snapshotData;
        try {
            Map<String, Object> fullSnapshot = new LinkedHashMap<>();

            fullSnapshot.put("concepts", concepts.stream().map(c -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", c.getId());
                m.put("name", c.getName());
                m.put("description", c.getDescription());
                m.put("groupId", c.getGroupId());
                m.put("anomalyThresholdExpr", c.getAnomalyThresholdExpr());
                m.put("anomalyThresholdDesc", c.getAnomalyThresholdDesc());
                return m;
            }).toList());

            if (!conceptIds.isEmpty()) {
                List<ConceptRelation> relations = conceptRelationRepository.findBySourceConceptIdIn(conceptIds);
                fullSnapshot.put("relations", relations.stream().map(r -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", r.getId());
                    m.put("sourceConceptId", r.getSourceConceptId());
                    m.put("targetConceptId", r.getTargetConceptId());
                    m.put("relationType", r.getRelationType());
                    m.put("expression", r.getExpression());
                    m.put("description", r.getDescription());
                    return m;
                }).toList());

                List<ConceptMapping> mappings = conceptMappingRepository.findByConceptIdIn(conceptIds);
                fullSnapshot.put("mappings", mappings.stream().map(mp -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", mp.getId());
                    m.put("conceptId", mp.getConceptId());
                    m.put("datasourceId", mp.getDatasourceId());
                    m.put("tableName", mp.getTableName());
                    m.put("columnName", mp.getColumnName());
                    m.put("attributeName", mp.getAttributeName());
                    m.put("mappingType", mp.getMappingType());
                    m.put("computedExpr", mp.getComputedExpr());
                    m.put("confidence", mp.getConfidence());
                    m.put("isAuto", mp.getIsAuto());
                    m.put("isRequired", mp.getIsRequired());
                    return m;
                }).toList());

                List<ConceptJoinMapping> joinMappings = conceptJoinMappingRepository.findByConceptIdIn(conceptIds);
                fullSnapshot.put("joinMappings", joinMappings.stream().map(jm -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", jm.getId());
                    m.put("conceptId", jm.getConceptId());
                    m.put("datasourceId", jm.getDatasourceId());
                    m.put("targetConcept", jm.getTargetConcept());
                    m.put("relationType", jm.getRelationType());
                    m.put("joinTable", jm.getJoinTable());
                    m.put("joinCondition", jm.getJoinCondition());
                    m.put("joinType", jm.getJoinType());
                    m.put("confidence", jm.getConfidence());
                    return m;
                }).toList());

                List<ConceptToolBinding> toolBindings = conceptToolBindingRepository.findByConceptIdIn(conceptIds);
                fullSnapshot.put("toolBindings", toolBindings.stream().map(tb -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", tb.getId());
                    m.put("conceptId", tb.getConceptId());
                    m.put("toolId", tb.getToolId());
                    m.put("bindingType", tb.getBindingType());
                    m.put("isDefault", tb.getIsDefault());
                    m.put("config", tb.getConfig());
                    return m;
                }).toList());
            } else {
                fullSnapshot.put("relations", List.of());
                fullSnapshot.put("mappings", List.of());
                fullSnapshot.put("joinMappings", List.of());
                fullSnapshot.put("toolBindings", List.of());
            }

            snapshotData = objectMapper.writeValueAsString(fullSnapshot);
        } catch (Exception e) {
            throw new RuntimeException("序列化快照数据失败", e);
        }

        ConceptSnapshot snapshot = new ConceptSnapshot();
        snapshot.setGroupId(groupId);
        snapshot.setVersion(version);
        snapshot.setSnapshot(snapshotData);
        snapshot.setChangeLog(comment);
        snapshot.setCreatedBy(createdBy);
        return snapshotRepository.save(snapshot);
    }

    public List<ConceptSnapshot> listSnapshots() {
        return snapshotRepository.findAllByOrderByCreatedAtDesc();
    }

    public ConceptSnapshot getSnapshot(Long id) {
        return snapshotRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("快照不存在"));
    }

    public Map<String, Object> diffSnapshots(Long fromId, Long toId) {
        ConceptSnapshot from = getSnapshot(fromId);
        ConceptSnapshot to = getSnapshot(toId);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("fromId", fromId);
        result.put("toId", toId);
        result.put("fromVersion", from.getVersion());
        result.put("toVersion", to.getVersion());

        try {
            Map<String, Object> fromFull = objectMapper.readValue(
                    from.getSnapshot(), new TypeReference<Map<String, Object>>() {});
            Map<String, Object> toFull = objectMapper.readValue(
                    to.getSnapshot(), new TypeReference<Map<String, Object>>() {});

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> fromConcepts = (List<Map<String, Object>>) fromFull.getOrDefault("concepts", List.of());
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> toConcepts = (List<Map<String, Object>>) toFull.getOrDefault("concepts", List.of());

            Map<Long, Map<String, Object>> fromMap = fromConcepts.stream()
                    .collect(Collectors.toMap(c -> toLong(c.get("id")), c -> c, (a, b) -> a));
            Map<Long, Map<String, Object>> toMap = toConcepts.stream()
                    .collect(Collectors.toMap(c -> toLong(c.get("id")), c -> c, (a, b) -> a));

            List<Map<String, Object>> added = new ArrayList<>();
            List<Map<String, Object>> removed = new ArrayList<>();
            List<Map<String, Object>> modified = new ArrayList<>();

            for (Map.Entry<Long, Map<String, Object>> e : toMap.entrySet()) {
                if (!fromMap.containsKey(e.getKey())) {
                    added.add(e.getValue());
                }
            }

            for (Map.Entry<Long, Map<String, Object>> e : fromMap.entrySet()) {
                if (!toMap.containsKey(e.getKey())) {
                    removed.add(e.getValue());
                }
            }

            for (Map.Entry<Long, Map<String, Object>> e : fromMap.entrySet()) {
                Map<String, Object> toConcept = toMap.get(e.getKey());
                if (toConcept != null) {
                    List<Map<String, String>> changes = new ArrayList<>();
                    for (Map.Entry<String, Object> fe : e.getValue().entrySet()) {
                        Object fromVal = fe.getValue();
                        Object toVal = toConcept.get(fe.getKey());
                        if (!(fromVal == null ? toVal == null : fromVal.equals(toVal))) {
                            Map<String, String> change = new LinkedHashMap<>();
                            change.put("field", fe.getKey());
                            change.put("from", String.valueOf(fromVal));
                            change.put("to", String.valueOf(toVal));
                            changes.add(change);
                        }
                    }
                    if (!changes.isEmpty()) {
                        Map<String, Object> mod = new LinkedHashMap<>();
                        mod.put("id", e.getKey());
                        mod.put("name", e.getValue().get("name"));
                        mod.put("changes", changes);
                        modified.add(mod);
                    }
                }
            }

            result.put("added", added);
            result.put("removed", removed);
            result.put("modified", modified);

            Map<String, Integer> summary = new LinkedHashMap<>();
            summary.put("addedCount", added.size());
            summary.put("removedCount", removed.size());
            summary.put("modifiedCount", modified.size());

            for (String section : List.of("relations", "mappings", "joinMappings", "toolBindings")) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> fromSection = (List<Map<String, Object>>) fromFull.getOrDefault(section, List.of());
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> toSection = (List<Map<String, Object>>) toFull.getOrDefault(section, List.of());
                int sectionAdded = 0;
                int sectionRemoved = 0;
                Set<Long> fromIds = fromSection.stream().map(m -> toLong(m.get("id"))).collect(Collectors.toSet());
                Set<Long> toIds = toSection.stream().map(m -> toLong(m.get("id"))).collect(Collectors.toSet());
                for (Long id : toIds) {
                    if (!fromIds.contains(id)) sectionAdded++;
                }
                for (Long id : fromIds) {
                    if (!toIds.contains(id)) sectionRemoved++;
                }
                summary.put(section + "Added", sectionAdded);
                summary.put(section + "Removed", sectionRemoved);
            }

            result.put("summary", summary);
        } catch (Exception e) {
            log.error("Diff snapshots failed", e);
            result.put("error", "快照比对失败: " + e.getMessage());
        }

        return result;
    }

    @Transactional
    public Map<String, Object> rollbackToSnapshot(Long snapshotId, String reviewedBy) {
        ConceptSnapshot snapshot = getSnapshot(snapshotId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("snapshotId", snapshotId);
        result.put("version", snapshot.getVersion());

        try {
            Map<String, Object> fullSnapshot;
            List<Map<String, Object>> snapshotConcepts;

            if (snapshot.getSnapshot().trim().startsWith("[")) {
                log.warn("Rollback: old-format snapshot (flat array), relations/mappings/joins/toolBindings lost");
                List<Map<String, Object>> oldConcepts = objectMapper.readValue(
                        snapshot.getSnapshot(), new TypeReference<List<Map<String, Object>>>() {});
                fullSnapshot = new LinkedHashMap<>();
                fullSnapshot.put("concepts", oldConcepts);
                fullSnapshot.put("relations", List.of());
                fullSnapshot.put("mappings", List.of());
                fullSnapshot.put("joinMappings", List.of());
                fullSnapshot.put("toolBindings", List.of());
                snapshotConcepts = oldConcepts;
            } else {
                fullSnapshot = objectMapper.readValue(
                        snapshot.getSnapshot(), new TypeReference<Map<String, Object>>() {});
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> concepts = (List<Map<String, Object>>) fullSnapshot.get("concepts");
                snapshotConcepts = concepts;
            }

            if (snapshotConcepts == null || snapshotConcepts.isEmpty()) {
                result.put("success", false);
                result.put("error", "快照中无概念数据");
                return result;
            }

            List<Concept> currentConcepts = conceptRepository.findByGroupId(snapshot.getGroupId());
            List<Long> currentConceptIds = currentConcepts.stream().map(Concept::getId).toList();

            if (!currentConceptIds.isEmpty()) {
                conceptToolBindingRepository.deleteByConceptIdIn(currentConceptIds);
                conceptJoinMappingRepository.deleteByConceptIdIn(currentConceptIds);
                conceptMappingRepository.deleteByConceptIdIn(currentConceptIds);

                List<ConceptRelation> relations = conceptRelationRepository.findBySourceConceptIdIn(currentConceptIds);
                relations.addAll(conceptRelationRepository.findByTargetConceptIdIn(currentConceptIds));
                if (!relations.isEmpty()) {
                    conceptRelationRepository.deleteAll(relations);
                }
            }

            int deletedCount = currentConcepts.size();
            conceptRepository.deleteAll(currentConcepts);
            conceptRepository.flush();

            Map<Long, Long> idMapping = new HashMap<>();
            List<Concept> restored = new ArrayList<>();
            for (Map<String, Object> sc : snapshotConcepts) {
                Concept c = new Concept();
                c.setName((String) sc.get("name"));
                c.setDescription((String) sc.get("description"));
                c.setGroupId(snapshot.getGroupId());
                c.setAnomalyThresholdExpr((String) sc.get("anomalyThresholdExpr"));
                c.setAnomalyThresholdDesc((String) sc.get("anomalyThresholdDesc"));
                restored.add(c);
            }
            List<Concept> savedConcepts = conceptRepository.saveAll(restored);
            conceptRepository.flush();

            for (int i = 0; i < snapshotConcepts.size(); i++) {
                Long oldId = toLong(snapshotConcepts.get(i).get("id"));
                Long newId = savedConcepts.get(i).getId();
                idMapping.put(oldId, newId);
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> snapshotRelations = (List<Map<String, Object>>) fullSnapshot.get("relations");
            if (snapshotRelations != null && !snapshotRelations.isEmpty()) {
                List<ConceptRelation> restoredRelations = new ArrayList<>();
                for (Map<String, Object> r : snapshotRelations) {
                    Long oldSourceId = toLong(r.get("sourceConceptId"));
                    Long oldTargetId = toLong(r.get("targetConceptId"));
                    Long newSourceId = idMapping.get(oldSourceId);
                    Long newTargetId = idMapping.get(oldTargetId);
                    if (newSourceId == null || newTargetId == null) {
                        log.warn("Rollback: relation skipped, source={}→{} target={}→{}",
                                oldSourceId, newSourceId, oldTargetId, newTargetId);
                        continue;
                    }
                    ConceptRelation cr = new ConceptRelation();
                    cr.setSourceConceptId(newSourceId);
                    cr.setTargetConceptId(newTargetId);
                    cr.setRelationType((String) r.get("relationType"));
                    cr.setExpression((String) r.get("expression"));
                    cr.setDescription((String) r.get("description"));
                    restoredRelations.add(cr);
                }
                conceptRelationRepository.saveAll(restoredRelations);
                log.info("Rollback: restored {} relations", restoredRelations.size());
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> snapshotMappings = (List<Map<String, Object>>) fullSnapshot.get("mappings");
            if (snapshotMappings != null && !snapshotMappings.isEmpty()) {
                List<ConceptMapping> restoredMappings = new ArrayList<>();
                for (Map<String, Object> mp : snapshotMappings) {
                    Long oldConceptId = toLong(mp.get("conceptId"));
                    Long newConceptId = idMapping.get(oldConceptId);
                    if (newConceptId == null) {
                        log.warn("Rollback: mapping skipped, conceptId={}→null", oldConceptId);
                        continue;
                    }
                    ConceptMapping cm = new ConceptMapping();
                    cm.setConceptId(newConceptId);
                    cm.setDatasourceId(toLong(mp.get("datasourceId")));
                    cm.setTableName((String) mp.get("tableName"));
                    cm.setColumnName((String) mp.get("columnName"));
                    cm.setAttributeName((String) mp.get("attributeName"));
                    cm.setMappingType((String) mp.get("mappingType"));
                    cm.setComputedExpr((String) mp.get("computedExpr"));
                    cm.setConfidence(mp.get("confidence") != null
                            ? new java.math.BigDecimal(mp.get("confidence").toString()) : null);
                    cm.setIsAuto(mp.get("isAuto") != null ? (Boolean) mp.get("isAuto") : false);
                    cm.setIsRequired(mp.get("isRequired") != null ? (Boolean) mp.get("isRequired") : false);
                    restoredMappings.add(cm);
                }
                conceptMappingRepository.saveAll(restoredMappings);
                log.info("Rollback: restored {} mappings", restoredMappings.size());
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> snapshotJoinMappings = (List<Map<String, Object>>) fullSnapshot.get("joinMappings");
            if (snapshotJoinMappings != null && !snapshotJoinMappings.isEmpty()) {
                List<ConceptJoinMapping> restoredJoinMappings = new ArrayList<>();
                for (Map<String, Object> jm : snapshotJoinMappings) {
                    Long oldConceptId = toLong(jm.get("conceptId"));
                    Long newConceptId = idMapping.get(oldConceptId);
                    if (newConceptId == null) {
                        log.warn("Rollback: joinMapping skipped, conceptId={}→null", oldConceptId);
                        continue;
                    }
                    ConceptJoinMapping cjm = new ConceptJoinMapping();
                    cjm.setConceptId(newConceptId);
                    cjm.setDatasourceId(toLong(jm.get("datasourceId")));
                    cjm.setTargetConcept((String) jm.get("targetConcept"));
                    cjm.setRelationType((String) jm.get("relationType"));
                    cjm.setJoinTable((String) jm.get("joinTable"));
                    cjm.setJoinCondition((String) jm.get("joinCondition"));
                    cjm.setJoinType((String) jm.get("joinType"));
                    cjm.setConfidence(jm.get("confidence") != null
                            ? new java.math.BigDecimal(jm.get("confidence").toString()) : null);
                    restoredJoinMappings.add(cjm);
                }
                conceptJoinMappingRepository.saveAll(restoredJoinMappings);
                log.info("Rollback: restored {} joinMappings", restoredJoinMappings.size());
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> snapshotToolBindings = (List<Map<String, Object>>) fullSnapshot.get("toolBindings");
            if (snapshotToolBindings != null && !snapshotToolBindings.isEmpty()) {
                List<ConceptToolBinding> restoredToolBindings = new ArrayList<>();
                for (Map<String, Object> tb : snapshotToolBindings) {
                    Long oldConceptId = toLong(tb.get("conceptId"));
                    Long newConceptId = idMapping.get(oldConceptId);
                    if (newConceptId == null) {
                        log.warn("Rollback: toolBinding skipped, conceptId={}→null", oldConceptId);
                        continue;
                    }
                    ConceptToolBinding ctb = new ConceptToolBinding();
                    ctb.setConceptId(newConceptId);
                    ctb.setToolId(toLong(tb.get("toolId")));
                    ctb.setBindingType((String) tb.get("bindingType"));
                    ctb.setIsDefault(tb.get("isDefault") != null ? (Boolean) tb.get("isDefault") : false);
                    ctb.setConfig((String) tb.get("config"));
                    restoredToolBindings.add(ctb);
                }
                conceptToolBindingRepository.saveAll(restoredToolBindings);
                log.info("Rollback: restored {} toolBindings", restoredToolBindings.size());
            }

            result.put("deletedCount", deletedCount);
            result.put("restoredCount", restored.size());
            result.put("success", true);

            String autoVersion = snapshot.getVersion() + "-rollback-" + System.currentTimeMillis();
            createSnapshot(snapshot.getGroupId(), autoVersion,
                    "回滚至版本 " + snapshot.getVersion() + "，操作人: " + reviewedBy, reviewedBy);

            try {
                for (Concept c : savedConcepts) {
                    conceptEmbeddingService.generateAndSave(c.getId(), c.getName(), c.getDescription());
                }
                conceptEmbeddingService.rebuildIndex();
                log.info("FAISS index rebuilt after rollback to snapshot {} with {} concepts",
                        snapshotId, savedConcepts.size());
            } catch (Exception e) {
                log.error("Failed to rebuild FAISS index after rollback: {}", e.getMessage());
                result.put("faissWarning", "FAISS 索引重建失败，请手动重建");
            }
        } catch (Exception e) {
            log.error("Rollback snapshot failed", e);
            result.put("success", false);
            result.put("error", "回滚失败: " + e.getMessage());
        }

        return result;
    }

    private Long toLong(Object val) {
        if (val instanceof Number n) return n.longValue();
        if (val instanceof String s) {
            try { return Long.parseLong(s); } catch (NumberFormatException e) { return null; }
        }
        return null;
    }
}