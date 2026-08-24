package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.entity.ConceptSnapshot;
import com.luban.service.ConceptSnapshotService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/concept-snapshots")
@RequiredArgsConstructor
public class ConceptSnapshotController {

    private final ConceptSnapshotService snapshotService;

    @PostMapping
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<ConceptSnapshot>> create(@RequestBody Map<String, Object> body) {
        Long groupId = Long.valueOf(body.get("groupId").toString());
        String version = (String) body.get("version");
        String comment = (String) body.getOrDefault("comment", "");
        String createdBy = (String) body.getOrDefault("createdBy", "system");
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(snapshotService.createSnapshot(groupId, version, comment, createdBy)));
    }

    @GetMapping
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<List<ConceptSnapshot>>> list() {
        return ResponseEntity.ok(ApiResponse.ok(snapshotService.listSnapshots()));
    }

    @GetMapping("/{id}")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<ConceptSnapshot>> get(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(snapshotService.getSnapshot(id)));
    }

    @GetMapping("/diff")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> diff(
            @RequestParam Long fromId, @RequestParam Long toId) {
        return ResponseEntity.ok(ApiResponse.ok(snapshotService.diffSnapshots(fromId, toId)));
    }

    @PostMapping("/{id}/rollback")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> rollback(
            @PathVariable Long id, @RequestBody Map<String, String> body) {
        String reviewedBy = body.getOrDefault("reviewedBy", "system");
        return ResponseEntity.ok(ApiResponse.ok(snapshotService.rollbackToSnapshot(id, reviewedBy)));
    }
}