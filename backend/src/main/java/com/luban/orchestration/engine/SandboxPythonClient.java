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
        return doExecute(source, entry, ctxInputs, null, timeoutSec);
    }

    /**
     * 带文件绑定的执行：filePaths 为宿主机上平台文件目录内的绝对路径，
     * embedding 会复制进沙箱并经 ctx['_files'][文件名] 暴露给代码（详见 /v1/execute-code 契约）。
     * 代码仍须定义 def main(ctx)，结果经 stdout JSON 返回（≤5000 字符，须紧凑；
     * 超限被截断时返回 SANDBOX_RESULT_TRUNCATED，而非笼统的"未返回结果"）。
     */
    public SandboxResult executeWithFiles(String source, Map<String, Object> ctxInputs,
                                          java.util.List<String> filePaths, int timeoutSec) {
        return doExecute(source, "main", ctxInputs, filePaths, timeoutSec);
    }

    private SandboxResult doExecute(String source, String entry, Map<String, Object> ctxInputs,
                                    java.util.List<String> filePaths, int timeoutSec) {
        try {
            String driver = buildDriver(source, entry);
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("code", driver);
            body.put("input_data", ctxInputs == null ? Map.of() : ctxInputs);
            if (filePaths != null && !filePaths.isEmpty()) {
                body.put("file_paths", filePaths);
            }
            body.put("timeout", Math.min(timeoutSec, 60));

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/v1/execute-code"))
                    .timeout(Duration.ofSeconds(timeoutSec + 5L))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                    .build();

            HttpResponse<String> resp = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                String reason = extractReason(resp.body());
                // 基础设施级失败用专用错误码：503/502/504 = 沙箱池不可用（池空/Docker 掉线/镜像缺失/熔断），
                // 编排引擎与 agent 据此区分"沙箱挂了"与"代码错误"——此前统一 SANDBOX_HTTP_503，
                // 池挂了 agent 只能盲目换实现，无人知道基础设施故障（2026-09-15 请假案例）
                String code = (resp.statusCode() == 502 || resp.statusCode() == 503 || resp.statusCode() == 504)
                        ? "SANDBOX_POOL_DOWN" : "SANDBOX_HTTP_" + resp.statusCode();
                log.warn("Sandbox unavailable: status={} reason={}", resp.statusCode(), reason);
                return new SandboxResult(false, Map.of(),
                        "沙箱服务返回 " + resp.statusCode() + (reason.isEmpty() ? "" : "（" + reason + "）")
                                + "。SANDBOX_POOL_DOWN 属基础设施故障，请上报用户或稍后重试，不要当作代码错误处理",
                        code);
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
                // embedding 侧 stdout 只保留末尾 5000 字符并带 stdout_truncated 标记（sandbox_manager.py）。
                // 被截断时结果 JSON 从头被切掉，无法拼出完整 {…} 行——此前误报"main 未返回 JSON 结果"，
                // agent 只能靠猜；显式报超长，指引精简返回值（2026-09-17 Excel 全量明细案例）
                if (root.path("stdout_truncated").asBoolean(false)) {
                    log.warn("Sandbox result truncated: stdout kept at {} chars", stdout.length());
                    return new SandboxResult(false, Map.of(),
                            "main 的返回值序列化后超过沙箱 stdout 上限（5000 字符），已被截断，结果 JSON 不完整。"
                                    + "请大幅精简返回值：只保留聚合统计 / 抽样（head/iloc[:20]）/ 关键行，禁止全量明细；"
                                    + "确需明细时分批多次执行",
                            "SANDBOX_RESULT_TRUNCATED");
                }
                return new SandboxResult(false, Map.of(), "main 未返回 JSON 结果", "SANDBOX_NO_RESULT");
            }
            JsonNode resultNode = objectMapper.readTree(resultJson);
            if (resultNode.has("error")) {
                return new SandboxResult(false, Map.of(), resultNode.path("error").asText(), "SANDBOX_MAIN_FAILED");
            }
            return new SandboxResult(true, objectMapper.convertValue(resultNode, Map.class), stderr, null);
        } catch (java.net.http.HttpTimeoutException e) {
            return new SandboxResult(false, Map.of(), "沙箱执行超时", "SANDBOX_TIMEOUT");
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            // 请求/结果 JSON 不合法（如返回值残留 NaN/Inf）是数据问题，不是基础设施故障——
            // 归为 SANDBOX_UNAVAILABLE 会误导 agent 以为沙箱挂了而盲目重试
            log.warn("Sandbox JSON codec failed: {}", e.getMessage());
            return new SandboxResult(false, Map.of(),
                    "沙箱结果 JSON 编解码失败：" + e.getMessage()
                            + "。请清洗 main 的返回值（NaN/Inf 转 None、numpy/日期转原生类型）后修改代码重试",
                    "SANDBOX_RESULT_PARSE");
        } catch (Exception e) {
            log.warn("Sandbox client error: {}", e.getMessage());
            return new SandboxResult(false, Map.of(), e.getMessage(), "SANDBOX_UNAVAILABLE");
        }
    }

    private String buildDriver(String source, String entry) {
        // 返回值消毒：pandas/numpy 结果里的 NaN/Inf 是非标准 JSON 字面量，numpy 标量/日期不可直接序列化，
        // 原样 dumps 会导致 Java 侧 readTree 失败（此前被误报为 SANDBOX_UNAVAILABLE，agent 无法定位）
        // dumps 必须 ensure_ascii=False：默认转义会把每个中文变成 6 字符的 Unicode 转义序列，
        // 5000 字符的 stdout 预算下中文内容实际容量缩水 6 倍，全量明细类返回极易触发截断；
        // reconfigure 固定容器内 stdout 为 UTF-8，不依赖镜像 locale（slim 镜像 C locale 下 print 中文会 UnicodeEncodeError）
        return source + "\n\n"
                + "import sys as _sys, json as _json, math as _math\n"
                + "try:\n"
                + "    _sys.stdout.reconfigure(encoding='utf-8')\n"
                + "except Exception:\n"
                + "    pass\n"
                + "def _luban_safe(v):\n"
                + "    if isinstance(v, float):\n"
                + "        return v if _math.isfinite(v) else None\n"
                + "    if isinstance(v, dict):\n"
                + "        return {str(k): _luban_safe(x) for k, x in v.items()}\n"
                + "    if isinstance(v, (list, tuple)):\n"
                + "        return [_luban_safe(x) for x in v]\n"
                + "    return v\n"
                + "def _luban_json_default(o):\n"
                + "    import datetime as _dt\n"
                + "    if isinstance(o, (_dt.date, _dt.datetime, _dt.time)):\n"
                + "        return o.isoformat()\n"
                + "    try:\n"
                + "        import numpy as _np\n"
                + "    except ImportError:\n"
                + "        raise TypeError('返回值含不可 JSON 序列化对象 %s，请先转为原生类型' % type(o).__name__)\n"
                + "    if isinstance(o, _np.integer):\n"
                + "        return int(o)\n"
                + "    if isinstance(o, _np.bool_):\n"
                + "        return bool(o)\n"
                + "    if isinstance(o, _np.floating):\n"
                + "        f = float(o)\n"
                + "        return f if _math.isfinite(f) else None\n"
                + "    if isinstance(o, _np.ndarray):\n"
                + "        return _luban_safe(o.tolist())\n"
                + "    if hasattr(o, 'to_dict'):\n"
                + "        return _luban_safe(o.to_dict())\n"
                + "    raise TypeError('返回值含不可 JSON 序列化对象 %s，请先转为原生类型' % type(o).__name__)\n"
                + "_result = _luban_safe(" + entry + "(_INPUT_DATA))\n"
                + "print(_json.dumps(_result, ensure_ascii=False, default=_luban_json_default))\n";
    }

    /** 从 embedding 503 响应体提取 reason（pool_empty/pool_exhausted/docker_down/image_missing/circuit_open） */
    private String extractReason(String body) {
        if (body == null || body.isBlank()) return "";
        var m = java.util.regex.Pattern.compile("\"reason\"\\s*:\\s*\"([^\"]+)\"").matcher(body);
        return m.find() ? m.group(1) : "";
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
