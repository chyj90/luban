package com.luban.mcp;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public class McpClientConnection {

    private static final Logger log = LoggerFactory.getLogger(McpClientConnection.class);
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(10);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(30);

    private final String serverUrl;
    private final Map<String, String> authHeaders;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;
    private String sessionId;
    private String serverName;
    private String serverVersion;
    private boolean initialized;

    public McpClientConnection(String serverUrl, Map<String, String> authHeaders) {
        this.serverUrl = serverUrl;
        this.authHeaders = authHeaders != null ? authHeaders : Map.of();
        this.objectMapper = new ObjectMapper();
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(CONNECT_TIMEOUT)
                .build();
    }

    public boolean connect() {
        try {
            URI sseUri = URI.create(serverUrl);
            if (!serverUrl.endsWith("/sse")) {
                sseUri = URI.create(serverUrl.endsWith("/") ? serverUrl + "sse" : serverUrl + "/sse");
            }

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(sseUri)
                    .header("Accept", "text/event-stream")
                    .timeout(CONNECT_TIMEOUT)
                    .GET()
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                log.warn("MCP SSE connection failed: HTTP {}", response.statusCode());
                return false;
            }

            String body = response.body();
            String extractedSessionId = extractSessionId(body);
            if (extractedSessionId == null) {
                extractedSessionId = UUID.randomUUID().toString();
            }
            this.sessionId = extractedSessionId;

            Map<String, Object> initResult = sendRequest("initialize", Map.of(
                    "protocolVersion", "2024-11-05",
                    "clientInfo", Map.of("name", "Luban", "version", "1.0.0"),
                    "capabilities", Map.of()
            ));

            if (initResult != null) {
                this.serverName = (String) initResult.getOrDefault("serverInfo", Map.of()).toString();
                this.serverVersion = (String) initResult.getOrDefault("protocolVersion", "unknown");
                this.initialized = true;
            }

            sendNotification("notifications/initialized", Map.of());

            return initialized;
        } catch (Exception e) {
            log.error("MCP client connection failed: {}", serverUrl, e);
            return false;
        }
    }

    public List<Map<String, Object>> discoverTools() {
        if (!initialized) {
            return List.of();
        }
        try {
            Map<String, Object> result = sendRequest("tools/list", Map.of());
            if (result != null && result.containsKey("tools")) {
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> tools = (List<Map<String, Object>>) result.get("tools");
                return tools;
            }
            return List.of();
        } catch (Exception e) {
            log.error("Failed to discover tools from MCP server: {}", serverUrl, e);
            return List.of();
        }
    }

    public String callTool(String toolName, Map<String, Object> arguments) {
        if (!initialized) {
            return "{\"error\": \"MCP client not initialized\"}";
        }
        try {
            Map<String, Object> result = sendRequest("tools/call", Map.of(
                    "name", toolName,
                    "arguments", arguments
            ));
            return objectMapper.writeValueAsString(result);
        } catch (Exception e) {
            log.error("Failed to call MCP tool: {}", toolName, e);
            return "{\"error\": \"" + e.getMessage() + "\"}";
        }
    }

    public void disconnect() {
        if (initialized && sessionId != null) {
            try {
                sendNotification("notifications/cancelled", Map.of("reason", "client disconnect"));
            } catch (Exception ignored) {
            }
            initialized = false;
            sessionId = null;
        }
    }

    public boolean isConnected() {
        return initialized;
    }

    private Map<String, Object> sendRequest(String method, Map<String, Object> params) {
        try {
            String baseUrl = serverUrl;
            if (baseUrl.endsWith("/sse")) {
                baseUrl = baseUrl.substring(0, baseUrl.length() - 4);
            }

            String messageUrl = baseUrl.endsWith("/") ? baseUrl + "message" : baseUrl + "/message";

            String fullUrl = messageUrl + "?sessionId=" + sessionId;

            Map<String, Object> requestBody = new LinkedHashMap<>();
            requestBody.put("jsonrpc", "2.0");
            requestBody.put("method", method);
            requestBody.put("params", params != null ? params : Map.of());
            requestBody.put("id", UUID.randomUUID().toString());

            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(fullUrl))
                    .header("Content-Type", "application/json")
                    .timeout(REQUEST_TIMEOUT)
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(requestBody)));

            authHeaders.forEach(builder::header);

            HttpResponse<String> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 200) {
                Map<String, Object> result = objectMapper.readValue(response.body(),
                        new TypeReference<Map<String, Object>>() {});
                @SuppressWarnings("unchecked")
                Map<String, Object> rpcResult = (Map<String, Object>) result.get("result");
                return rpcResult;
            }
            return null;
        } catch (Exception e) {
            log.error("MCP request failed: {}", method, e);
            return null;
        }
    }

    private void sendNotification(String method, Map<String, Object> params) {
        try {
            String baseUrl = serverUrl;
            if (baseUrl.endsWith("/sse")) {
                baseUrl = baseUrl.substring(0, baseUrl.length() - 4);
            }
            String messageUrl = baseUrl.endsWith("/") ? baseUrl + "message" : baseUrl + "/message";
            String fullUrl = messageUrl + "?sessionId=" + sessionId;

            Map<String, Object> requestBody = new LinkedHashMap<>();
            requestBody.put("jsonrpc", "2.0");
            requestBody.put("method", method);
            requestBody.put("params", params != null ? params : Map.of());

            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(fullUrl))
                    .header("Content-Type", "application/json")
                    .timeout(REQUEST_TIMEOUT)
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(requestBody)));

            authHeaders.forEach(builder::header);

            httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        } catch (Exception e) {
            log.debug("MCP notification failed: {}", method, e.getMessage());
        }
    }

    private String extractSessionId(String sseBody) {
        for (String line : sseBody.split("\n")) {
            if (line.startsWith("data: ")) {
                String data = line.substring(6).trim();
                try {
                    Map<String, Object> map = objectMapper.readValue(data,
                            new TypeReference<Map<String, Object>>() {});
                    if (map.containsKey("sessionId")) {
                        return map.get("sessionId").toString();
                    }
                } catch (Exception ignored) {
                }
            }
        }
        return null;
    }
}