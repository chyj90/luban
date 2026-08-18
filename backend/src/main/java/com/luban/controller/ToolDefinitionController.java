package com.luban.controller;

import com.luban.entity.ToolDefinition;
import com.luban.executor.HttpExecutor;
import com.luban.executor.McpExecutor;
import com.luban.executor.SqlExecutor;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.service.ToolEmbeddingService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/tools")
@RequiredArgsConstructor
public class ToolDefinitionController {

    private final ToolDefinitionRepository toolDefinitionRepository;
    private final ToolEmbeddingService toolEmbeddingService;
    private final HttpExecutor httpExecutor;
    private final SqlExecutor sqlExecutor;
    private final McpExecutor mcpExecutor;

    @GetMapping("/systems")
    public ResponseEntity<List<Map<String, Object>>> listSystems() {
        List<ToolDefinition> tools = toolDefinitionRepository.findByStatus("ENABLED");
        Map<Long, Map<String, Object>> systemMap = new LinkedHashMap<>();
        for (ToolDefinition tool : tools) {
            Long groupId = tool.getGroupId();
            if (!systemMap.containsKey(groupId)) {
                Map<String, Object> system = new LinkedHashMap<>();
                system.put("groupId", groupId);
                system.put("toolCount", 0);
                systemMap.put(groupId, system);
            }
            Map<String, Object> system = systemMap.get(groupId);
            system.put("toolCount", (int) system.get("toolCount") + 1);
        }
        return ResponseEntity.ok(new ArrayList<>(systemMap.values()));
    }

    @GetMapping("/search")
    public ResponseEntity<List<Map<String, Object>>> searchTools(
            @RequestParam Long systemId,
            @RequestParam String query) {
        List<ToolDefinition> results = toolEmbeddingService.search(systemId, query, 5);
        List<Map<String, Object>> response = results.stream()
                .map(this::toToolSummary)
                .collect(Collectors.toList());
        return ResponseEntity.ok(response);
    }

    @GetMapping("/{id}/schema")
    public ResponseEntity<Map<String, Object>> getToolSchema(@PathVariable Long id) {
        return toolDefinitionRepository.findById(id)
                .map(tool -> {
                    Map<String, Object> schema = new LinkedHashMap<>();
                    schema.put("name", tool.getName());
                    schema.put("description", tool.getDescription());
                    schema.put("input_schema", tool.getInputSchema());
                    schema.put("output_schema", tool.getOutputSchema());
                    return ResponseEntity.ok(schema);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{id}/test")
    public ResponseEntity<Map<String, Object>> testTool(
            @PathVariable Long id,
            @RequestBody Map<String, Object> arguments) {
        return toolDefinitionRepository.findById(id)
                .map(tool -> {
                    long start = System.currentTimeMillis();
                    String result;
                    try {
                        result = executeTool(tool, arguments);
                    } catch (Exception e) {
                        result = "{\"error\": \"" + e.getMessage().replace("\"", "\\\"") + "\"}";
                    }
                    long elapsed = System.currentTimeMillis() - start;

                    Map<String, Object> response = new LinkedHashMap<>();
                    response.put("tool_name", tool.getName());
                    response.put("result", result);
                    response.put("elapsed_ms", elapsed);
                    return ResponseEntity.ok(response);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    private String executeTool(ToolDefinition tool, Map<String, Object> arguments) {
        switch (tool.getToolType()) {
            case "HTTP":
                return httpExecutor.execute(tool, arguments, "test");
            case "SQL":
                return sqlExecutor.execute(tool, arguments);
            case "MCP_PASSTHROUGH":
                return mcpExecutor.execute(tool, arguments);
            default:
                return "{\"error\": \"Unsupported tool type: " + tool.getToolType() + "\"}";
        }
    }

    private Map<String, Object> toToolSummary(ToolDefinition tool) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("id", tool.getId());
        summary.put("name", tool.getName());
        summary.put("displayName", tool.getDisplayName());
        summary.put("description", tool.getDescription());
        summary.put("toolType", tool.getToolType());
        return summary;
    }
}