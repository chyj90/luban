package com.luban.controller;

import com.luban.mcp.JsonRpcRequest;
import com.luban.mcp.JsonRpcResponse;
import com.luban.mcp.McpMethodRouter;
import com.luban.mcp.McpSessionManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.UUID;

@Slf4j
@RestController
@RequestMapping("/mcp")
@RequiredArgsConstructor
public class McpGatewayController {

    private final McpSessionManager sessionManager;
    private final McpMethodRouter methodRouter;

    @GetMapping(value = "/sse", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter connect() {
        String sessionId = UUID.randomUUID().toString();
        log.info("MCP SSE connection established: {}", sessionId);
        return sessionManager.createSession(sessionId).getEmitter();
    }

    @PostMapping("/message")
    public ResponseEntity<JsonRpcResponse> handleMessage(
            @RequestParam String sessionId,
            @RequestBody JsonRpcRequest request) {

        if (!request.isValid()) {
            return ResponseEntity.badRequest()
                    .body(JsonRpcResponse.error(null, -32600, "Invalid Request", null));
        }

        log.info("MCP message: session={}, method={}, id={}", sessionId, request.getMethod(), request.getId());

        JsonRpcResponse response = methodRouter.dispatch(request);

        if (request.isNotification()) {
            return ResponseEntity.ok(response);
        }

        return ResponseEntity.ok(response);
    }
}