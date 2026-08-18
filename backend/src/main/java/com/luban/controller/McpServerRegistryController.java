package com.luban.controller;

import com.luban.entity.McpServerRegistry;
import com.luban.entity.ToolDefinition;
import com.luban.entity.ToolGroup;
import com.luban.mcp.McpClientConnection;
import com.luban.repository.McpServerRegistryRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.repository.ToolGroupRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

@Slf4j
@RestController
@RequestMapping("/api/v1/mcp-servers")
@RequiredArgsConstructor
public class McpServerRegistryController {

    private final McpServerRegistryRepository mcpServerRegistryRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final ToolGroupRepository toolGroupRepository;

    @GetMapping
    public ResponseEntity<List<McpServerRegistry>> listServers() {
        return ResponseEntity.ok(mcpServerRegistryRepository.findAll());
    }

    @PostMapping
    public ResponseEntity<McpServerRegistry> registerServer(@RequestBody McpServerRegistry server) {
        server.setId(null);
        server.setStatus("ENABLED");
        return ResponseEntity.ok(mcpServerRegistryRepository.save(server));
    }

    @PutMapping("/{id}")
    public ResponseEntity<McpServerRegistry> updateServer(@PathVariable Long id,
                                                          @RequestBody McpServerRegistry update) {
        return mcpServerRegistryRepository.findById(id)
                .map(server -> {
                    if (update.getName() != null) server.setName(update.getName());
                    if (update.getDescription() != null) server.setDescription(update.getDescription());
                    if (update.getServerUrl() != null) server.setServerUrl(update.getServerUrl());
                    if (update.getAuthType() != null) server.setAuthType(update.getAuthType());
                    if (update.getAuthConfig() != null) server.setAuthConfig(update.getAuthConfig());
                    if (update.getSyncInterval() != null) server.setSyncInterval(update.getSyncInterval());
                    return ResponseEntity.ok(mcpServerRegistryRepository.save(server));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> deleteServer(@PathVariable Long id) {
        return mcpServerRegistryRepository.findById(id)
                .map(server -> {
                    mcpServerRegistryRepository.delete(server);
                    Map<String, Object> body = new LinkedHashMap<>();
                    body.put("deleted", true);
                    body.put("id", id);
                    return ResponseEntity.ok(body);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{id}/test")
    public ResponseEntity<Map<String, Object>> testConnection(@PathVariable Long id) {
        return mcpServerRegistryRepository.findById(id)
                .map(server -> {
                    Map<String, Object> result = new LinkedHashMap<>();
                    result.put("serverId", id);
                    result.put("serverName", server.getName());
                    long start = System.currentTimeMillis();

                    McpClientConnection connection = buildConnection(server);
                    try {
                        boolean connected = connection.connect();
                        long elapsed = System.currentTimeMillis() - start;
                        result.put("connected", connected);
                        result.put("elapsedMs", elapsed);
                        if (connected) {
                            result.put("serverInfo", "Protocol version: 2024-11-05");
                            connection.disconnect();
                        }
                    } catch (Exception e) {
                        long elapsed = System.currentTimeMillis() - start;
                        result.put("connected", false);
                        result.put("elapsedMs", elapsed);
                        result.put("error", e.getMessage());
                    }
                    return ResponseEntity.ok(result);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{id}/discover")
    public ResponseEntity<Map<String, Object>> discoverTools(@PathVariable Long id) {
        return mcpServerRegistryRepository.findById(id)
                .map(server -> {
                    Map<String, Object> result = new LinkedHashMap<>();
                    result.put("serverId", id);
                    result.put("serverName", server.getName());

                    McpClientConnection connection = buildConnection(server);
                    try {
                        if (!connection.connect()) {
                            result.put("error", "连接 MCP Server 失败");
                            return ResponseEntity.ok(result);
                        }
                        List<Map<String, Object>> tools = connection.discoverTools();
                        result.put("tools", tools);
                        result.put("toolCount", tools.size());
                        connection.disconnect();
                    } catch (Exception e) {
                        result.put("error", e.getMessage());
                    }
                    return ResponseEntity.ok(result);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{id}/sync")
    public ResponseEntity<Map<String, Object>> syncTools(@PathVariable Long id,
                                                          @RequestParam Long groupId) {
        return mcpServerRegistryRepository.findById(id)
                .map(server -> {
                    Map<String, Object> result = new LinkedHashMap<>();
                    result.put("serverId", id);
                    result.put("serverName", server.getName());

                    ToolGroup group = toolGroupRepository.findById(groupId).orElse(null);
                    if (group == null) {
                        result.put("error", "工具组不存在");
                        return ResponseEntity.ok(result);
                    }

                    McpClientConnection connection = buildConnection(server);
                    try {
                        if (!connection.connect()) {
                            result.put("error", "连接 MCP Server 失败");
                            return ResponseEntity.ok(result);
                        }

                        List<Map<String, Object>> remoteTools = connection.discoverTools();
                        List<Map<String, Object>> synced = new ArrayList<>();
                        int created = 0;
                        int updated = 0;

                        for (Map<String, Object> remoteTool : remoteTools) {
                            String toolName = (String) remoteTool.get("name");
                            if (toolName == null) continue;

                            String description = (String) remoteTool.getOrDefault("description", "");
                            @SuppressWarnings("unchecked")
                            Map<String, Object> inputSchema = (Map<String, Object>) remoteTool.get("inputSchema");

                            Optional<ToolDefinition> existing = toolDefinitionRepository.findByName(toolName);
                            ToolDefinition tool;
                            if (existing.isPresent()) {
                                tool = existing.get();
                                tool.setDescription(description);
                                if (inputSchema != null) {
                                    tool.setInputSchema(toJson(inputSchema));
                                }
                                updated++;
                            } else {
                                tool = new ToolDefinition();
                                tool.setName(toolName);
                                tool.setDisplayName(toolName);
                                tool.setToolType("MCP_PASSTHROUGH");
                                tool.setDescription(description);
                                tool.setConfig("{\"mcpServerId\":" + id + ",\"remoteToolName\":\"" + toolName + "\"}");
                                tool.setGroupId(groupId);
                                tool.setStatus("ENABLED");
                                if (inputSchema != null) {
                                    tool.setInputSchema(toJson(inputSchema));
                                }
                                created++;
                            }
                            toolDefinitionRepository.save(tool);

                            Map<String, Object> syncedTool = new LinkedHashMap<>();
                            syncedTool.put("name", toolName);
                            syncedTool.put("description", description);
                            syncedTool.put("action", existing.isPresent() ? "updated" : "created");
                            synced.add(syncedTool);
                        }

                        connection.disconnect();

                        server.setLastSyncAt(LocalDateTime.now());
                        server.setLastSyncStatus("SUCCESS");
                        mcpServerRegistryRepository.save(server);

                        result.put("created", created);
                        result.put("updated", updated);
                        result.put("synced", synced);
                    } catch (Exception e) {
                        server.setLastSyncStatus("FAILED");
                        mcpServerRegistryRepository.save(server);
                        result.put("error", e.getMessage());
                    }
                    return ResponseEntity.ok(result);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    private McpClientConnection buildConnection(McpServerRegistry server) {
        Map<String, String> authHeaders = new LinkedHashMap<>();
        if ("BEARER".equalsIgnoreCase(server.getAuthType()) && server.getAuthConfig() != null) {
            try {
                authHeaders.put("Authorization", "Bearer " + server.getAuthConfig());
            } catch (Exception ignored) {
            }
        } else if ("API_KEY".equalsIgnoreCase(server.getAuthType()) && server.getAuthConfig() != null) {
            authHeaders.put("X-API-Key", server.getAuthConfig());
        }
        return new McpClientConnection(server.getServerUrl(), authHeaders);
    }

    private String toJson(Object obj) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(obj);
        } catch (Exception e) {
            return "{}";
        }
    }
}