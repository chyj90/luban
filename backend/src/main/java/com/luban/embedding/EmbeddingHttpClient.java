package com.luban.embedding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

@Slf4j
public class EmbeddingHttpClient implements AutoCloseable {

    private static final String DEFAULT_BASE_URL = "http://127.0.0.1:8765";
    private static final String BASE_URL_PROPERTY = "luban.embedding.base-url";

    private final HttpClient httpClient;
    private final ObjectMapper mapper;
    private final String baseUrl;
    private volatile boolean available = false;
    private volatile int dimension = 0;

    public EmbeddingHttpClient() {
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
        this.mapper = new ObjectMapper();

        String url = System.getProperty(BASE_URL_PROPERTY);
        if (url == null) {
            url = System.getenv("LUBAN_EMBEDDING_BASE_URL");
        }
        this.baseUrl = (url != null && !url.isBlank()) ? url : DEFAULT_BASE_URL;

        checkHealth();
    }

    private void checkHealth() {
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/health"))
                    .timeout(Duration.ofSeconds(5))
                    .GET()
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 200) {
                JsonNode node = mapper.readTree(resp.body());
                available = node.path("loaded").asBoolean(false);
                if (available) {
                    log.info("Embedding service available at {}", baseUrl);
                }
            }
        } catch (Exception e) {
            log.warn("Embedding service not available at {}: {}", baseUrl, e.getMessage());
            available = false;
        }
    }

    public boolean isAvailable() {
        return available;
    }

    public int getDimension() {
        if (dimension == 0 && available) {
            try {
                float[] vec = encode("test");
                if (vec != null) {
                    dimension = vec.length;
                }
            } catch (Exception e) {
                log.warn("Failed to get embedding dimension: {}", e.getMessage());
            }
        }
        return dimension;
    }

    public float[] encode(String text) {
        if (!available) return null;
        try {
            List<float[]> results = encodeBatch(List.of(text));
            return (results != null && !results.isEmpty()) ? results.get(0) : null;
        } catch (Exception e) {
            log.error("Embedding encode failed: {}", e.getMessage());
            return null;
        }
    }

    public List<float[]> encodeBatch(List<String> texts) {
        if (!available || texts == null || texts.isEmpty()) {
            return List.of();
        }

        try {
            String body = mapper.writeValueAsString(
                    mapper.createObjectNode().putPOJO("input", texts)
            );

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/v1/embeddings"))
                    .timeout(Duration.ofSeconds(30))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();

            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());

            if (resp.statusCode() != 200) {
                log.error("Embedding service returned status {}: {}", resp.statusCode(), resp.body());
                return List.of();
            }

            JsonNode root = mapper.readTree(resp.body());
            JsonNode data = root.path("data");
            List<float[]> results = new ArrayList<>();
            for (JsonNode item : data) {
                JsonNode emb = item.path("embedding");
                float[] vec = new float[emb.size()];
                for (int i = 0; i < emb.size(); i++) {
                    vec[i] = (float) emb.get(i).asDouble();
                }
                results.add(vec);
            }
            return results;
        } catch (Exception e) {
            log.error("Embedding batch encode failed: {}", e.getMessage());
            return List.of();
        }
    }

    /**
     * 批量中文关键词提取（embedding-service /v1/segment，jieba TF-IDF）。
     * 返回与入参顺序一致的关键词列表；服务不可用或失败时返回 null，调用方自行降级。
     */
    public List<List<String>> segment(List<String> texts, int topK) {
        if (texts == null || texts.isEmpty()) {
            return List.of();
        }
        try {
            var bodyNode = mapper.createObjectNode();
            bodyNode.putPOJO("texts", texts);
            bodyNode.put("topK", topK);

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/v1/segment"))
                    .timeout(Duration.ofSeconds(30))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(bodyNode)))
                    .build();

            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                log.error("Embedding segment returned status {}: {}", resp.statusCode(), resp.body());
                return null;
            }
            JsonNode root = mapper.readTree(resp.body());
            JsonNode results = root.path("results");
            List<List<String>> out = new ArrayList<>();
            for (JsonNode item : results) {
                List<String> terms = new ArrayList<>();
                for (JsonNode t : item.path("terms")) {
                    terms.add(t.asText());
                }
                out.add(terms);
            }
            return out;
        } catch (Exception e) {
            log.error("Embedding segment failed: {}", e.getMessage());
            return null;
        }
    }

    @Override
    public void close() {
        // nothing to close
    }
}