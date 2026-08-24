package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.entity.ConceptImportLog;
import com.luban.service.ConceptImportLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/concept-import-logs")
@RequiredArgsConstructor
public class ConceptImportLogController {

    private final ConceptImportLogService importLogService;

    @GetMapping
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<List<ConceptImportLog>>> list() {
        return ResponseEntity.ok(ApiResponse.ok(importLogService.listLogs()));
    }
}