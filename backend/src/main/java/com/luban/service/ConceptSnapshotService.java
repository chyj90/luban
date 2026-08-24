package com.luban.service;

import com.luban.entity.ConceptSnapshot;
import com.luban.entity.Concept;
import com.luban.repository.ConceptRepository;
import com.luban.repository.ConceptSnapshotRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
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
    private final ConceptEmbeddingService conceptEmbeddingService;
    private final ObjectMapper objectMapper;

    public ConceptSnapshot createSnapshot(Long groupId, String version, String comment, String createdBy) {
        List<Concept> concepts = conceptRepository.findByGroupId(groupId);

        if (version == null || version.isBlank()) {
            long count = snapshotRepository.countByGroupId(groupId);
            version = "v" + (count + 1);
        }

        String snapshotData;
        try {
            snapshotData = objectMapper.writeValueAsString(concepts.stream().map(c -> Map.of(
                    "id", c.getId(),
                    "name", c.getName(),
                    "description", c.getDescription(),
                    "groupId", c.getGroupId(),
                    "parentId", c.getParentId()
            )).toList());
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
            List<Map<String, Object>> fromConcepts = objectMapper.readValue(
                    from.getSnapshot(), new TypeReference<List<Map<String, Object>>>() {});
            List<Map<String, Object>> toConcepts = objectMapper.readValue(
                    to.getSnapshot(), new TypeReference<List<Map<String, Object>>>() {});

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
            result.put("summary", Map.of(
                    "addedCount", added.size(),
                    "removedCount", removed.size(),
                    "modifiedCount", modified.size()
            ));
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
            List<Map<String, Object>> snapshotConcepts = objectMapper.readValue(
                    snapshot.getSnapshot(), new TypeReference<List<Map<String, Object>>>() {});

            List<Concept> currentConcepts = conceptRepository.findByGroupId(snapshot.getGroupId());
            int deletedCount = currentConcepts.size();
            conceptRepository.deleteAll(currentConcepts);

            List<Concept> restored = new ArrayList<>();
            for (Map<String, Object> sc : snapshotConcepts) {
                Concept c = new Concept();
                c.setName((String) sc.get("name"));
                c.setDescription((String) sc.get("description"));
                c.setGroupId(snapshot.getGroupId());
                c.setParentId(toLong(sc.get("parentId")));
                restored.add(c);
            }
            conceptRepository.saveAll(restored);
            conceptRepository.flush();

            result.put("deletedCount", deletedCount);
            result.put("restoredCount", restored.size());
            result.put("success", true);

            String autoVersion = snapshot.getVersion() + "-rollback-" + System.currentTimeMillis();
            createSnapshot(snapshot.getGroupId(), autoVersion,
                    "回滚至版本 " + snapshot.getVersion() + "，操作人: " + reviewedBy, reviewedBy);

            // 回滚后重建 FAISS 索引
            try {
                for (Concept c : restored) {
                    conceptEmbeddingService.generateAndSave(c.getId(), c.getName(), c.getDescription());
                }
                conceptEmbeddingService.rebuildIndex();
                log.info("FAISS index rebuilt after rollback to snapshot {} with {} concepts",
                        snapshotId, restored.size());
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