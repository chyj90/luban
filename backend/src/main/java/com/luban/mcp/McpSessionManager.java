package com.luban.mcp;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
@RequiredArgsConstructor
public class McpSessionManager {

    private final ObjectMapper objectMapper;
    private final ConcurrentHashMap<String, McpSession> sessions = new ConcurrentHashMap<>();

    public McpSession createSession(String sessionId) {
        SseEmitter emitter = new SseEmitter(0L);
        McpSession session = new McpSession(sessionId, emitter);

        emitter.onCompletion(() -> {
            log.info("MCP session completed: {}", sessionId);
            sessions.remove(sessionId);
        });

        emitter.onTimeout(() -> {
            log.info("MCP session timeout: {}", sessionId);
            sessions.remove(sessionId);
        });

        emitter.onError(throwable -> {
            log.error("MCP session error: {}", sessionId, throwable);
            sessions.remove(sessionId);
        });

        sessions.put(sessionId, session);

        try {
            emitter.send(SseEmitter.event()
                    .name("endpoint")
                    .data("/mcp/message?sessionId=" + sessionId));
        } catch (IOException e) {
            log.error("Failed to send endpoint event for session: {}", sessionId, e);
        }

        return session;
    }

    public McpSession getSession(String sessionId) {
        return sessions.get(sessionId);
    }

    public void sendEvent(String sessionId, String eventName, Object data) {
        McpSession session = sessions.get(sessionId);
        if (session == null) {
            log.warn("Session not found: {}", sessionId);
            return;
        }
        try {
            session.getEmitter().send(SseEmitter.event()
                    .name(eventName)
                    .data(objectMapper.writeValueAsString(data)));
        } catch (IOException e) {
            log.error("Failed to send event to session: {}", sessionId, e);
            sessions.remove(sessionId);
        }
    }

    public void removeSession(String sessionId) {
        McpSession session = sessions.remove(sessionId);
        if (session != null) {
            try {
                session.getEmitter().complete();
            } catch (Exception e) {
                log.warn("Error completing session emitter: {}", e.getMessage());
            }
        }
    }

    @Scheduled(fixedRate = 30000)
    public void sendHeartbeats() {
        for (Map.Entry<String, McpSession> entry : sessions.entrySet()) {
            try {
                entry.getValue().getEmitter().send(SseEmitter.event()
                        .name("heartbeat")
                        .data("ping"));
            } catch (IOException e) {
                log.warn("Heartbeat failed for session: {}, removing", entry.getKey());
                sessions.remove(entry.getKey());
            }
        }
    }
}