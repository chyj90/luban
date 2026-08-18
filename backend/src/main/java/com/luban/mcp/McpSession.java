package com.luban.mcp;

import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class McpSession {

    private final String sessionId;
    private final SseEmitter emitter;
    private final Map<String, Object> metadata;
    private boolean initialized;

    public McpSession(String sessionId, SseEmitter emitter) {
        this.sessionId = sessionId;
        this.emitter = emitter;
        this.metadata = new ConcurrentHashMap<>();
        this.initialized = false;
    }

    public String getSessionId() {
        return sessionId;
    }

    public SseEmitter getEmitter() {
        return emitter;
    }

    public Map<String, Object> getMetadata() {
        return metadata;
    }

    public boolean isInitialized() {
        return initialized;
    }

    public void setInitialized(boolean initialized) {
        this.initialized = initialized;
    }
}