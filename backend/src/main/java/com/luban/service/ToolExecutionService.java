package com.luban.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.ToolDefinition;
import com.luban.executor.HttpExecutor;
import com.luban.executor.McpExecutor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 工具执行的统一出口：平台工具分发（HTTP/MCP/算法）、应用工具方言执行、编排引擎裸出站通道。
 *
 * ORCHESTRATION 类型不在这里分发——编排属应用级对象且引擎依赖本服务，
 * 走 {@link com.luban.orchestration.service.OrchestrationToolInvoker} 以避免循环依赖。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ToolExecutionService {

    private static final int RAW_MAX_RETRIES = 5;
    private static final int RAW_RESPONSE_TRUNCATE = 1_000_000;

    private final HttpExecutor httpExecutor;
    private final McpExecutor mcpExecutor;
    private final CodeExecutorService codeExecutorService;
    private final ObjectMapper objectMapper;

    private final HttpClient rawHttpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER) // 重定向逐跳校验由调用方负责
            .build();

    private final HttpClient appToolHttpClient = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    /**
     * 平台工具统一分发（Agent 调用 / 调试端点 / MCP 网关共用）。
     * ORCHESTRATION 类型不支持，调用方须先分流到 OrchestrationToolInvoker。
     */
    public String executeToolDefinition(ToolDefinition tool, Map<String, Object> arguments, String callerInfo) {
        try {
            return switch (tool.getToolType()) {
                case HTTP -> httpExecutor.execute(tool, arguments, callerInfo);
                case MCP_PASSTHROUGH -> mcpExecutor.execute(tool, arguments);
                case ALGORITHM -> executeAlgorithm(tool, arguments);
                case ORCHESTRATION -> throw new IllegalArgumentException(
                        "ORCHESTRATION 类型工具请经编排通道调用");
            };
        } catch (Exception e) {
            log.error("Tool execution failed: {}", tool.getName(), e);
            return "{\"error\": \"" + (e.getMessage() == null ? "execution failed" : e.getMessage().replace("\"", "\\\"")) + "\"}";
        }
    }

    private String executeAlgorithm(ToolDefinition tool, Map<String, Object> arguments) throws Exception {
        com.luban.service.algorithm.AlgorithmConfig config =
                com.luban.service.algorithm.AlgorithmConfig.parse(tool.getConfig());
        if (config.getScriptPath() == null || config.getScriptPath().isBlank()) {
            return "{\"error\": \"算法未上传脚本\"}";
        }
        Map<String, Object> result = codeExecutorService.executeScript(config.getScriptPath(), arguments, config.getTimeout());
        try {
            return objectMapper.writeValueAsString(result);
        } catch (Exception e) {
            return "{\"error\": \"结果序列化失败: " + e.getMessage().replace("\"", "\\\"") + "\"}";
        }
    }

    /**
     * 应用工具执行（页面运行时与应用内调试共用）。
     * config 方言：method/url/headers(List:key,value,enabled)/queryParams(List:key,value)/body({{var}} 模板)/contentType。
     * 返回 {status, headers, elapsed, body}；URL 缺失抛 IllegalArgumentException。
     */
    public Map<String, Object> executeApplicationTool(ToolDefinition tool, Map<String, Object> params) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> config = objectMapper.readValue(tool.getConfig(), Map.class);
            String method = (String) config.getOrDefault("method", "GET");
            String url = (String) config.get("url");

            if (url == null || url.isBlank()) {
                throw new IllegalArgumentException("API 未配置 URL");
            }
            String resolvedUrl = replaceVars(url, params);

            @SuppressWarnings("unchecked")
            List<Map<String, String>> headers = (List<Map<String, String>>) config.get("headers");
            @SuppressWarnings("unchecked")
            List<Map<String, String>> queryParams = (List<Map<String, String>>) config.get("queryParams");
            String bodyContent = (String) config.get("body");
            String contentType = (String) config.getOrDefault("contentType", "application/json");

            if (queryParams != null && !queryParams.isEmpty()) {
                StringBuilder qs = new StringBuilder();
                for (Map<String, String> p : queryParams) {
                    String k = p.get("key");
                    String v = p.get("value");
                    if (k != null && !k.isBlank()) {
                        String resolvedV = replaceVars(v != null ? v : "", params);
                        if (qs.length() > 0) qs.append("&");
                        qs.append(encode(k)).append("=").append(encode(resolvedV));
                    }
                }
                if (qs.length() > 0) {
                    resolvedUrl += (resolvedUrl.contains("?") ? "&" : "?") + qs;
                }
            }

            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(resolvedUrl))
                    .timeout(Duration.ofSeconds(30));

            HttpRequest.BodyPublisher bodyPublisher = HttpRequest.BodyPublishers.noBody();
            if ("POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method) || "PATCH".equalsIgnoreCase(method)) {
                if (bodyContent != null && !bodyContent.isBlank()) {
                    String resolvedBody = replaceVars(bodyContent, params);
                    bodyPublisher = HttpRequest.BodyPublishers.ofString(resolvedBody);
                    builder.header("Content-Type", contentType != null ? contentType : "application/json");
                }
            }

            builder.method(method.toUpperCase(), bodyPublisher);

            if (headers != null) {
                for (Map<String, String> h : headers) {
                    String k = h.get("key");
                    String v = h.get("value");
                    String enabled = h.get("enabled");
                    if (k != null && !k.isBlank() && !"false".equals(enabled)) {
                        builder.header(k, replaceVars(v != null ? v : "", params));
                    }
                }
            }

            long start = System.currentTimeMillis();
            HttpResponse<String> response = appToolHttpClient.send(builder.build(),
                    HttpResponse.BodyHandlers.ofString());
            long elapsed = System.currentTimeMillis() - start;

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("status", response.statusCode());
            result.put("headers", response.headers().map());
            result.put("elapsed", elapsed);

            String responseBody = response.body();
            try {
                result.put("body", objectMapper.readValue(responseBody, Object.class));
            } catch (Exception e) {
                result.put("body", responseBody);
            }

            log.info("Application tool run: {} {} ({}ms) -> {}", tool.getDisplayName(), method, elapsed, response.statusCode());
            return result;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            log.error("Application tool run failed: {}", tool.getDisplayName(), e);
            throw new RuntimeException("API 调用失败: " + e.getMessage(), e);
        }
    }

    /**
     * 编排引擎裸出站通道（http 直连节点 / 无 toolId 的受控出站）。
     * URL 已由引擎 IpGuard 校验并以验证过的 IP 建连；重定向逐跳校验由调用方负责。
     * 返回 {status, data} 或 {error}，data 超 1MB 截断。
     */
    public Map<String, Object> callHttpRaw(String url, String method, Map<String, Object> headers,
                                           Object body, int timeoutMs, int retries, boolean hasHostHeader) {
        Map<String, Object> lastResult = Map.of("error", "未执行");
        int attempts = Math.max(1, Math.min(retries, RAW_MAX_RETRIES) + 1);
        for (int i = 0; i < attempts; i++) {
            lastResult = callHttpOnce(url, method, headers, body, timeoutMs, hasHostHeader);
            if (lastResult.get("error") == null) return lastResult;
            log.warn("Raw HTTP call attempt {}/{} failed: {}", i + 1, attempts, lastResult.get("error"));
        }
        return lastResult;
    }

    private Map<String, Object> callHttpOnce(String url, String method, Map<String, Object> headers,
                                             Object body, int timeoutMs, boolean hasHostHeader) {
        try {
            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofMillis(timeoutMs));
            if (headers != null) {
                headers.forEach((k, v) -> builder.header(k, String.valueOf(v)));
            }
            if (!hasHostHeader) {
                // IP 建连时由引擎补 Host；此处兜底
                URI uri = URI.create(url);
                builder.header("Host", uri.getHost());
            }
            if ("POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method) || "PATCH".equalsIgnoreCase(method)) {
                String payload = body == null ? "" : objectMapper.writeValueAsString(body);
                builder.method(method.toUpperCase(), HttpRequest.BodyPublishers.ofString(payload));
                builder.header("Content-Type", "application/json");
            } else {
                builder.method(method.toUpperCase(), HttpRequest.BodyPublishers.noBody());
            }
            HttpResponse<String> resp = rawHttpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("status", resp.statusCode());
            String bodyText = resp.body() == null ? "" : resp.body();
            out.put("data", bodyText.length() > RAW_RESPONSE_TRUNCATE
                    ? bodyText.substring(0, RAW_RESPONSE_TRUNCATE) : bodyText);
            return out;
        } catch (Exception e) {
            return Map.of("error", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
        }
    }

    private static final java.util.regex.Pattern VAR_PATTERN = java.util.regex.Pattern.compile("\\{\\{(\\w+)\\}\\}");

    /** {{var}} 模板替换：参数缺失替换为空串（与 ApplicationToolController 原行为一致）。 */
    private String replaceVars(String template, Map<String, Object> params) {
        if (template == null || params == null || params.isEmpty()) return template;
        java.util.regex.Matcher m = VAR_PATTERN.matcher(template);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            Object value = params.get(m.group(1));
            m.appendReplacement(sb, java.util.regex.Matcher.quoteReplacement(value != null ? value.toString() : ""));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
