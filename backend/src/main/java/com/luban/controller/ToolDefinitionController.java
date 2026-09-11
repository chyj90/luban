package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.constant.ToolType;
import com.luban.dto.ApiResponse;
import com.luban.entity.AlgorithmExecutionLog;
import com.luban.entity.ToolDefinition;
import com.luban.entity.User;
import com.luban.executor.HttpExecutor;
import com.luban.executor.McpExecutor;
import com.luban.repository.AlgorithmExecutionLogRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.service.ApiKeyService;
import com.luban.service.CodeExecutorService;
import com.luban.service.ToolEmbeddingService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/tools")
@RequiredArgsConstructor
public class ToolDefinitionController {

    private final ToolDefinitionRepository toolDefinitionRepository;
    private final ToolEmbeddingService toolEmbeddingService;
    private final HttpExecutor httpExecutor;
    private final McpExecutor mcpExecutor;
    private final ApiKeyService apiKeyService;
    private final HttpServletRequest request;
    private final CodeExecutorService codeExecutorService;
    private final AlgorithmExecutionLogRepository algorithmExecutionLogRepository;

    @Value("${luban.algorithms.storage-path:algorithms}")
    private String algorithmsStoragePath;

    @GetMapping("/types")
    public ResponseEntity<ApiResponse<List<Map<String, String>>>> listToolTypes() {
        return ResponseEntity.ok(ApiResponse.ok(ToolType.toList()));
    }

    @GetMapping("/systems")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> listSystems() {
        List<ToolDefinition> tools = toolDefinitionRepository.findByScope("PLATFORM");
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
        return ResponseEntity.ok(ApiResponse.ok(new ArrayList<>(systemMap.values())));
    }

