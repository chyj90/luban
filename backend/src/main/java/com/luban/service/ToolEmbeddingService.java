package com.luban.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.embedding.EmbeddingHttpClient;
import com.luban.entity.ToolDefinition;
import com.luban.repository.ToolDefinitionRepository;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
public class ToolEmbeddingService {

    private final ToolDefinitionRepository toolDefinitionRepository;
    private final OntologyService ontologyService;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private EmbeddingHttpClient embeddingClient;

    public ToolEmbeddingService(ToolDefinitionRepository toolDefinitionRepository,
                                 OntologyService ontologyService) {
        this.toolDefinitionRepository = toolDefinitionRepository;
        this.ontologyService = ontologyService;
    }

    @PostConstruct
    void init() {
        this.embeddingClient = new EmbeddingHttpClient();
        if (embeddingClient.isAvailable()) {
            log.info("Embedding service connected, dimension: {}", embeddingClient.getDimension());
        } else {
            log.warn("Embedding service not available at {}, vector search will fall back to BM25",
                    System.getProperty("luban.embedding.base-url", "http://127.0.0.1:8765"));
        }
    }

    @PreDestroy
    void destroy() {
        if (embeddingClient != null) {
            embeddingClient.close();
        }
    }

    public boolean isEmbeddingAvailable() {
        return embeddingClient != null && embeddingClient.isAvailable();
    }

    public float[] generateEmbedding(String text) {
        if (embeddingClient == null || !embeddingClient.isAvailable()) {
            return null;
        }
        return embeddingClient.encode(text);
    }

    public String generateEmbeddingJson(String text) {
        float[] vec = generateEmbedding(text);
        if (vec == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(vec);
        } catch (Exception e) {
            log.error("Failed to serialize embedding: {}", e.getMessage());
            return null;
        }
    }

    public void ensureEmbeddings(Long groupId) {
        if (embeddingClient == null || !embeddingClient.isAvailable()) {
            return;
        }
        List<ToolDefinition> tools = toolDefinitionRepository.findByGroupIdAndStatus(groupId, "ENABLED");
        List<ToolDefinition> pending = tools.stream()
                .filter(t -> t.getEmbedding() == null || t.getEmbedding().isEmpty())
                .collect(Collectors.toList());

        if (pending.isEmpty()) {
            return;
        }

        List<String> texts = pending.stream()
                .map(t -> (t.getDisplayName() != null ? t.getDisplayName() + ": " : "") + t.getDescription())
                .collect(Collectors.toList());

        List<float[]> embeddings = embeddingClient.encodeBatch(texts);
        for (int i = 0; i < pending.size(); i++) {
            try {
                String json = objectMapper.writeValueAsString(embeddings.get(i));
                pending.get(i).setEmbedding(json);
            } catch (Exception e) {
                log.warn("Failed to serialize embedding for tool {}: {}", pending.get(i).getName(), e.getMessage());
            }
        }
        toolDefinitionRepository.saveAll(pending);
        log.info("Generated embeddings for {} tools in group {}", pending.size(), groupId);
    }

    public List<ToolDefinition> search(Long groupId, String query, int topK) {
        List<ToolDefinition> tools = toolDefinitionRepository.findByGroupIdAndStatus(groupId, "ENABLED");
        if (tools.isEmpty()) {
            return Collections.emptyList();
        }

        List<ToolDefinition> topResults;
        if (embeddingClient != null && embeddingClient.isAvailable()
                && tools.stream().anyMatch(t -> t.getEmbedding() != null && !t.getEmbedding().isEmpty())) {
            topResults = searchByEmbedding(tools, query, topK);
        } else {
            topResults = searchByKeyword(tools, query, topK);
        }

        if (ontologyService.isEnabled()) {
            return ontologyService.expandByConcepts(topResults, 20);
        }

        return topResults;
    }

