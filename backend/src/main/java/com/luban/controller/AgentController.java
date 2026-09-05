package com.luban.controller;

import com.luban.service.AgentService;
import com.luban.service.AgentConfigService;
import com.luban.entity.AgentConfig;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import jakarta.servlet.AsyncContext;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

@Slf4j
@RestController
@RequestMapping("/api/v1/agent")
@RequiredArgsConstructor
public class AgentController {

    private final AgentService agentService;
    private final AgentConfigService agentConfigService;
    private final ObjectMapper objectMapper;
    private final org.slf4j.Logger agentDebug = LoggerFactory.getLogger("agent-debug");

    private static final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(30))
            .build();
    private static final ScheduledExecutorService idleExecutor = Executors.newScheduledThreadPool(4);
    private static final Duration LLM_IDLE_TIMEOUT = Duration.ofSeconds(120);
    private static final Duration LLM_HARD_TIMEOUT = Duration.ofSeconds(300);

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> status = new LinkedHashMap<>();
        status.put("status", "UP");
        status.put("activeSessions", agentService.getActiveSessionCount());
        status.put("timestamp", System.currentTimeMillis());
        return ResponseEntity.ok(status);
    }

    @PostMapping("/chat")
    public ResponseEntity<Map<String, Object>> chat(@RequestBody Map<String, Object> params) {
        String sessionId = (String) params.getOrDefault("sessionId", UUID.randomUUID().toString());
        String message = (String) params.get("message");

        if (message == null || message.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "message is required"));
        }

        Long userId = getCurrentUserId();
        String userName = getCurrentUserName();
        Map<String, Object> result = agentService.chat(sessionId, message, userId, userName);
        result.put("sessionId", sessionId);
        return ResponseEntity.ok(result);
    }

    @PostMapping(value = "/chat/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public void chatStream(@RequestBody Map<String, Object> params, HttpServletRequest request,
                           HttpServletResponse response) {
        final String sessionId = (String) params.getOrDefault("sessionId", UUID.randomUUID().toString());
        final String message = (String) params.get("message");
        final Long userId = getCurrentUserId();
        final String userName = getCurrentUserName();

        if (message == null || message.isEmpty()) {
            response.setStatus(400);
            return;
        }

        response.setHeader("X-Accel-Buffering", "no");
        response.setHeader("Cache-Control", "no-cache");
        response.setContentType("text/event-stream");
        response.setCharacterEncoding("UTF-8");
        try {
            response.flushBuffer();
        } catch (IOException e) {
            log.warn("Failed to flush response buffer", e);
        }

        AsyncContext asyncContext = request.startAsync();
        asyncContext.setTimeout(300000);

        CompletableFuture.runAsync(() -> {
            try {
                ServletOutputStream out = response.getOutputStream();

                out.write(buildSSEBytes("thinking", "正在分析您的问题..."));
                out.flush();

                Map<String, Object> result = agentService.chat(sessionId, message, userId, userName, progress -> {
                    try {
                        out.write(buildSSEBytes("progress", progress));
                        out.flush();
                    } catch (IOException e) {
                        log.warn("Failed to send progress event", e);
                    }
                }, chunk -> {
                    try {
                        out.write(buildSSEBytes("llm_chunk", chunk));
                        out.flush();
                    } catch (IOException e) {
                        log.warn("Failed to send llm_chunk event", e);
                    }
                }, reasoning -> {
                    try {
                        out.write(buildSSEBytes("reasoning", reasoning));
                        out.flush();
                    } catch (IOException e) {
                        log.warn("Failed to send reasoning event", e);
                    }
                });
                result.put("sessionId", sessionId);

                Object conceptTrace = result.get("conceptTrace");
                if (conceptTrace != null) {
                    out.write(buildSSEBytes("concept_trace", conceptTrace));
                    out.flush();
                }

                Object usedConcepts = result.get("usedConcepts");
                if (usedConcepts != null) {
                    out.write(buildSSEBytes("used_concepts", usedConcepts));
                    out.flush();
                }

                Object reasoning = result.get("reasoning");
                if (reasoning != null) {
                    out.write(buildSSEBytes("reasoning", reasoning));
                    out.flush();
                }

                Object toolCalls = result.get("toolCalls");
                if (toolCalls != null) {
                    out.write(buildSSEBytes("tool_calls", toolCalls));
                    out.flush();
                }

                Object nl2sql = result.get("nl2sql");
                if (nl2sql != null) {
                    String payload = objectMapper.writeValueAsString(nl2sql);
                    agentDebug.info("[SSE] nl2sql event, payloadLen={}, payload=[{}]", payload.length(), payload);
                    out.write(buildSSEBytes("nl2sql", nl2sql));
                    out.flush();
                }

                Object queryResult = result.get("queryResult");
                if (queryResult != null) {
                    out.write(buildSSEBytes("query_result", queryResult));
                    out.flush();
                }

                Object selectDatasources = result.get("select_datasources");
                if (selectDatasources != null) {
                    out.write(buildSSEBytes("select_datasources", selectDatasources));
                    out.flush();
                }

                Object rootCause = result.get("rootCause");
                if (rootCause != null && !rootCause.toString().isEmpty()) {
                    out.write(buildSSEBytes("root_cause", rootCause));
                    out.flush();
                }
                Object suggestion = result.get("suggestion");
                if (suggestion != null && !suggestion.toString().isEmpty()) {
                    out.write(buildSSEBytes("suggestion", suggestion));
                    out.flush();
                }
                Object evidence = result.get("evidence");
                if (evidence instanceof java.util.List && !((java.util.List<?>) evidence).isEmpty()) {
                    out.write(buildSSEBytes("evidence", evidence));
                    out.flush();
                }

                String answer = (String) result.getOrDefault("answer",
                        result.getOrDefault("content", ""));
                if (answer != null && !answer.isEmpty()) {
                    String[] lines = answer.split("\n", -1);
                    for (int i = 0; i < lines.length; i++) {
                        String payload = lines[i];
                        if (i < lines.length - 1) {
                            payload += "\n";
                        }
                        out.write(buildSSEBytes("delta", payload));
                        out.flush();
                        if (i < lines.length - 1) {
                            try {
                                Thread.sleep(30);
                            } catch (InterruptedException e) {
                                Thread.currentThread().interrupt();
                                break;
                            }
                        }
                    }
                }

                Map<String, Object> done = new LinkedHashMap<>();
                done.put("sessionId", sessionId);
                done.put("messageId", result.get("messageId"));
                out.write(buildSSEBytes("done", done));
                out.flush();
                out.close();
            } catch (Exception e) {
                log.error("SSE stream error", e);
                try {
                    ServletOutputStream out = response.getOutputStream();
                    out.write(buildSSEBytes("error", "服务异常: " + e.getMessage()));
                    out.flush();
                    out.close();
                } catch (IOException ignored) {
                }
            } finally {
                asyncContext.complete();
            }
        });
    }

    

    @PostMapping("/chat/clear")
    public ResponseEntity<Map<String, Object>> clearSession(@RequestBody Map<String, Object> params) {
        String sessionId = (String) params.get("sessionId");
        if (sessionId != null) {
            agentService.clearSession(sessionId);
        }
        return ResponseEntity.ok(Map.of("success", true));
    }

    /**
     * 开发助手 SSE 代理端点。
     * 前端开发助手不再直连 LLM API，而是通过此后端代理转发，
     * 实现 API Key 保护（前端不可见）。
     */
    @PostMapping(value = "/dev/chat/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public void devChatStream(@RequestBody Map<String, Object> params, HttpServletRequest request,
                              HttpServletResponse response) {
        Long userId = getCurrentUserId();
        log.info("Dev chat stream request: userId={}", userId);

        try {
            AgentConfig config = agentConfigService.getDefault();
            log.info("Using default agent config: name={}, model={}, endpoint={}",
                    config.getName(), config.getModelName(), config.getModelEndpoint());
        } catch (Exception e) {
            log.error("No default agent config found", e);
            response.setStatus(500);
            try {
                response.setContentType("text/event-stream");
                response.setCharacterEncoding("UTF-8");
                response.getWriter().write("event: error\ndata: 未配置默认大模型，请联系管理员在系统配置中设置\n\n");
                response.getWriter().flush();
            } catch (IOException ignored) {
            }
            return;
        }

        response.setHeader("X-Accel-Buffering", "no");
        response.setHeader("Cache-Control", "no-cache");
        response.setContentType("text/event-stream");
        response.setCharacterEncoding("UTF-8");
        try {
            response.flushBuffer();
        } catch (IOException e) {
            log.warn("Failed to flush response buffer", e);
        }

        AsyncContext asyncContext = request.startAsync();
        asyncContext.setTimeout(300000);

        CompletableFuture.runAsync(() -> {
            try {
                ServletOutputStream out = response.getOutputStream();
                AgentConfig config = agentConfigService.getDefault();

                @SuppressWarnings("unchecked")
                List<Map<String, Object>> messages = (List<Map<String, Object>>) params.get("messages");
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> tools = (List<Map<String, Object>>) params.get("tools");
                Double temperature = params.get("temperature") instanceof Number
                        ? ((Number) params.get("temperature")).doubleValue() : 0.7;

                Map<String, Object> body = new LinkedHashMap<>();
                body.put("model", config.getModelName());
                body.put("messages", messages != null ? messages : List.of());
                if (tools != null && !tools.isEmpty()) {
                    body.put("tools", tools);
                    body.put("tool_choice", "auto");
                }
                body.put("temperature", temperature);
                body.put("max_tokens", 16384);
                body.put("stream", true);

                String chatUrl = agentConfigService.normalizeChatUrl(config.getModelEndpoint());
                String apiKey = agentConfigService.decrypt(config.getSecretKeyEnc());
                log.info("Dev proxy LLM call: url={}, model={}, messagesCount={}, toolsCount={}",
                        chatUrl, config.getModelName(),
                        messages != null ? messages.size() : 0,
                        tools != null ? tools.size() : 0);

                HttpRequest llmRequest = HttpRequest.newBuilder()
                        .uri(URI.create(chatUrl))
                        .header("Content-Type", "application/json")
                        .header("Authorization", "Bearer " + apiKey)
                        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                        .timeout(LLM_HARD_TIMEOUT)
                        .build();

                CompletableFuture<Void> resultFuture = new CompletableFuture<>();
                AtomicReference<java.util.concurrent.ScheduledFuture<?>> idleWatchdog = new AtomicReference<>();
                AtomicBoolean firstTokenLogged = new AtomicBoolean(false);
                long startTime = System.currentTimeMillis();

                Runnable resetIdleTimer = () -> {
                    java.util.concurrent.ScheduledFuture<?> old = idleWatchdog.get();
                    if (old != null) old.cancel(false);
                    idleWatchdog.set(idleExecutor.schedule(() -> {
                        if (!resultFuture.isDone()) {
                            log.warn("Dev proxy LLM streaming idle timeout after {}s", LLM_IDLE_TIMEOUT.getSeconds());
                            resultFuture.completeExceptionally(
                                    new java.util.concurrent.TimeoutException("LLM 流式空闲超时"));
                        }
                    }, LLM_IDLE_TIMEOUT.toSeconds(), TimeUnit.SECONDS));
                };

                httpClient.sendAsync(llmRequest, HttpResponse.BodyHandlers.ofLines())
                        .thenAccept(llmResponse -> {
                            try {
                                if (llmResponse.statusCode() != 200) {
                                    StringBuilder errorBody = new StringBuilder();
                                    llmResponse.body().forEach(line -> errorBody.append(line).append("\n"));
                                    log.error("Dev proxy LLM API error: status={}, url={}, body={}",
                                            llmResponse.statusCode(), chatUrl, errorBody.toString().trim());

                                    String errorMsg;
                                    if (llmResponse.statusCode() == 401 || llmResponse.statusCode() == 403) {
                                        errorMsg = "LLM 认证失败（" + llmResponse.statusCode() + "），请联系管理员更新 API Key";
                                    } else if (llmResponse.statusCode() == 429) {
                                        errorMsg = "LLM 服务繁忙，请稍后重试";
                                    } else {
                                        errorMsg = "LLM 服务返回错误: " + llmResponse.statusCode();
                                    }
                                    out.write(buildSSEBytes("error", errorMsg));
                                    out.flush();
                                    resultFuture.complete(null);
                                    return;
                                }
                                resetIdleTimer.run();
                                llmResponse.body().forEach(line -> {
                                    resetIdleTimer.run();
                                    if (!line.startsWith("data: ")) {
                                        if (!line.isEmpty()) {
                                            log.debug("Dev proxy non-SSE line: {}", line);
                                        }
                                        return;
                                    }
                                    String data = line.substring(6).trim();
                                    if ("[DONE]".equals(data)) {
                                        return;
                                    }
                                    try {
                                        Map<String, Object> chunk = objectMapper.readValue(data,
                                                new TypeReference<Map<String, Object>>() {});
                                        @SuppressWarnings("unchecked")
                                        List<Map<String, Object>> choices = (List<Map<String, Object>>) chunk.get("choices");
                                        if (choices != null && !choices.isEmpty()) {
                                            @SuppressWarnings("unchecked")
                                            Map<String, Object> delta = (Map<String, Object>) choices.get(0).get("delta");
                                            if (delta != null) {
                                                String content = (String) delta.get("content");
                                                String reasoningContent = (String) delta.get("reasoning_content");

                                                if (reasoningContent != null && !reasoningContent.isEmpty()) {
                                                    out.write(buildSSEBytes("delta",
                                                            objectMapper.writeValueAsString(Map.of(
                                                                    "content", reasoningContent,
                                                                    "reasoning", true))));
                                                    out.flush();
                                                }
                                                if (content != null && !content.isEmpty()) {
                                                    if (!firstTokenLogged.getAndSet(true)) {
                                                        long ttft = System.currentTimeMillis() - startTime;
                                                        log.info("Dev proxy LLM TTFT: {}ms", ttft);
                                                    }
                                                    out.write(buildSSEBytes("delta",
                                                            objectMapper.writeValueAsString(Map.of(
                                                                    "content", content))));
                                                    out.flush();
                                                }
                                                @SuppressWarnings("unchecked")
                                                List<Map<String, Object>> toolCalls = (List<Map<String, Object>>) delta.get("tool_calls");
                                                if (toolCalls != null && !toolCalls.isEmpty()) {
                                                    out.write(buildSSEBytes("delta",
                                                            objectMapper.writeValueAsString(Map.of(
                                                                    "tool_calls", toolCalls))));
                                                    out.flush();
                                                }
                                            }
                                        }
                                    } catch (Exception e) {
                                        log.debug("Dev proxy failed to parse streaming chunk: {}", line);
                                    }
                                });
                                long total = System.currentTimeMillis() - startTime;
                                log.info("Dev proxy LLM streaming completed: total={}ms", total);
                                out.write(buildSSEBytes("done", Map.of("success", true)));
                                out.flush();
                                resultFuture.complete(null);
                            } catch (Exception e) {
                                resultFuture.completeExceptionally(e);
                            }
                        })
                        .exceptionally(ex -> {
                            resultFuture.completeExceptionally(ex);
                            return null;
                        });

                try {
                    resultFuture.join();
                } catch (Exception e) {
                    Throwable cause = e.getCause();
                    String msg = cause != null ? cause.getMessage() : e.getMessage();
                    log.error("Dev proxy LLM streaming failed", cause != null ? cause : e);
                    out.write(buildSSEBytes("error",
                            "LLM 流式调用失败: " + (msg != null ? msg : "未知错误")));
                    out.flush();
                } finally {
                    java.util.concurrent.ScheduledFuture<?> sf = idleWatchdog.get();
                    if (sf != null) sf.cancel(false);
                }
                out.close();
            } catch (Exception e) {
                log.error("Dev proxy SSE stream error", e);
                try {
                    ServletOutputStream out = response.getOutputStream();
                    out.write(buildSSEBytes("error", "服务异常: " + e.getMessage()));
                    out.flush();
                    out.close();
                } catch (IOException ignored) {
                }
            } finally {
                asyncContext.complete();
            }
        });
    }

    private Long getCurrentUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof com.luban.entity.User user) {
            return user.getId();
        }
        return 1L;
    }

    private String getCurrentUserName() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof com.luban.entity.User user) {
            String name = user.getName();
            return (name != null && !name.isEmpty()) ? name : user.getAccount();
        }
        return "unknown";
    }

    @GetMapping("/sessions/{sessionId}/messages")
    public ResponseEntity<?> getSessionMessages(@PathVariable String sessionId) {
        return ResponseEntity.ok(Map.of(
                "sessionId", sessionId,
                "messages", agentService.getSessionMessages(sessionId)
        ));
    }

    private byte[] buildSSEBytes(String event, Object data) {
        StringBuilder sb = new StringBuilder();
        sb.append("event: ").append(event).append("\n");
        String content;
        if (data instanceof String s) {
            content = s;
        } else {
            try {
                content = objectMapper.writeValueAsString(data);
            } catch (JsonProcessingException e) {
                content = String.valueOf(data);
            }
        }
        for (String line : content.split("\n")) {
            sb.append("data: ").append(line).append("\n");
        }
        sb.append("\n");
        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }
}