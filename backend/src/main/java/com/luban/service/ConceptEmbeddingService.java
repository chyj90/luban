package com.luban.service;

import com.luban.entity.Concept;
import com.luban.repository.ConceptRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class ConceptEmbeddingService {

    private final ConceptRepository conceptRepository;
    private final FaissService faissService;

    @Value("${embedding.model.version:default}")
    private String embeddingModelVersion;

    public float[] getEmbedding(Long conceptId) {
        Concept concept = conceptRepository.findById(conceptId)
                .orElseThrow(() -> new IllegalArgumentException("概念不存在"));
        return bytesToFloats(concept.getEmbedding());
    }

    @Transactional
    public void generateAndSave(Long conceptId, String name, String description) {
        String text = (name != null ? name : "") + " " + (description != null ? description : "");
        List<Float> embedding = faissService.getEmbedding(text);
        Concept concept = conceptRepository.findById(conceptId)
                .orElseThrow(() -> new IllegalArgumentException("概念不存在"));
        concept.setEmbedding(floatsToBytes(embedding));
        concept.setEmbeddingVersion(embeddingModelVersion);
        conceptRepository.save(concept);
        log.info("Embedding generated for concept {}: {}", conceptId, name);
    }

    /**
     * 事务提交后异步补齐/刷新概念 embedding 并重建 FAISS 索引。
     * 统一三个概念写入入口（Controller CRUD、文件导入、LLM ontology_action）的向量行为，
     * 修复"概念创建后在问数里搜不到"的静默失效：此前只有部分入口会生成向量，
     * 且有的入口在事务内同步调 HTTP、失败只留 log。
     *
     * @param force true 表示已有向量的概念也重新生成（用于 name/description 变更后刷新）
     */
    public void scheduleEmbeddingAfterCommit(Collection<Long> conceptIds, boolean force) {
        if (conceptIds == null || conceptIds.isEmpty()) return;
        List<Long> ids = List.copyOf(conceptIds);
        Runnable task = () -> {
            int generated = 0;
            for (Long id : ids) {
                try {
                    Concept c = conceptRepository.findById(id).orElse(null);
                    if (c == null) continue;
                    boolean missing = c.getEmbedding() == null || c.getEmbedding().length == 0;
                    if (!missing && !force) continue;
                    generateAndSave(id, c.getName(), c.getDescription());
                    generated++;
                } catch (Exception e) {
                    log.error("Failed to generate embedding for concept {}: {}", id, e.getMessage());
                }
            }
            if (generated > 0) {
                try {
                    rebuildIndex();
                } catch (Exception e) {
                    log.error("Failed to rebuild FAISS index after embedding generation: {}", e.getMessage());
                }
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    Thread.startVirtualThread(task);
                }
            });
        } else {
            Thread.startVirtualThread(task);
        }
    }

    public List<Map<String, Object>> loadAllEmbeddings() {        List<Concept> concepts = conceptRepository.findAll();
        List<Map<String, Object>> result = new ArrayList<>();
        for (Concept c : concepts) {
            if (c.getEmbedding() != null && c.getEmbedding().length > 0) {
                float[] emb = bytesToFloats(c.getEmbedding());
                result.add(Map.of(
                        "id", c.getId().toString(),
                        "name", c.getName() != null ? c.getName() : "",
                        "description", c.getDescription() != null ? c.getDescription() : "",
                        "embedding", toFloatList(emb)
                ));
            }
        }
        return result;
    }

    public int rebuildIndex() {
        List<Map<String, Object>> all = loadAllEmbeddings();
        faissService.buildIndex(all);
        log.info("FAISS index rebuilt with {} concepts", all.size());
        return all.size();
    }

    /** 从 FAISS 索引移除已删除概念（概念删除后调用，避免死 ID 留在索引里） */
    public void removeFromIndex(List<String> conceptIds) {
        if (conceptIds == null || conceptIds.isEmpty()) return;
        faissService.removeConcepts(conceptIds);
    }

    public int regenerateAll() {
        List<Concept> concepts = conceptRepository.findAll();
        int processed = 0;
        for (Concept c : concepts) {
            try {
                generateAndSave(c.getId(), c.getName(), c.getDescription());
                processed++;
            } catch (Exception e) {
                log.error("Failed to generate embedding for concept {}", c.getId(), e);
            }
        }
        rebuildIndex();
        return processed;
    }

    public void regenerateForConcept(Long conceptId) {
        Concept concept = conceptRepository.findById(conceptId)
                .orElseThrow(() -> new IllegalArgumentException("概念不存在"));
        generateAndSave(conceptId, concept.getName(), concept.getDescription());
    }

    public Map<String, Object> getHealth() {
        Map<String, Object> health = new LinkedHashMap<>();

        long totalConcepts = conceptRepository.count();
        long embeddedConcepts = conceptRepository.countByEmbeddingIsNotNull();
        double coverageRate = totalConcepts > 0
                ? Math.round(embeddedConcepts * 10000.0 / totalConcepts) / 100.0
                : 0;

        health.put("totalConcepts", totalConcepts);
        health.put("embeddedConcepts", embeddedConcepts);
        health.put("coverageRate", coverageRate);
        health.put("embeddingModelVersion", embeddingModelVersion);

        boolean faissHealthy = faissService.isHealthy();
        health.put("faissHealthy", faissHealthy);

        Map<String, Object> indexStats = faissService.getIndexStats();
        health.put("indexStats", indexStats);

        return health;
    }

    private byte[] floatsToBytes(List<Float> floats) {
        ByteBuffer buf = ByteBuffer.allocate(floats.size() * 4).order(ByteOrder.LITTLE_ENDIAN);
        for (float f : floats) {
            buf.putFloat(f);
        }
        return buf.array();
    }

    private float[] bytesToFloats(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return new float[0];
        ByteBuffer buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        float[] result = new float[bytes.length / 4];
        for (int i = 0; i < result.length; i++) {
            result[i] = buf.getFloat();
        }
        return result;
    }

    private List<Float> toFloatList(float[] arr) {
        List<Float> list = new ArrayList<>(arr.length);
        for (float f : arr) {
            list.add(f);
        }
        return list;
    }
}