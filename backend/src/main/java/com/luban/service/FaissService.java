package com.luban.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.embedding.EmbeddingEndpointRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * EB（embedding-service）FAISS 接口客户端。多副本约定：
 * - 构建类请求（概念索引 / 列索引）广播到全部 EB 实例（{@link EmbeddingEndpointRegistry}），
 *   保证各实例索引一致；
 * - 检索类请求走 primary（K8s Service / 单实例地址），实例缺索引时抛类型化异常，
 *   由领域服务（ConceptEmbeddingService / ConceptMappingService）自愈重建后重试；
 * - 增量 add/remove 已移除：多副本下增量只落单实例，是索引发散的根源。
 *   索引以 MySQL 为唯一事实源，一律全量 build（IndexFlatIP 毫秒级）+ 定时对账。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FaissService {

    private final ObjectMapper objectMapper;
    private final EmbeddingEndpointRegistry endpointRegistry;

    /** 本进程最近一次成功重建索引的时间（Python 端 health 接口不返回该信息） */
    private volatile LocalDateTime lastRebuildTime;

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

    /** 单个 EB 实例的健康详情（多副本对账用），不可达时返回 null */
    public Map<String, Object> endpointHealth(String endpoint) {
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(endpoint + "/v1/faiss/health"))
                    .GET()
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 200) {
                return objectMapper.readValue(resp.body(), new TypeReference<>() {});
            }
        } catch (Exception e) {
            log.warn("FAISS endpoint health failed ({}): {}", endpoint, e.getMessage());
        }
        return null;
    }

    /** 全量重建概念索引：广播到全部 EB 实例，任一失败即抛（定时对账会补齐落后实例） */
    public void buildIndex(List<Map<String, Object>> concepts) {
        buildIndexTo(endpointRegistry.endpoints(), concepts);
    }

    public void buildIndexTo(List<String> endpoints, List<Map<String, Object>> concepts) {
        if (concepts == null || concepts.isEmpty()) {
            log.info("FAISS index build skipped: no concepts to index");
            return;
        }
        List<String> failed = new ArrayList<>();
        for (String endpoint : endpoints) {
            try {
                String body = objectMapper.writeValueAsString(Map.of("concepts", concepts));
                HttpRequest req = HttpRequest.newBuilder()
                        .uri(URI.create(endpoint + "/v1/faiss/build"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(body))
                        .build();
                HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
                if (resp.statusCode() != 200) {
                    failed.add(endpoint + ": " + resp.body());
                }
            } catch (Exception e) {
                failed.add(endpoint + ": " + e.getMessage());
            }
        }
        if (!failed.isEmpty()) {
            throw new RuntimeException("FAISS build failed on [" + String.join("; ", failed) + "]");
        }
        lastRebuildTime = LocalDateTime.now();
        log.info("FAISS index built on {} EB endpoint(s) with {} concepts", endpoints.size(), concepts.size());
    }

    /** 逐实例对账：返回索引规模落后于 expected 的 EB 实例地址列表 */
    public List<String> staleConceptIndexEndpoints(long expectedSize) {
        List<String> stale = new ArrayList<>();
        for (String endpoint : endpointRegistry.endpoints()) {
            Map<String, Object> health = endpointHealth(endpoint);
            if (health == null) {
                stale.add(endpoint); // 不可达也标记：恢复后需补建
                continue;
            }
            Object size = health.get("index_size");
            long actual = size instanceof Number n ? n.longValue() : 0;
            if (actual < expectedSize) {
                stale.add(endpoint);
            }
        }
        return stale;
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
            if (resp.statusCode() == 503 && resp.body() != null && resp.body().contains("index_not_built")) {
                throw new FaissIndexMissingException(resp.body());
            }
            if (resp.statusCode() != 200) {
                throw new RuntimeException("FAISS search failed: " + resp.body());
            }
            Map<String, Object> result = objectMapper.readValue(resp.body(), new TypeReference<>() {});
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> results = (List<Map<String, Object>>) result.get("results");
            return results;
        } catch (FaissIndexMissingException e) {
            throw e;
        } catch (Exception e) {
            log.error("FAISS search error", e);
            throw new RuntimeException("FAISS search failed: " + e.getMessage());
        }
    }

    /**
     * 跨指定数据源检索相似列（EB 侧按 datasource_id 分槽索引后合并）。
     * 有数据源缺失索引时抛 {@link FaissColumnIndexMissingException}（携带部分结果）供调用方自愈。
     */
    public List<Map<String, Object>> searchColumns(List<Float> embedding, int topK,
                                                   List<String> datasourceIds) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("datasource_ids", datasourceIds);
            payload.put("embedding", embedding);
            payload.put("top_k", topK);
            String body = objectMapper.writeValueAsString(payload);
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(embeddingServiceUrl + "/v1/faiss/search-columns"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                throw new RuntimeException("Column search failed: " + resp.body());
            }
            Map<String, Object> result = objectMapper.readValue(resp.body(), new TypeReference<>() {});
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> results = (List<Map<String, Object>>) result.get("results");
            @SuppressWarnings("unchecked")
            List<String> missing = (List<String>) result.get("missing");
            if (missing != null && !missing.isEmpty()) {
                throw new FaissColumnIndexMissingException(missing, results);
            }
            return results;
        } catch (FaissColumnIndexMissingException e) {
            throw e;
        } catch (Exception e) {
            log.error("Column search error", e);
            throw new RuntimeException("Column search failed: " + e.getMessage());
        }
    }

    /**
     * 列索引是否就绪（数据源已构建且结构指纹匹配）。多副本下要求**全部** EB 实例就绪
     * 才算就绪——只查单实例会漏掉"新副本缺索引"的窗口。
     */
    public boolean isColumnIndexBuiltFor(String datasourceId, String fingerprint) {
        for (String endpoint : endpointRegistry.endpoints()) {
            try {
                HttpRequest req = HttpRequest.newBuilder()
                        .uri(URI.create(endpoint + "/v1/faiss/column-index-status?datasource_id="
                                + datasourceId + "&fingerprint=" + fingerprint))
                        .GET()
                        .build();
                HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
                if (resp.statusCode() != 200) {
                    return false;
                }
                Map<String, Object> result = objectMapper.readValue(resp.body(), new TypeReference<>() {});
                if (!Boolean.TRUE.equals(result.get("built"))) {
                    return false;
                }
            } catch (Exception e) {
                log.warn("Column index status check failed ({}): {}", endpoint, e.getMessage());
                return false;
            }
        }
        return true;
    }

    /** 全量重建某数据源的列索引：广播到全部 EB 实例（EB 按数据源分槽，各实例覆盖同槽） */
    public void buildColumnIndex(String datasourceId, String fingerprint,
                                 List<Map<String, Object>> columns) {
        List<String> endpoints = endpointRegistry.endpoints();
        List<String> failed = new ArrayList<>();
        for (String endpoint : endpointRegistry.endpoints()) {
            try {
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("datasource_id", datasourceId);
                payload.put("fingerprint", fingerprint);
                payload.put("columns", columns);
                String body = objectMapper.writeValueAsString(payload);
                HttpRequest req = HttpRequest.newBuilder()
                        .uri(URI.create(endpoint + "/v1/faiss/build-column-index"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(body))
                        .build();
                HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
                if (resp.statusCode() != 200) {
                    failed.add(endpoint + ": " + resp.body());
                }
            } catch (Exception e) {
                failed.add(endpoint + ": " + e.getMessage());
            }
        }
        if (!failed.isEmpty()) {
            throw new RuntimeException("Column index build failed on [" + String.join("; ", failed) + "]");
        }
        log.info("Column index built for datasource {} with {} columns on {} EB endpoint(s)",
                datasourceId, columns.size(), endpoints.size());
    }

    public Map<String, Object> getIndexStats() {
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(embeddingServiceUrl + "/v1/faiss/health"))
                    .GET()
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() == 200) {
                Map<String, Object> health = objectMapper.readValue(resp.body(), new TypeReference<>() {});
                Map<String, Object> stats = new LinkedHashMap<>();
                stats.put("total_indexed", health.getOrDefault("index_size", 0));
                stats.put("column_indexed", health.getOrDefault("column_index_size", 0));
                stats.put("index_built", health.getOrDefault("index_built", false));
                stats.put("column_index_built", health.getOrDefault("column_index_built", false));
                stats.put("faiss_available", health.getOrDefault("faiss_available", false));
                stats.put("last_rebuild", lastRebuildTime != null ? lastRebuildTime.toString() : null);
                stats.put("status", "ok");
                return stats;
            }
            log.warn("FAISS health returned status: {}", resp.statusCode());
            return Map.of("total_indexed", 0, "status", "unavailable");
        } catch (Exception e) {
            log.warn("FAISS health unavailable: {}", e.getMessage());
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
