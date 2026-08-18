package com.luban.mcp;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.ToolDefinition;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.repository.ToolGroupRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.*;

@Slf4j
@Component
@RequiredArgsConstructor
public class McpMethodRouter {

    private final ToolDefinitionRepository toolDefinitionRepository;
    private final ToolGroupRepository toolGroupRepository;
    private final ObjectMapper objectMapper;

    public JsonRpcResponse dispatch(JsonRpcRequest request) {
        try {
            return switch (request.getMethod()) {
                case "initialize" -> handleInitialize(request);
                case "tools/list" -> handleToolsList(request);
                case "tools/call" -> handleToolsCall(request);
                case "ping" -> handlePing(request);
                default -> JsonRpcResponse.error(request.getId(), -32601,
                        "Method not found: " + request.getMethod(), null);
            };
        } catch (Exception e) {
            log.error("MCP method dispatch error: {}", e.getMessage(), e);
            return JsonRpcResponse.error(request.getId(), -32603,
                    "Internal error: " + e.getMessage(), null);
        }
    }

    private JsonRpcResponse handleInitialize(JsonRpcRequest request) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("protocolVersion", "2024-11-05");
        result.put("serverInfo", Map.of(
                "name", "luban-mcp",
                "version", "1.0.0"
        ));
        result.put("capabilities", Map.of(
                "tools", Map.of("listChanged", false)
        ));
        return JsonRpcResponse.success(request.getId(), result);
    }

    private JsonRpcResponse handlePing(JsonRpcRequest request) {
        return JsonRpcResponse.success(request.getId(), Map.of());
    }

    private JsonRpcResponse handleToolsList(JsonRpcRequest request) {
        List<ToolDefinition> tools = toolDefinitionRepository.findByStatus("ENABLED");
        List<Map<String, Object>> toolList = new ArrayList<>();

        for (ToolDefinition tool : tools) {
            Map<String, Object> toolMap = new LinkedHashMap<>();
            toolMap.put("name", tool.getName());
            toolMap.put("description", tool.getDescription());
            try {
                Object schema = objectMapper.readValue(
                        tool.getInputSchema() != null ? tool.getInputSchema() : "{}",
                        Object.class);
                toolMap.put("inputSchema", schema);
            } catch (Exception e) {
                toolMap.put("inputSchema", Map.of("type", "object", "properties", Map.of()));
            }
            toolList.add(toolMap);
        }

        Map<String, Object> result = Map.of("tools", toolList);
        return JsonRpcResponse.success(request.getId(), result);
    }

    private JsonRpcResponse handleToolsCall(JsonRpcRequest request) {
        @SuppressWarnings("unchecked")
        Map<String, Object> params = request.getParams();
        String toolName = (String) params.get("name");
        @SuppressWarnings("unchecked")
        Map<String, Object> arguments = (Map<String, Object>) params.getOrDefault("arguments", Map.of());

        if (toolName == null) {
            return JsonRpcResponse.error(request.getId(), -32602, "Missing tool name", null);
        }

        ToolDefinition tool = toolDefinitionRepository.findByName(toolName).orElse(null);
        if (tool == null) {
            return JsonRpcResponse.error(request.getId(), -32602,
                    "Tool not found: " + toolName, null);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("content", List.of(Map.of(
                "type", "text",
                "text", "Tool '" + toolName + "' called with arguments: " + arguments +
                        " (execution not yet implemented)"
        )));
        return JsonRpcResponse.success(request.getId(), result);
    }
}