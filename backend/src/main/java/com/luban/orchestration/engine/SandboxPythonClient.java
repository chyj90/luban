package com.luban.orchestration.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Python 沙箱客户端：编排 Python 节点 → embedding-service /v1/execute-code → 沙箱池。
 *
 * 执行协议（与沙箱池的安全约束配套）：
 * 1. 用户代码必须定义 def main(ctx)，由驱动代码调用并 JSON 序列化输出到 stdout；
 * 2. ctx（上游输出 + 编排输入）经 INPUT_DATA 环境变量注入（execute-code 既有机制）；
 * 3. 沙箱容器无网络，Python 侧无法外带数据。
 */
@Component
public class SandboxPythonClient {

    private static final Logger log = LoggerFactory.getLogger(SandboxPythonClient.class);

    private final String baseUrl;
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    private final ObjectMapper objectMapper = new ObjectMapper();

    public SandboxPythonClient(@Value("${luban.sandbox.base-url:http://127.0.0.1:8765}") String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public record SandboxResult(boolean ok, Map<String, Object> result, String stderr, String errorCode) {}

    public SandboxResult execute(String source, String entry, Map<String, Object> ctxInputs, int timeoutSec) {
        try {
            String driver = buildDriver(source, entry);
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("code", driver);
            body.put("input_data", ctxInputs == null ? Map.of() : ctxInputs);
            body.put("timeout", Math.min(timeoutSec, 60));

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/v1/execute-code"))
                    .timeout(Duration.ofSeconds(timeoutSec + 5L))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                    .build();

            HttpResponse<String> resp = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                return new SandboxResult(false, Map.of(),
                        "沙箱服务返回 " + resp.statusCode(), "SANDBOX_HTTP_" + resp.statusCode());
            }
            JsonNode root = objectMapper.readTree(resp.body());
            boolean success = root.path("success").asBoolean(false);
            String stdout = root.path("stdout").asText("");
            String stderr = root.path("stderr").asText("");

            if (!success) {
                String errTail = stderr.length() > 300
                        ? stderr.substring(stderr.length() - 300) : stderr;
                log.warn("Python node failed in sandbox: {}", errTail);
                return new SandboxResult(false, Map.of(), errTail, "SANDBOX_EXEC_FAILED");
            }
            // 协议：stdout 最后一行是 main(ctx) 的 JSON 结果
            String resultJson = lastJsonLine(stdout);
            if (resultJson == null) {
                return new SandboxResult(false, Map.of(), "main 未返回 JSON 结果", "SANDBOX_NO_RESULT");
            }
            JsonNode resultNode = objectMapper.readTree(resultJson);
            if (resultNode.has("error")) {
                return new SandboxResult(false, Map.of(), resultNode.path("error").asText(), "SANDBOX_MAIN_FAILED");
            }
            return new SandboxResult(true, objectMapper.convertValue(resultNode, Map.class), stderr, null);
        } catch (java.net.http.HttpTimeoutException e) {
            return new SandboxResult(false, Map.of(), "沙箱执行超时", "SANDBOX_TIMEOUT");
        } catch (Exception e) {
            log.warn("Sandbox client error: {}", e.getMessage());
            return new SandboxResult(false, Map.of(), e.getMessage(), "SANDBOX_UNAVAILABLE");
        }
    }

    private String buildDriver(String source, String entry) {
        return source + "\n\n"
                + "import json as _json\n"
                + "_result = " + entry + "(_INPUT_DATA)\n"
                + "print(_json.dumps(_result))\n";
    }

    private String lastJsonLine(String stdout) {
        String[] lines = stdout.split("\n");
        for (int i = lines.length - 1; i >= 0; i--) {
            String line = lines[i].trim();
            if (line.startsWith("{") && line.endsWith("}")) return line;
        }
        return null;
    }
}
