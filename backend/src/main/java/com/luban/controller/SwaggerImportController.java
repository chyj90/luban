package com.luban.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import com.luban.entity.ToolDefinition;
import com.luban.repository.ToolDefinitionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@RestController
@RequestMapping("/api/v1/tools/import")
@RequiredArgsConstructor
public class SwaggerImportController {

    private final ToolDefinitionRepository toolDefinitionRepository;
    private final ObjectMapper jsonMapper = new ObjectMapper();
    private final ObjectMapper yamlMapper = new ObjectMapper(new YAMLFactory());
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    @PostMapping("/swagger/parse")
    public ResponseEntity<Map<String, Object>> parseSwagger(@RequestBody Map<String, Object> request) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            String swaggerContent;
            String url = (String) request.get("url");
            String content = (String) request.get("content");

            if (url != null && !url.isEmpty()) {
                HttpRequest httpRequest = HttpRequest.newBuilder()
                        .uri(URI.create(url))
                        .timeout(Duration.ofSeconds(15))
                        .GET()
                        .build();
                HttpResponse<String> response = httpClient.send(httpRequest, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() != 200) {
                    result.put("error", "无法连接 Swagger 服务，HTTP " + response.statusCode());
                    return ResponseEntity.ok(result);
                }
                swaggerContent = response.body();
            } else if (content != null && !content.isEmpty()) {
                swaggerContent = content;
            } else {
                result.put("error", "请提供 Swagger URL 或文件内容");
                return ResponseEntity.ok(result);
            }

            Map<String, Object> swagger = parseSwaggerContent(swaggerContent);
            if (swagger == null) {
                result.put("error", "文档格式错误，请检查是否为有效的 OpenAPI 规范");
                return ResponseEntity.ok(result);
            }

