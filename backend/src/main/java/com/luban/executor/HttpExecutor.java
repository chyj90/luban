package com.luban.executor;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.ToolDefinition;
import com.luban.entity.ToolGroup;
import com.luban.repository.ToolGroupRepository;
import com.luban.util.AesEncryptUtil;
import com.luban.util.Ed25519Util;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;

@Component
public class HttpExecutor {

    private static final Logger log = LoggerFactory.getLogger(HttpExecutor.class);
    private static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(10);
    private static final int MAX_RETRIES = 3;

    private final ToolGroupRepository toolGroupRepository;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public HttpExecutor(ToolGroupRepository toolGroupRepository, ObjectMapper objectMapper) {
        this.toolGroupRepository = toolGroupRepository;
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    public String execute(ToolDefinition tool, Map<String, Object> arguments, String callerInfo) {
        try {
            Map<String, Object> config = objectMapper.readValue(tool.getConfig(), Map.class);
            String method = (String) config.getOrDefault("method", "GET");
            String url = (String) config.get("url");
            int timeout = config.containsKey("timeout") ? ((Number) config.get("timeout")).intValue() : 10;

            if (url == null) {
                return errorJson("Tool config is missing url");
            }

            String resolvedUrl = resolveUrl(url, arguments);
            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(resolvedUrl))
                    .timeout(Duration.ofSeconds(timeout));

            HttpRequest.BodyPublisher bodyPublisher = HttpRequest.BodyPublishers.noBody();
            if ("POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method) || "PATCH".equalsIgnoreCase(method)) {
                String body = objectMapper.writeValueAsString(arguments);
                bodyPublisher = HttpRequest.BodyPublishers.ofString(body);
                builder.header("Content-Type", "application/json");
            }

            builder.method(method.toUpperCase(), bodyPublisher);

            applyHeaders(builder, config);

            signRequest(builder, tool, callerInfo);

            return executeWithRetry(builder.build());
        } catch (Exception e) {
            log.error("HTTP executor failed for tool: {}", tool.getName(), e);
            return errorJson("HTTP execution failed: " + e.getMessage());
        }
    }

    private void applyHeaders(HttpRequest.Builder builder, Map<String, Object> config) {
        @SuppressWarnings("unchecked")
        Map<String, String> headers = (Map<String, String>) config.get("headers");
        if (headers != null) {
            headers.forEach(builder::header);
        }

        @SuppressWarnings("unchecked")
        Map<String, Object> auth = (Map<String, Object>) config.get("auth");
        if (auth != null) {
            String authType = (String) auth.get("type");
            if ("BEARER".equalsIgnoreCase(authType)) {
                builder.header("Authorization", "Bearer " + auth.get("token"));
            } else if ("API_KEY".equalsIgnoreCase(authType)) {
                String keyName = (String) auth.getOrDefault("headerName", "X-API-Key");
                builder.header(keyName, (String) auth.get("value"));
            } else if ("BASIC".equalsIgnoreCase(authType)) {
                String encoded = Base64.getEncoder().encodeToString(
                        (auth.get("username") + ":" + auth.get("password")).getBytes());
                builder.header("Authorization", "Basic " + encoded);
            }
        }
    }

    private void signRequest(HttpRequest.Builder builder, ToolDefinition tool, String callerInfo) {
        try {
            ToolGroup group = toolGroupRepository.findById(tool.getGroupId()).orElse(null);
            if (group == null || group.getPrivateKeyEnc() == null) {
                return;
            }

            String privateKeyStr = AesEncryptUtil.decrypt(group.getPrivateKeyEnc());
            byte[] privateKeyBytes = Base64.getDecoder().decode(privateKeyStr);

            String auditJson = objectMapper.writeValueAsString(Map.of(
                    "tool_id", tool.getId(),
                    "tool_name", tool.getName(),
                    "group_id", group.getId(),
                    "group_code", group.getCode(),
                    "caller", callerInfo != null ? callerInfo : "system",
                    "ts", Instant.now().toEpochMilli()
            ));

            byte[] signature = Ed25519Util.sign(privateKeyBytes, auditJson.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            String signatureB64 = Base64.getEncoder().encodeToString(signature);

            builder.header("X-Luban-Audit", auditJson);
            builder.header("X-Luban-Signature", "ed25519=" + signatureB64);
        } catch (Exception e) {
            log.warn("Failed to sign request for tool: {}", tool.getName(), e);
        }
    }

    private String executeWithRetry(HttpRequest request) {
        Exception lastException = null;
        for (int attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() >= 200 && response.statusCode() < 300) {
                    return response.body();
                }
                return errorJson("HTTP " + response.statusCode() + ": " + response.body());
            } catch (Exception e) {
                lastException = e;
                if (attempt < MAX_RETRIES - 1) {
                    try {
                        long waitMs = (long) Math.pow(2, attempt) * 1000;
                        Thread.sleep(waitMs);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            }
        }
        return errorJson("HTTP request failed after " + MAX_RETRIES + " retries: " +
                (lastException != null ? lastException.getMessage() : "unknown"));
    }

    private String resolveUrl(String url, Map<String, Object> arguments) {
        String resolved = url;
        for (Map.Entry<String, Object> entry : arguments.entrySet()) {
            resolved = resolved.replace("{" + entry.getKey() + "}", entry.getValue().toString());
        }
        return resolved;
    }

    private String errorJson(String message) {
        return "{\"error\": \"" + message.replace("\"", "\\\"") + "\"}";
    }
}