    @GetMapping("/search")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> searchTools(
            @RequestParam Long systemId,
            @RequestParam String query) {
        List<ToolDefinition> results = toolEmbeddingService.search(systemId, query, 5);
        List<Map<String, Object>> response = results.stream()
                .map(this::toToolSummary)
                .collect(Collectors.toList());
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    @GetMapping("/{id}/schema")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getToolSchema(@PathVariable Long id) {
        return toolDefinitionRepository.findById(id)
                .map(tool -> {
                    Map<String, Object> schema = new LinkedHashMap<>();
                    schema.put("name", tool.getName());
                    schema.put("description", tool.getDescription());
                    schema.put("input_schema", tool.getInputSchema());
                    schema.put("output_schema", tool.getOutputSchema());
                    return ResponseEntity.ok(ApiResponse.ok(schema));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @RequirePermission("connect:tools")
    @PostMapping("/{id}/test")
    public ResponseEntity<ApiResponse<Map<String, Object>>> testTool(
            @PathVariable Long id,
            @RequestBody Map<String, Object> arguments,
            @AuthenticationPrincipal User user) {
        return toolDefinitionRepository.findById(id)
                .map(tool -> {
                    Long apiKeyId = (Long) request.getAttribute("api_key_id");
                    if (apiKeyId != null) {
                        Map<String, Object> err = new LinkedHashMap<>();
                        err.put("error", "API KEY 无权调用 /test 端点，请通过 SDK 调用");
                        return ResponseEntity.status(403).body(ApiResponse.ok(err));
                    }

                    if (!tool.getCreatedBy().equals(user.getId())) {
                        Map<String, Object> err = new LinkedHashMap<>();
                        err.put("error", "只能测试自己创建的工具");
                        err.put("tool_name", tool.getName());
                        return ResponseEntity.status(403).body(ApiResponse.ok(err));
                    }

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
                    return ResponseEntity.ok(ApiResponse.ok(response));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    private String executeTool(ToolDefinition tool, Map<String, Object> arguments) {
        ToolType toolType = tool.getToolType();
        return switch (toolType) {
            case HTTP -> httpExecutor.execute(tool, arguments, "test");
            case MCP_PASSTHROUGH -> mcpExecutor.execute(tool, arguments);
            case ORCHESTRATION -> "{\"error\": \"请通过编排端点调用 ORCHESTRATION 工具\"}";
            case ALGORITHM -> {
                com.luban.service.algorithm.AlgorithmConfig config = com.luban.service.algorithm.AlgorithmConfig.parse(tool.getConfig());
                if (config.getScriptPath() == null || config.getScriptPath().isBlank()) {
                    yield "{\"error\": \"算法未上传脚本\"}";
                }
                Map<String, Object> result = codeExecutorService.executeScript(config.getScriptPath(), arguments, config.getTimeout());
                try {
                    yield new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(result);
                } catch (Exception e) {
                    yield "{\"error\": \"结果序列化失败: " + e.getMessage().replace("\"", "\\\"") + "\"}";
                }
            }
        };
    }

    private Map<String, Object> toToolSummary(ToolDefinition tool) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("id", tool.getId());
        summary.put("name", tool.getName());
        summary.put("displayName", tool.getDisplayName());
        summary.put("description", tool.getDescription());
        summary.put("toolType", tool.getToolType().getValue());
        return summary;
    }

    @PostMapping("/{id}/script")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> uploadScript(
            @PathVariable Long id,
            @RequestParam("file") MultipartFile file) {
        var opt = toolDefinitionRepository.findById(id);
        if (opt.isEmpty()) return ResponseEntity.notFound().build();
        ToolDefinition tool = opt.get();
        if (tool.getToolType() != ToolType.ALGORITHM) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(ApiResponse.error("仅 ALGORITHM 类型工具支持脚本上传"));
        }

        String originalFilename = file.getOriginalFilename();
        if (originalFilename == null || originalFilename.isBlank()) {
            originalFilename = tool.getName() + ".py";
        }
        if (!originalFilename.endsWith(".py")) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(ApiResponse.error("仅支持 .py 文件上传"));
        }
        if (file.getSize() > 10 * 1024 * 1024) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(ApiResponse.error("脚本文件大小不能超过 10MB"));
        }

        java.nio.file.Path dir = java.nio.file.Path.of(algorithmsStoragePath);
        java.nio.file.Path target = dir.resolve(originalFilename).normalize();
        if (!target.startsWith(dir.normalize())) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(ApiResponse.error("文件路径穿越检测：不允许包含 .. 的路径"));
        }

        try {
            String content = new String(file.getBytes(), java.nio.charset.StandardCharsets.UTF_8);
            java.util.List<String> dangerous = java.util.List.of("os.system", "subprocess.call", "subprocess.Popen", "socket.connect", "shutil.rmtree", "eval(", "exec(");
            java.util.List<String> found = new java.util.ArrayList<>();
            for (String d : dangerous) {
                if (content.contains(d)) found.add(d);
            }
            if (!found.isEmpty()) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                        .body(ApiResponse.error("脚本包含危险调用: " + String.join(", ", found) + "，请移除后重试"));
            }

            if (!content.contains("def main(") && !content.contains("def solve(")) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                        .body(ApiResponse.error("脚本必须包含 main() 或 solve() 入口函数"));
            }
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(ApiResponse.error("脚本内容读取失败: " + e.getMessage()));
        }

        try {
            java.nio.file.Files.createDirectories(dir);

            com.luban.service.algorithm.AlgorithmConfig existingConfig = com.luban.service.algorithm.AlgorithmConfig.parse(tool.getConfig());
            if (existingConfig.getScriptPath() != null && !existingConfig.getScriptPath().isBlank()) {
                java.nio.file.Path existingScript = dir.resolve(existingConfig.getScriptPath());
                if (java.nio.file.Files.exists(existingScript)) {
                    java.nio.file.Path backupDir = dir.resolve("backups");
                    java.nio.file.Files.createDirectories(backupDir);
                    String timestamp = java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("yyyyMMddHHmmss"));
                    java.nio.file.Path backup = backupDir.resolve(existingConfig.getScriptPath() + "." + timestamp + ".bak");
                    java.nio.file.Files.copy(existingScript, backup);

                    java.util.List<java.nio.file.Path> backups = java.nio.file.Files.list(backupDir)
                            .filter(p -> p.getFileName().toString().startsWith(existingConfig.getScriptPath()) && p.getFileName().toString().endsWith(".bak"))
                            .sorted()
                            .collect(java.util.stream.Collectors.toList());
                    while (backups.size() > 5) {
                        java.nio.file.Files.deleteIfExists(backups.remove(0));
                    }
                }
            }

            java.nio.file.Files.write(target, file.getBytes());

            com.luban.service.algorithm.AlgorithmConfig config = com.luban.service.algorithm.AlgorithmConfig.parse(tool.getConfig());
            config.setScriptPath(originalFilename);
            com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            tool.setConfig(mapper.writeValueAsString(config));
            toolDefinitionRepository.save(tool);

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("scriptPath", originalFilename);
            result.put("size", file.getSize());
            return ResponseEntity.ok(ApiResponse.ok(result));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(ApiResponse.error("脚本上传失败: " + e.getMessage()));
        }
    }

    @GetMapping("/{id}/script")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> getScriptContent(@PathVariable Long id) {
        var opt = toolDefinitionRepository.findById(id);
        if (opt.isEmpty()) return ResponseEntity.notFound().build();
        ToolDefinition tool = opt.get();
        if (tool.getToolType() != ToolType.ALGORITHM) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(ApiResponse.error("仅 ALGORITHM 类型工具支持脚本操作"));
        }
        com.luban.service.algorithm.AlgorithmConfig config = com.luban.service.algorithm.AlgorithmConfig.parse(tool.getConfig());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("scriptPath", config.getScriptPath());
        if (config.getScriptPath() != null && !config.getScriptPath().isBlank()) {
            java.nio.file.Path scriptFile = java.nio.file.Path.of(algorithmsStoragePath, config.getScriptPath());
            if (java.nio.file.Files.exists(scriptFile)) {
                try {
                    String content = java.nio.file.Files.readString(scriptFile, java.nio.charset.StandardCharsets.UTF_8);
                    result.put("content", content);
                    result.put("size", java.nio.file.Files.size(scriptFile));
                } catch (Exception e) {
                    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                            .body(ApiResponse.error("脚本读取失败: " + e.getMessage()));
                }
            } else {
                result.put("content", "");
            }
        } else {
            result.put("content", "");
        }
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    @PutMapping("/{id}/script")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> updateScriptContent(
            @PathVariable Long id,
            @RequestBody Map<String, String> body) {
        var opt = toolDefinitionRepository.findById(id);
        if (opt.isEmpty()) return ResponseEntity.notFound().build();
        ToolDefinition tool = opt.get();
        if (tool.getToolType() != ToolType.ALGORITHM) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(ApiResponse.error("仅 ALGORITHM 类型工具支持脚本操作"));
        }
        String content = body.get("content");
        if (content == null || content.isBlank()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(ApiResponse.error("脚本内容不能为空"));
        }
        if (content.length() > 10 * 1024 * 1024) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(ApiResponse.error("脚本内容不能超过 10MB"));
        }

        java.util.List<String> dangerous = java.util.List.of("os.system", "subprocess.call", "subprocess.Popen", "socket.connect", "shutil.rmtree", "eval(", "exec(");
        java.util.List<String> found = new java.util.ArrayList<>();
        for (String d : dangerous) { if (content.contains(d)) found.add(d); }
        if (!found.isEmpty()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(ApiResponse.error("脚本包含危险调用: " + String.join(", ", found)));
        }
        if (!content.contains("def main(") && !content.contains("def solve(")) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(ApiResponse.error("脚本必须包含 main() 或 solve() 入口函数"));
        }

        try {
            java.nio.file.Path dir = java.nio.file.Path.of(algorithmsStoragePath);
            java.nio.file.Files.createDirectories(dir);

            com.luban.service.algorithm.AlgorithmConfig config = com.luban.service.algorithm.AlgorithmConfig.parse(tool.getConfig());
            String scriptName = config.getScriptPath();
            if (scriptName == null || scriptName.isBlank()) {
                scriptName = tool.getName() + ".py";
                config.setScriptPath(scriptName);
            }

            java.nio.file.Path target = dir.resolve(scriptName).normalize();
            if (!target.startsWith(dir.normalize())) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                        .body(ApiResponse.error("文件路径穿越检测"));
            }

            if (java.nio.file.Files.exists(target)) {
                java.nio.file.Path backupDir = dir.resolve("backups");
                java.nio.file.Files.createDirectories(backupDir);
                String timestamp = java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("yyyyMMddHHmmss"));
                java.nio.file.Files.copy(target, backupDir.resolve(scriptName + "." + timestamp + ".bak"));
            }

            java.nio.file.Files.write(target, content.getBytes(java.nio.charset.StandardCharsets.UTF_8));

            com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            tool.setConfig(mapper.writeValueAsString(config));
            toolDefinitionRepository.save(tool);

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("scriptPath", scriptName);
            result.put("size", content.length());
            return ResponseEntity.ok(ApiResponse.ok(result));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(ApiResponse.error("脚本保存失败: " + e.getMessage()));
        }
    }

    @GetMapping("/{id}/script/health")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> checkScriptHealth(@PathVariable Long id) {
        var opt = toolDefinitionRepository.findById(id);
        if (opt.isEmpty()) return ResponseEntity.notFound().build();
        ToolDefinition tool = opt.get();
        if (tool.getToolType() != ToolType.ALGORITHM) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(ApiResponse.error("仅 ALGORITHM 类型工具支持健康检查"));
        }
        com.luban.service.algorithm.AlgorithmConfig config = com.luban.service.algorithm.AlgorithmConfig.parse(tool.getConfig());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("algorithmId", id);
        result.put("algorithmName", tool.getName());
        result.put("scriptPath", config.getScriptPath());
        if (config.getScriptPath() != null && !config.getScriptPath().isBlank()) {
            java.nio.file.Path scriptFile = java.nio.file.Path.of(algorithmsStoragePath, config.getScriptPath());
            result.put("scriptExists", java.nio.file.Files.exists(scriptFile));
            result.put("sandboxHealthy", codeExecutorService.isHealthy());
            if (java.nio.file.Files.exists(scriptFile)) {
                Map<String, Object> syntaxResult = codeExecutorService.checkSyntax(config.getScriptPath());
                result.put("syntaxValid", syntaxResult.getOrDefault("valid", false));
                result.put("syntaxError", syntaxResult.getOrDefault("error", ""));
            } else {
                result.put("syntaxValid", false);
                result.put("syntaxError", "脚本文件不存在");
            }
        } else {
            result.put("scriptExists", false);
            result.put("sandboxHealthy", false);
            result.put("syntaxValid", false);
        }
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    @GetMapping("/{id}/executions")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<List<AlgorithmExecutionLog>>> getExecutionLogs(
            @PathVariable Long id,
            @RequestParam(defaultValue = "20") int limit) {
        List<AlgorithmExecutionLog> logs = algorithmExecutionLogRepository
                .findByAlgorithmIdOrderByCreatedAtDesc(id, PageRequest.of(0, Math.min(limit, 100)));
        return ResponseEntity.ok(ApiResponse.ok(logs));
    }
}