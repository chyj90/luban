package com.luban.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class FaissService {

    private final ObjectMapper objectMapper;

    @Value("${embedding.service.url:http://localhost:8765}")
    private String embeddingServiceUrl;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(java.time.Duration.ofSeconds(10))
            .build();

    public boolean isHealthy() {
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(embeddingServiceUrl + "/v1/faiss/health"))
                    .GET()
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            return resp.statusCode() == 200;
        } catch (Exception e) {
            log.warn("FAISS health check failed: {}", e.getMessage());
            return false;
        }
    }

    public void buildIndex(List<Map<String, Object>> concepts) {
        if (concepts == null || concepts.isEmpty()) {
            log.info("FAISS index build skipped: no concepts to index");
            return;
        }
        try {
            String body = objectMapper.writeValueAsString(Map.of("concepts", concepts));
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(embeddingServiceUrl + "/v1/faiss/build"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                throw new RuntimeException("FAISS build failed: " + resp.body());
            }
            log.info("FAISS index built with {} concepts", concepts.size());
        } catch (Exception e) {
            log.error("FAISS build error", e);
            throw new RuntimeException("FAISS build failed: " + e.getMessage());
        }
    }

    public List<Map<String, Object>> search(List<Float> embedding, int topK) {
        try {
            String body = objectMapper.writeValueAsString(Map.of("embedding", embedding, "top_k", topK));
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(embeddingServiceUrl + "/v1/faiss/search"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                throw new RuntimeException("FAISS search failed: " + resp.body());
            }
            Map<String, Object> result = objectMapper.readValue(resp.body(), new TypeReference<>() {});
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> results = (List<Map<String, Object>>) result.get("results");
            return results;
        } catch (Exception e) {
            log.error("FAISS search error", e);
            throw new RuntimeException("FAISS search failed: " + e.getMessage());
        }
    }

    public void addConcepts(List<Map<String, Object>> concepts) {
        try {
            String body = objectMapper.writeValueAsString(Map.of("concepts", concepts));
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(embeddingServiceUrl + "/v1/faiss/add"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                throw new RuntimeException("FAISS add failed: " + resp.body());
            }
            log.info("FAISS added {} concepts", concepts.size());
        } catch (Exception e) {
            log.error("FAISS add error", e);
            throw new RuntimeException("FAISS add failed: " + e.getMessage());
        }
    }

    public void removeConcepts(List<String> ids) {
        try {
            String body = objectMapper.writeValueAsString(Map.of("ids", ids));
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(embeddingServiceUrl + "/v1/faiss/remove"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                throw new RuntimeException("FAISS remove failed: " + resp.body());
            }
            log.info("FAISS removed {} concepts", ids.size());
        } catch (Exception e) {
            log.error("FAISS remove error", e);
            throw new RuntimeException("FAISS remove failed: " + e.getMessage());
        }
    }

    public Map<String, Object> getIndexStats() {
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(embeddingServiceUrl + "/v1/faiss/stats"))
                    .GET()
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 200) {
                return objectMapper.readValue(resp.body(), new TypeReference<>() {});
            }
            log.warn("FAISS stats returned status: {}", resp.statusCode());
            return Map.of("total_indexed", 0, "status", "unavailable");
        } catch (Exception e) {
            log.warn("FAISS stats unavailable: {}", e.getMessage());
            return Map.of("total_indexed", 0, "status", "unavailable");
        }
    }

    public List<Float> getEmbedding(String text) {
        try {
            String body = objectMapper.writeValueAsString(Map.of("input", text));
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(embeddingServiceUrl + "/v1/embeddings"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                throw new RuntimeException("Embedding failed: " + resp.body());
            }
            Map<String, Object> result = objectMapper.readValue(resp.body(), new TypeReference<>() {});
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> data = (List<Map<String, Object>>) result.get("data");
            if (data == null || data.isEmpty()) {
                throw new RuntimeException("Empty embedding result");
            }
            @SuppressWarnings("unchecked")
            List<Double> raw = (List<Double>) data.get(0).get("embedding");
            return raw.stream().map(Double::floatValue).toList();
        } catch (Exception e) {
            log.error("Embedding error", e);
            throw new RuntimeException("Embedding failed: " + e.getMessage());
        }
    }

    public int getIndexCount() {
        Map<String, Object> stats = getIndexStats();
        Object total = stats.get("total_indexed");
        if (total instanceof Number) {
            return ((Number) total).intValue();
        }
        return 0;
    }

    public String getLastRebuildTime() {
        try {
            Map<String, Object> stats = getIndexStats();
            Object time = stats.get("last_rebuild");
            return time != null ? time.toString() : "未知";
        } catch (Exception e) {
            return "未知";
        }
    }
}