    private List<ToolDefinition> searchByEmbedding(List<ToolDefinition> tools, String query, int topK) {
        try {
            List<float[]> vectors = new ArrayList<>();
            for (ToolDefinition tool : tools) {
                if (tool.getEmbedding() != null && !tool.getEmbedding().isEmpty()) {
                    float[] vec = parseEmbedding(tool.getEmbedding());
                    if (vec != null) {
                        vectors.add(vec);
                    } else {
                        vectors.add(new float[0]);
                    }
                } else {
                    vectors.add(new float[0]);
                }
            }

            float[] queryVec = generateQueryEmbedding(query);
            if (queryVec == null) {
                return searchByKeyword(tools, query, topK);
            }

            PriorityQueue<ToolScore> pq = new PriorityQueue<>(Comparator.comparingDouble(s -> s.score));
            for (int i = 0; i < tools.size(); i++) {
                float[] vec = vectors.get(i);
                if (vec.length == 0) continue;
                double similarity = cosineSimilarity(queryVec, vec);
                pq.offer(new ToolScore(tools.get(i), similarity));
                if (pq.size() > topK) {
                    pq.poll();
                }
            }

            List<ToolDefinition> result = new ArrayList<>();
            while (!pq.isEmpty()) {
                result.add(0, pq.poll().tool);
            }
            return result;
        } catch (Exception e) {
            log.warn("向量检索失败，降级为关键词匹配: {}", e.getMessage());
            return searchByKeyword(tools, query, topK);
        }
    }

    private List<ToolDefinition> searchByKeyword(List<ToolDefinition> tools, String query, int topK) {
        List<String> queryTokens = tokenize(query);

        PriorityQueue<ToolScore> pq = new PriorityQueue<>(Comparator.comparingDouble(s -> s.score));
        for (ToolDefinition tool : tools) {
            String text = (tool.getDisplayName() != null ? tool.getDisplayName() + " " : "") + tool.getDescription();
            List<String> docTokens = tokenize(text);
            double score = bm25Score(queryTokens, docTokens, tools.size());
            pq.offer(new ToolScore(tool, score));
            if (pq.size() > topK) {
                pq.poll();
            }
        }

        List<ToolDefinition> result = new ArrayList<>();
        while (!pq.isEmpty()) {
            result.add(0, pq.poll().tool);
        }
        return result;
    }

    private List<String> tokenize(String text) {
        if (text == null || text.isEmpty()) return Collections.emptyList();
        return Arrays.stream(text.split("[\\s，,。；;：:！!？?()（）\\[\\]【】\"\"''、/\\\\]+"))
                .map(String::toLowerCase)
                .filter(s -> s.length() > 0)
                .collect(Collectors.toList());
    }

    private double bm25Score(List<String> queryTokens, List<String> docTokens, int totalDocs) {
        double k1 = 1.5;
        double b = 0.75;
        int docLength = docTokens.size();

        Set<String> uniqueQuery = new HashSet<>(queryTokens);
        double score = 0;
        for (String token : uniqueQuery) {
            int tf = Collections.frequency(docTokens, token);
            if (tf == 0) continue;
            int df = 1;
            double idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
            double avgLen = 8.0;
            double numerator = tf * (k1 + 1);
            double denominator = tf + k1 * (1 - b + b * docLength / avgLen);
            score += idf * numerator / denominator;
        }
        return score;
    }

    private float[] parseEmbedding(String embedding) {
        try {
            List<Double> values = objectMapper.readValue(embedding, new TypeReference<List<Double>>() {});
            float[] result = new float[values.size()];
            for (int i = 0; i < values.size(); i++) {
                result[i] = values.get(i).floatValue();
            }
            return result;
        } catch (Exception e) {
            log.warn("Failed to parse embedding: {}", e.getMessage());
            return null;
        }
    }

    private float[] generateQueryEmbedding(String query) {
        if (embeddingClient == null || !embeddingClient.isAvailable()) {
            return null;
        }
        return embeddingClient.encode(query);
    }

    private double cosineSimilarity(float[] a, float[] b) {
        if (a.length != b.length) return 0;
        double dot = 0, normA = 0, normB = 0;
        for (int i = 0; i < a.length; i++) {
            dot += (double) a[i] * b[i];
            normA += (double) a[i] * a[i];
            normB += (double) b[i] * b[i];
        }
        if (normA == 0 || normB == 0) return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    private record ToolScore(ToolDefinition tool, double score) {}
}