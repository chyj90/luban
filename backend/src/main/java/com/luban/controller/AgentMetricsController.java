package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.service.AgentMetricsService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/agent-metrics")
@RequiredArgsConstructor
public class AgentMetricsController {

    private final AgentMetricsService metricsService;

    @GetMapping("/overview")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> overview(
            @RequestParam(defaultValue = "168") long hours) {
        return ResponseEntity.ok(ApiResponse.ok(metricsService.getOverview(sinceHours(hours))));
    }

    @GetMapping("/concept-health")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> conceptHealth(
            @RequestParam(defaultValue = "168") long hours) {
        return ResponseEntity.ok(ApiResponse.ok(metricsService.getConceptHealth(sinceHours(hours))));
    }

    @GetMapping("/requests")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> requests(
            @RequestParam(defaultValue = "168") long hours,
            @RequestParam(defaultValue = "false") boolean failedOnly,
            @RequestParam(defaultValue = "200") int limit) {
        int capped = Math.min(Math.max(limit, 1), 300);
        return ResponseEntity.ok(ApiResponse.ok(metricsService.getRequests(sinceHours(hours), failedOnly, capped)));
    }

    @GetMapping("/recent-anomalies")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> recentAnomalies(
            @RequestParam(defaultValue = "168") long hours) {
        return ResponseEntity.ok(ApiResponse.ok(metricsService.getRecentAnomalies(sinceHours(hours))));
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

    /** 时间窗口收敛到 1 小时 ~ 31 天，避免无界查询 */
    private LocalDateTime sinceHours(long hours) {
        long h = Math.min(Math.max(hours, 1), 24 * 31);
        return LocalDateTime.now().minusHours(h);
    }
}