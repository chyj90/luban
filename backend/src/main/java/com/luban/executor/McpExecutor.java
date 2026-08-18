package com.luban.executor;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.McpServerRegistry;
import com.luban.entity.ToolDefinition;
import com.luban.mcp.McpClientConnection;
import com.luban.repository.McpServerRegistryRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class McpExecutor {

    private static final Logger log = LoggerFactory.getLogger(McpExecutor.class);

    private final McpServerRegistryRepository mcpServerRegistryRepository;
    private final ObjectMapper objectMapper;
    private final ConcurrentHashMap<Long, McpClientConnection> connections = new ConcurrentHashMap<>();

    public McpExecutor(McpServerRegistryRepository mcpServerRegistryRepository, ObjectMapper objectMapper) {
        this.mcpServerRegistryRepository = mcpServerRegistryRepository;
        this.objectMapper = objectMapper;
    }

    public String execute(ToolDefinition tool, Map<String, Object> arguments) {
        try {
            Map<String, Object> config = objectMapper.readValue(tool.getConfig(), Map.class);
            Long mcpServerId = config.containsKey("mcpServerId") ? ((Number) config.get("mcpServerId")).longValue() : null;
            String originalToolName = (String) config.get("originalToolName");

            if (mcpServerId == null || originalToolName == null) {
                return errorJson("MCP_PASSTHROUGH tool requires mcpServerId and originalToolName in config");
            }

            McpClientConnection connection = connections.computeIfAbsent(mcpServerId, id -> {
                McpServerRegistry server = mcpServerRegistryRepository.findById(id).orElse(null);
                if (server == null) return null;

                Map<String, String> authHeaders = new java.util.HashMap<>();
                if (server.getAuthConfig() != null) {
                    try {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> authConfig = objectMapper.readValue(server.getAuthConfig(), Map.class);
                        if ("BEARER".equalsIgnoreCase(server.getAuthType())) {
                            authHeaders.put("Authorization", "Bearer " + authConfig.get("token"));
                        } else if ("API_KEY".equalsIgnoreCase(server.getAuthType())) {
                            String headerName = (String) authConfig.getOrDefault("headerName", "X-API-Key");
                            authHeaders.put(headerName, (String) authConfig.get("value"));
                        }
                    } catch (Exception ignored) {
                        Object value = server.getAuthConfig();
                        if (value != null && "BEARER".equalsIgnoreCase(server.getAuthType())) {
                            authHeaders.put("Authorization", "Bearer " + value);
                        }
                    }
                }

                McpClientConnection conn = new McpClientConnection(server.getServerUrl(), authHeaders);
                if (conn.connect()) {
                    return conn;
                }
                return null;
            });

            if (connection == null || !connection.isConnected()) {
                connections.remove(mcpServerId);
                return errorJson("Failed to connect to MCP server");
            }

            return connection.callTool(originalToolName, arguments);
        } catch (Exception e) {
            log.error("MCP executor failed for tool: {}", tool.getName(), e);
            return errorJson("MCP execution failed: " + e.getMessage());
        }
    }

    public void disconnectAll() {
        connections.values().forEach(McpClientConnection::disconnect);
        connections.clear();
    }

    private String errorJson(String message) {
        return "{\"error\": \"" + message.replace("\"", "\\\"") + "\"}";
    }
}