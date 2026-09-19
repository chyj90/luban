package com.luban.service;

import com.luban.entity.Concept;
import com.luban.repository.ConceptRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
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

    /** 跨后端实例的重建互斥锁（MySQL GET_LOCK）：多副本同时触发全量重建时串行化，避免打爆 EB */
    private static final String REBUILD_LOCK = "luban:faiss-rebuild";

    private final ConceptRepository conceptRepository;
    private final FaissService faissService;
    private final JdbcTemplate jdbcTemplate;

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

    /** 跨实例互斥的全量重建：索引是可从 MySQL 重建的缓存，失败由定时对账兜底 */
    public void rebuildIndexWithLock() {
        boolean locked = false;
        try {
            Integer got = jdbcTemplate.queryForObject(
                    "SELECT GET_LOCK(?, ?)", Integer.class, REBUILD_LOCK, 30);
            locked = got != null && got == 1;
        } catch (Exception e) {
            log.debug("GET_LOCK unavailable (non-MySQL env?), rebuild without lock: {}", e.getMessage());
        }
        try {
            rebuildIndex();
        } finally {
            if (locked) {
                try {
                    jdbcTemplate.queryForObject("SELECT RELEASE_LOCK(?)", Integer.class, REBUILD_LOCK);
                } catch (Exception e) {
                    log.warn("RELEASE_LOCK failed: {}", e.getMessage());
                }
            }
        }
    }

    /** 事务提交后触发全量重建（广播全部 EB 实例）。失败仅告警：定时对账自愈。 */
    public void scheduleRebuildAfterCommit() {
        Runnable task = () -> {
            try {
                rebuildIndexWithLock();
            } catch (Exception e) {
                log.error("Failed to rebuild FAISS index after commit: {}", e.getMessage());
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

    /** 概念检索自愈：EB 实例缺索引（新副本/EB 重启）时全量重建后重试一次 */
    public List<Map<String, Object>> searchWithHeal(List<Float> embedding, int topK) {
        try {
            return faissService.search(embedding, topK);
        } catch (FaissIndexMissingException e) {
            log.warn("FAISS index missing on EB instance, rebuilding: {}", e.getMessage());
            rebuildIndexWithLock();
            return faissService.search(embedding, topK);
        }
    }

    /**
     * 多副本对账（60s）：逐 EB 实例核对概念索引规模，仅向落后实例广播重建。
     * 覆盖 EB 重启丢索引、新副本上线、构建广播部分失败三种漂移来源。
     */
    @Scheduled(fixedDelay = 60_000, initialDelay = 90_000)
    public void reconcileFaissIndex() {
        try {
            if (!faissService.isHealthy()) return;
            long expected = loadAllEmbeddings().size();
            List<String> stale = faissService.staleConceptIndexEndpoints(expected);
            if (stale.isEmpty()) return;
            log.info("[faiss-reconcile] {} EB endpoint(s) behind (expected {}), rebuilding",
                    stale.size(), expected);
            faissService.buildIndexTo(stale, loadAllEmbeddings());
        } catch (Exception e) {
            log.warn("[faiss-reconcile] reconciliation failed: {}", e.getMessage());
        }
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