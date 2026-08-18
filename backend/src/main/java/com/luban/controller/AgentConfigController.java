package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.dto.CreateAgentConfigRequest;
import com.luban.entity.AgentConfig;
import com.luban.service.AgentConfigService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/agent-configs")
@RequiredArgsConstructor
public class AgentConfigController {

    private final AgentConfigService agentConfigService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<AgentConfig>>> list() {
        return ResponseEntity.ok(ApiResponse.ok(agentConfigService.listAll()));
    }

    @GetMapping("/default")
    public ResponseEntity<ApiResponse<AgentConfig>> getDefault() {
        return ResponseEntity.ok(ApiResponse.ok(agentConfigService.getDefault()));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<AgentConfig>> create(@RequestBody CreateAgentConfigRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(agentConfigService.create(request)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<AgentConfig>> update(@PathVariable Long id, @RequestBody CreateAgentConfigRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(agentConfigService.update(id, request)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        agentConfigService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}