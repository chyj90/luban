package com.luban.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class CodeExecutorService {

    private final ObjectMapper objectMapper;

    @Value("${embedding.service.url:http://localhost:8765}")
    private String codeExecutorUrl;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(java.time.Duration.ofSeconds(10))
            .build();

    public boolean isHealthy() {
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(codeExecutorUrl + "/health"))
                    .GET()
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            return resp.statusCode() == 200;
        } catch (Exception e) {
            log.warn("Code executor health check failed: {}", e.getMessage());
            return false;
        }
    }

    public Map<String, Object> execute(String code, Map<String, Object> inputData) {
        try {
            Map<String, Object> body = Map.of("code", code, "input_data", inputData != null ? inputData : Map.of());
            String json = objectMapper.writeValueAsString(body);
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(codeExecutorUrl + "/v1/execute-code"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                log.error("Code execution failed: HTTP {} - {}", resp.statusCode(), resp.body());
                return Map.of("success", false, "stderr", "HTTP " + resp.statusCode());
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> result = objectMapper.readValue(resp.body(), Map.class);
            return result;
        } catch (Exception e) {
            log.error("Code execution error: {}", e.getMessage());
            return Map.of("success", false, "stderr", e.getMessage());
        }
    }
}