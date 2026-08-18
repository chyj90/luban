package com.luban.controller;

import com.luban.service.AgentService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/agent")
@RequiredArgsConstructor
public class AgentController {

    private final AgentService agentService;

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

        Map<String, Object> result = agentService.chat(sessionId, message);
        result.put("sessionId", sessionId);
        return ResponseEntity.ok(result);
    }

    @PostMapping("/tool-call")
    public ResponseEntity<Map<String, Object>> proxyToolCall(@RequestBody Map<String, Object> params) {
        String toolName = (String) params.get("tool");
        @SuppressWarnings("unchecked")
        Map<String, Object> arguments = (Map<String, Object>) params.getOrDefault("arguments", Map.of());

        if (toolName == null || toolName.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "tool name is required"));
        }

        String result = agentService.executeToolByName(toolName, arguments);
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("tool", toolName);
        response.put("result", result);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/chat/clear")
    public ResponseEntity<Map<String, Object>> clearSession(@RequestBody Map<String, Object> params) {
        String sessionId = (String) params.get("sessionId");
        if (sessionId != null) {
            agentService.clearSession(sessionId);
        }
        return ResponseEntity.ok(Map.of("success", true));
    }
}