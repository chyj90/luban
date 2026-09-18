package com.luban.orchestration.engine;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/** 沙箱客户端协议测试：结果行解析 / 截断识别（SANDBOX_RESULT_TRUNCATED）/ 驱动序列化参数。 */
class SandboxPythonClientTest {

    private HttpServer server;
    private SandboxPythonClient client;
    private final AtomicReference<String> lastRequest = new AtomicReference<>();
    private volatile String responseBody = "{}";

    @BeforeEach
    void setUp() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/execute-code", exchange -> {
            lastRequest.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] body = responseBody.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        client = new SandboxPythonClient("http://127.0.0.1:" + server.getAddress().getPort());
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    @Test
    void normalResultParsesLastJsonLine() {
        responseBody = "{\"success\":true,\"stdout\":\"debug line\\n{\\\"shape\\\":[15,6]}\"}";

        SandboxPythonClient.SandboxResult r = client.executeWithFiles(
                "def main(ctx):\n    return {'shape': [15, 6]}", Map.of(), List.of(), 5);

        assertThat(r.ok()).isTrue();
        assertThat(r.result()).containsEntry("shape", List.of(15, 6));
    }

    @Test
    void truncatedStdoutIsReportedAsTruncated() {
        responseBody = "{\"success\":true,\"stdout_truncated\":true,"
                + "\"stdout\":\"{\\\"明细\\\":[\\\"<被从头截掉的 JSON 片段\"}";

        SandboxPythonClient.SandboxResult r = client.executeWithFiles(
                "def main(ctx):\n    return {}", Map.of(), null, 5);

        assertThat(r.ok()).isFalse();
        assertThat(r.errorCode()).isEqualTo("SANDBOX_RESULT_TRUNCATED");
        assertThat(r.stderr()).contains("5000").contains("精简");
    }

    @Test
    void missingJsonLineWithoutTruncationStaysNoResult() {
        responseBody = "{\"success\":true,\"stdout\":\"hello\\nworld\"}";

        SandboxPythonClient.SandboxResult r = client.executeWithFiles(
                "def main(ctx):\n    return {}", Map.of(), null, 5);

        assertThat(r.ok()).isFalse();
        assertThat(r.errorCode()).isEqualTo("SANDBOX_NO_RESULT");
    }

    @Test
    void truncatedButLastLineIntactStillParses() {
        // 调试输出把 stdout 顶过 5000 上限，但末尾结果行本身完整——应正常解析而非误报截断
        responseBody = "{\"success\":true,\"stdout_truncated\":true,\"stdout\":\"[调试输出被截断]\\n{\\\"ok\\\":true}\"}";

        SandboxPythonClient.SandboxResult r = client.executeWithFiles(
                "def main(ctx):\n    return {'ok': True}", Map.of(), null, 5);

        assertThat(r.ok()).isTrue();
        assertThat(r.result()).containsEntry("ok", true);
    }

    @Test
    void mainErrorSurfaced() {
        responseBody = "{\"success\":true,\"stdout\":\"{\\\"error\\\":\\\"boom\\\"}\"}";

        SandboxPythonClient.SandboxResult r = client.executeWithFiles(
                "def main(ctx):\n    raise ValueError('boom')", Map.of(), null, 5);

        assertThat(r.ok()).isFalse();
        assertThat(r.errorCode()).isEqualTo("SANDBOX_MAIN_FAILED");
        assertThat(r.stderr()).isEqualTo("boom");
    }

    @Test
    void driverSerializesUnicodeLiteralsAndPinsUtf8Stdout() {
        responseBody = "{\"success\":true,\"stdout\":\"{\\\"ok\\\":true}\"}";

        client.execute("def main(ctx):\n    return {'名称': '中文明细'}", "main", Map.of(), 5);

        assertThat(lastRequest.get())
                .contains("ensure_ascii=False")
                .contains("reconfigure(encoding='utf-8')");
    }
}
