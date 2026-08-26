package com.luban.controller;

import com.luban.service.AgentService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import jakarta.servlet.AsyncContext;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

@Slf4j
@RestController
@RequestMapping("/api/v1/agent")
@RequiredArgsConstructor
public class AgentController {

    private final AgentService agentService;
    private final ObjectMapper objectMapper;

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