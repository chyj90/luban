package com.luban.service;

import com.luban.entity.Concept;
import com.luban.repository.ConceptRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
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

    public List<Map<String, Object>> loadAllEmbeddings() {
        List<Concept> concepts = conceptRepository.findAll();
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