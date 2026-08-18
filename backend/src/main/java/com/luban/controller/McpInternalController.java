package com.luban.controller;

import com.luban.entity.ToolDefinition;
import com.luban.executor.HttpExecutor;
import com.luban.executor.McpExecutor;
import com.luban.executor.SqlExecutor;
import com.luban.repository.ToolDefinitionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/mcp/internal")
@RequiredArgsConstructor
public class McpInternalController {

    private final ToolDefinitionRepository toolDefinitionRepository;
    private final HttpExecutor httpExecutor;
    private final SqlExecutor sqlExecutor;
    private final McpExecutor mcpExecutor;

    @GetMapping("/tools/list")
    public ResponseEntity<List<Map<String, Object>>> listTools() {
        List<ToolDefinition> tools = toolDefinitionRepository.findByStatus("ENABLED");
        List<Map<String, Object>> toolList = tools.stream()
                .map(tool -> {
                    Map<String, Object> t = new LinkedHashMap<>();
                    t.put("name", tool.getName());
                    t.put("description", tool.getDescription());
                    t.put("type", tool.getToolType());
                    t.put("input_schema", tool.getInputSchema() != null ? tool.getInputSchema() : "{}");
                    return t;
                })
                .collect(Collectors.toList());
        return ResponseEntity.ok(toolList);
    }

    @PostMapping("/tools/call")
    public ResponseEntity<Map<String, Object>> callTool(@RequestBody Map<String, Object> request) {
        String toolName = (String) request.get("name");
        @SuppressWarnings("unchecked")
        Map<String, Object> arguments = (Map<String, Object>) request.getOrDefault("arguments", Map.of());

        if (toolName == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "缺少 tool name"));
        }

        Optional<ToolDefinition> toolOpt = toolDefinitionRepository.findByName(toolName);
        if (toolOpt.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "工具不存在",
                    "tool", toolName
            ));
        }

        ToolDefinition tool = toolOpt.get();
        if (!"ENABLED".equals(tool.getStatus())) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "工具已禁用",
                    "tool", toolName
            ));
        }

        long start = System.currentTimeMillis();
        String result;
        try {
            result = executeTool(tool, arguments);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of(
                    "error", e.getMessage(),
                    "tool", toolName
            ));
        }
        long elapsed = System.currentTimeMillis() - start;

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("tool", toolName);
        response.put("result", result);
        response.put("elapsed_ms", elapsed);
        return ResponseEntity.ok(response);
    }

    private String executeTool(ToolDefinition tool, Map<String, Object> arguments) {
        switch (tool.getToolType()) {
            case "HTTP":
                return httpExecutor.execute(tool, arguments, "internal");
            case "SQL":
                return sqlExecutor.execute(tool, arguments);
            case "MCP_PASSTHROUGH":
                return mcpExecutor.execute(tool, arguments);
            default:
                return "{\"error\": \"Unsupported tool type: " + tool.getToolType() + "\"}";
        }
    }
}