            List<Map<String, Object>> endpoints = extractEndpoints(swagger);
            result.put("endpoints", endpoints);
            result.put("total", endpoints.size());
            result.put("swaggerVersion", swagger.getOrDefault("openapi", swagger.getOrDefault("swagger", "unknown")));

        } catch (Exception e) {
            log.error("Swagger 解析失败", e);
            result.put("error", "解析失败: " + e.getMessage());
        }
        return ResponseEntity.ok(result);
    }

    @PostMapping("/swagger/batch")
    public ResponseEntity<Map<String, Object>> batchImport(@RequestBody Map<String, Object> request) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            Long groupId = request.get("groupId") != null
                    ? ((Number) request.get("groupId")).longValue() : null;
            if (groupId == null) {
                result.put("error", "缺少 groupId");
                return ResponseEntity.ok(result);
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> endpoints = (List<Map<String, Object>>) request.get("endpoints");
            if (endpoints == null || endpoints.isEmpty()) {
                result.put("error", "未选择要导入的接口");
                return ResponseEntity.ok(result);
            }

            List<Map<String, Object>> imported = new ArrayList<>();
            int created = 0;
            int skipped = 0;

            for (Map<String, Object> ep : endpoints) {
                String toolName = (String) ep.get("name");
                String description = (String) ep.get("description");
                String inputSchema = (String) ep.get("inputSchema");
                String config = (String) ep.get("config");

                if (toolName == null || toolName.isEmpty()) continue;

                if (toolDefinitionRepository.findByName(toolName).isPresent()) {
                    Map<String, Object> skipped_ep = new LinkedHashMap<>();
                    skipped_ep.put("name", toolName);
                    skipped_ep.put("status", "skipped");
                    skipped_ep.put("reason", "工具名已存在");
                    imported.add(skipped_ep);
                    skipped++;
                    continue;
                }

                ToolDefinition tool = new ToolDefinition();
                tool.setName(toolName);
                tool.setDisplayName(toolName);
                tool.setToolType("HTTP");
                tool.setDescription(description != null ? description : "");
                tool.setInputSchema(inputSchema != null ? inputSchema : "{}");
                tool.setConfig(config != null ? config : "{}");
                tool.setGroupId(groupId);
                tool.setStatus("ENABLED");
                toolDefinitionRepository.save(tool);

                Map<String, Object> imported_ep = new LinkedHashMap<>();
                imported_ep.put("name", toolName);
                imported_ep.put("status", "created");
                imported_ep.put("id", tool.getId());
                imported.add(imported_ep);
                created++;
            }

            result.put("created", created);
            result.put("skipped", skipped);
            result.put("imported", imported);

        } catch (Exception e) {
            log.error("批量导入失败", e);
            result.put("error", "批量导入失败: " + e.getMessage());
        }
        return ResponseEntity.ok(result);
    }

    private Map<String, Object> parseSwaggerContent(String content) {
        try {
            String trimmed = content.trim();
            if (trimmed.startsWith("{")) {
                return jsonMapper.readValue(trimmed, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
            } else {
                return yamlMapper.readValue(trimmed, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
            }
        } catch (Exception e) {
            log.warn("Failed to parse swagger content: {}", e.getMessage());
            return null;
        }
    }

    private List<Map<String, Object>> extractEndpoints(Map<String, Object> swagger) {
        List<Map<String, Object>> endpoints = new ArrayList<>();

        String baseUrl = extractBaseUrl(swagger);

        Map<String, Object> paths = getMap(swagger, "paths");
        if (paths == null) return endpoints;

        for (Map.Entry<String, Object> pathEntry : paths.entrySet()) {
            String path = pathEntry.getKey();
            @SuppressWarnings("unchecked")
            Map<String, Object> methods = (Map<String, Object>) pathEntry.getValue();
            if (methods == null) continue;

            for (Map.Entry<String, Object> methodEntry : methods.entrySet()) {
                String method = methodEntry.getKey().toUpperCase();
                if (!method.matches("GET|POST|PUT|DELETE|PATCH")) continue;

                @SuppressWarnings("unchecked")
                Map<String, Object> operation = (Map<String, Object>) methodEntry.getValue();
                if (operation == null) continue;

                String operationId = (String) operation.get("operationId");
                String summary = (String) operation.get("summary");
                String description = (String) operation.get("description");
                if (description == null) description = summary;

                List<String> tags = getStringList(operation, "tags");
                String tag = tags != null && !tags.isEmpty() ? tags.get(0) : "";

                String toolName = operationId != null ? operationId
                        : summary != null ? toCamelCase(summary)
                        : path.replaceAll("[{}/]", "_").replaceAll("^_|_$", "");

                Map<String, Object> parameters = extractParameters(operation, path);
                String inputSchema = buildInputSchema(parameters);

                Map<String, Object> config = new LinkedHashMap<>();
                config.put("method", method);
                config.put("url", baseUrl + path);
                config.put("timeout", 10);
                config.put("retry", 3);

                Map<String, Object> ep = new LinkedHashMap<>();
                ep.put("path", path);
                ep.put("method", method);
                ep.put("summary", summary != null ? summary : "");
                ep.put("description", description != null ? description : "");
                ep.put("tag", tag);
                ep.put("name", toolName);
                ep.put("parameters", parameters);
                ep.put("inputSchema", inputSchema);
                ep.put("config", jsonToString(config));
                endpoints.add(ep);
            }
        }
        return endpoints;
    }

    private String extractBaseUrl(Map<String, Object> swagger) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> servers = (List<Map<String, Object>>) swagger.get("servers");
        if (servers != null && !servers.isEmpty()) {
            Object url = servers.get(0).get("url");
            return url != null ? url.toString() : "";
        }
        String host = (String) swagger.get("host");
        String basePath = (String) swagger.get("basePath");
        if (host != null) {
            String scheme = "http";
            @SuppressWarnings("unchecked")
            List<String> schemes = (List<String>) swagger.get("schemes");
            if (schemes != null && !schemes.isEmpty()) {
                scheme = schemes.get(0);
            }
            return scheme + "://" + host + (basePath != null ? basePath : "");
        }
        return "";
    }

    private Map<String, Object> extractParameters(Map<String, Object> operation, String path) {
        Map<String, Object> params = new LinkedHashMap<>();

        List<String> pathParams = new ArrayList<>();
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\{([^}]+)\\}").matcher(path);
        while (m.find()) {
            pathParams.add(m.group(1));
        }

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> swaggerParams = (List<Map<String, Object>>) operation.get("parameters");
        if (swaggerParams != null) {
            for (Map<String, Object> sp : swaggerParams) {
                String name = (String) sp.get("name");
                if (name == null) continue;
                String in = (String) sp.get("in");
                String desc = (String) sp.getOrDefault("description", "");
                Boolean required = (Boolean) sp.getOrDefault("required", false);
                if (pathParams.contains(name)) required = true;

                Map<String, Object> paramDef = new LinkedHashMap<>();
                paramDef.put("type", "string");
                paramDef.put("description", desc);
                paramDef.put("required", required);
                if (sp.get("schema") != null) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> schema = (Map<String, Object>) sp.get("schema");
                    paramDef.put("type", schema.getOrDefault("type", "string"));
                }
                if (sp.get("enum") != null) {
                    paramDef.put("enum", sp.get("enum"));
                }
                params.put(name, paramDef);
            }
        }

        Map<String, Object> requestBody = getMap(operation, "requestBody");
        if (requestBody != null) {
            Map<String, Object> content = getMap(requestBody, "content");
            if (content != null) {
                Map<String, Object> jsonContent = getMap(content, "application/json");
                if (jsonContent != null) {
                    Map<String, Object> schema = getMap(jsonContent, "schema");
                    if (schema != null) {
                        Map<String, Object> properties = getMap(schema, "properties");
                        @SuppressWarnings("unchecked")
                        List<String> required = (List<String>) schema.get("required");
                        if (properties != null) {
                            for (Map.Entry<String, Object> prop : properties.entrySet()) {
                                @SuppressWarnings("unchecked")
                                Map<String, Object> propSchema = (Map<String, Object>) prop.getValue();
                                Map<String, Object> propDef = new LinkedHashMap<>();
                                propDef.put("type", propSchema.getOrDefault("type", "string"));
                                propDef.put("description", propSchema.getOrDefault("description", ""));
                                propDef.put("required", required != null && required.contains(prop.getKey()));
                                params.put(prop.getKey(), propDef);
                            }
                        }
                    }
                }
            }
        }

        for (String pathParam : pathParams) {
            if (!params.containsKey(pathParam)) {
                Map<String, Object> paramDef = new LinkedHashMap<>();
                paramDef.put("type", "string");
                paramDef.put("description", pathParam);
                paramDef.put("required", true);
                params.put(pathParam, paramDef);
            }
        }

        return params;
    }

    private String buildInputSchema(Map<String, Object> parameters) {
        if (parameters.isEmpty()) return "{}";
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");
        Map<String, Object> properties = new LinkedHashMap<>();
        List<String> required = new ArrayList<>();

        for (Map.Entry<String, Object> entry : parameters.entrySet()) {
            @SuppressWarnings("unchecked")
            Map<String, Object> paramDef = (Map<String, Object>) entry.getValue();
            Map<String, Object> propDef = new LinkedHashMap<>();
            propDef.put("type", paramDef.getOrDefault("type", "string"));
            propDef.put("description", paramDef.getOrDefault("description", ""));
            if (paramDef.containsKey("enum")) {
                propDef.put("enum", paramDef.get("enum"));
            }
            properties.put(entry.getKey(), propDef);
            if (Boolean.TRUE.equals(paramDef.get("required"))) {
                required.add(entry.getKey());
            }
        }
        schema.put("properties", properties);
        if (!required.isEmpty()) {
            schema.put("required", required);
        }
        return jsonToString(schema);
    }

    private String toCamelCase(String text) {
        String[] words = text.split("[\\s_-]+");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < words.length; i++) {
            if (i == 0) {
                sb.append(words[i].toLowerCase());
            } else {
                sb.append(Character.toUpperCase(words[i].charAt(0)));
                if (words[i].length() > 1) {
                    sb.append(words[i].substring(1).toLowerCase());
                }
            }
        }
        return sb.toString();
    }

    private Map<String, Object> getMap(Map<String, Object> source, String key) {
        @SuppressWarnings("unchecked")
        Map<String, Object> value = (Map<String, Object>) source.get(key);
        return value;
    }

    @SuppressWarnings("unchecked")
    private List<String> getStringList(Map<String, Object> source, String key) {
        return (List<String>) source.get(key);
    }

    private String jsonToString(Object obj) {
        try {
            return jsonMapper.writeValueAsString(obj);
        } catch (Exception e) {
            return "{}";
        }
    }
}