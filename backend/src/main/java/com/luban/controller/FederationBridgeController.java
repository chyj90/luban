package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.entity.FederationBridge;
import com.luban.service.FederationBridgeService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/federation-bridges")
@RequiredArgsConstructor
@RequirePermission(Permissions.CONNECT_CONCEPTS)
public class FederationBridgeController {

    private final FederationBridgeService bridgeService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> list() {
        return ResponseEntity.ok(ApiResponse.ok(bridgeService.list()));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<FederationBridge>> create(@RequestBody FederationBridge bridge) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(bridgeService.create(bridge)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        bridgeService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}
