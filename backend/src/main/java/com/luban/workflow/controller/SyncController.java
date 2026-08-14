package com.luban.workflow.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/sync")
@RequiredArgsConstructor
public class SyncController {

    @PostMapping("/organization")
    public ResponseEntity<Map<String, Object>> syncOrganization() {
        Map<String, Object> result = Map.of(
            "status", "success",
            "message", "组织同步任务已触发"
        );
        return ResponseEntity.ok(result);
    }

    @PostMapping("/organization/callback")
    public ResponseEntity<Map<String, Object>> syncCallback(@RequestBody Map<String, Object> payload) {
        Map<String, Object> result = Map.of(
            "status", "received",
            "message", "外部组织同步回调已接收"
        );
        return ResponseEntity.ok(result);
    }
}