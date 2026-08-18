package com.luban.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/mock-mes")
public class MockMesController {

    private static final Map<String, Map<String, Object>> DEVICES = Map.of(
            "CNC-01", Map.of("device_id", "CNC-01", "device_name", "CNC加工中心-01",
                    "device_type", "CNC", "status", "RUNNING", "spindle_speed", 8000,
                    "workshop", "A车间", "today_output", 120, "temperature", 42.5),
            "CNC-02", Map.of("device_id", "CNC-02", "device_name", "CNC加工中心-02",
                    "device_type", "CNC", "status", "IDLE", "spindle_speed", 0,
                    "workshop", "A车间", "today_output", 0, "temperature", 35.2),
            "CNC-03", Map.of("device_id", "CNC-03", "device_name", "CNC加工中心-03",
                    "device_type", "CNC", "status", "MAINTENANCE", "spindle_speed", 0,
                    "workshop", "B车间", "today_output", 0, "temperature", 28.0),
            "ROBOT-01", Map.of("device_id", "ROBOT-01", "device_name", "焊接机器人-01",
                    "device_type", "ROBOT", "status", "RUNNING", "spindle_speed", 0,
                    "workshop", "B车间", "today_output", 85, "temperature", 38.1),
            "INJ-01", Map.of("device_id", "INJ-01", "device_name", "注塑机-01",
                    "device_type", "INJECTION", "status", "IDLE", "spindle_speed", 0,
                    "workshop", "C车间", "today_output", 0, "temperature", 45.0)
    );

    @GetMapping("/device/{deviceId}/status")
    public ResponseEntity<Map<String, Object>> getDeviceStatus(@PathVariable String deviceId) {
        Map<String, Object> device = DEVICES.get(deviceId);
        if (device == null) {
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("error", "device_not_found");
            error.put("message", "设备 " + deviceId + " 不存在");
            return ResponseEntity.status(404).body(error);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("data", device);
        return ResponseEntity.ok(result);
    }

    @PostMapping("/work-order")
    public ResponseEntity<Map<String, Object>> createWorkOrder(@RequestBody Map<String, Object> request) {
        String deviceId = (String) request.get("device_id");
        String description = (String) request.get("description");
        String priority = (String) request.getOrDefault("priority", "NORMAL");

        if (deviceId == null || deviceId.isBlank()) {
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("error", "invalid_request");
            error.put("message", "device_id 为必填项");
            return ResponseEntity.badRequest().body(error);
        }

        Map<String, Object> workOrder = new LinkedHashMap<>();
        workOrder.put("work_order_id", "WO-" + System.currentTimeMillis());
        workOrder.put("device_id", deviceId);
        workOrder.put("description", description);
        workOrder.put("priority", priority);
        workOrder.put("status", "CREATED");
        workOrder.put("created_at", java.time.LocalDateTime.now().toString());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("data", workOrder);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/production/stats")
    public ResponseEntity<Map<String, Object>> getProductionStats(
            @RequestParam String startDate,
            @RequestParam String endDate) {

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("start_date", startDate);
        summary.put("end_date", endDate);
        summary.put("total_output", 5825);
        summary.put("target_output", 5500);
        summary.put("completion_rate", 105.9);
        summary.put("running_devices", 2);
        summary.put("idle_devices", 2);
        summary.put("maintenance_devices", 1);

        List<Map<String, Object>> dailyStats = List.of(
                Map.of("date", "2026-08-10", "output", 1200, "target", 1000, "rate", 120.0),
                Map.of("date", "2026-08-11", "output", 1150, "target", 1000, "rate", 115.0),
                Map.of("date", "2026-08-12", "output", 1300, "target", 1100, "rate", 118.2),
                Map.of("date", "2026-08-13", "output", 980, "target", 900, "rate", 108.9),
                Map.of("date", "2026-08-14", "output", 1050, "target", 1000, "rate", 105.0),
                Map.of("date", "2026-08-15", "output", 1100, "target", 1000, "rate", 110.0)
        );

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("summary", summary);
        result.put("daily_stats", dailyStats);
        return ResponseEntity.ok(result);
    }
}