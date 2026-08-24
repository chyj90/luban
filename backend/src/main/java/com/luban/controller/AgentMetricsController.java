package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.service.AgentMetricsService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/agent-metrics")
@RequiredArgsConstructor
public class AgentMetricsController {

    private final AgentMetricsService metricsService;

    @GetMapping("/overview")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> overview() {
        return ResponseEntity.ok(ApiResponse.ok(metricsService.getOverview()));
    }

    @GetMapping("/concept-health")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> conceptHealth() {
        return ResponseEntity.ok(ApiResponse.ok(metricsService.getConceptHealth()));
    }

    @GetMapping("/recent-anomalies")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> recentAnomalies() {
        return ResponseEntity.ok(ApiResponse.ok(metricsService.getRecentAnomalies()));
    }

    @GetMapping("/query-detail")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> queryDetail(@RequestParam String messageId) {
        return ResponseEntity.ok(ApiResponse.ok(metricsService.getQueryDetail(messageId)));
    }

    @GetMapping("/faiss-health")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> faissHealth() {
        return ResponseEntity.ok(ApiResponse.ok(metricsService.getFaissHealth()));
    }
}