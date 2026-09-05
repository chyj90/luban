package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.service.PipelineTraceService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/pipeline-trace")
@RequiredArgsConstructor
public class PipelineTraceController {

    private final PipelineTraceService pipelineTraceService;

    @GetMapping("/{pipelineId}")
    @RequirePermission(Permissions.CONNECT_CONCEPTS)
    public ResponseEntity<ApiResponse<Map<String, Object>>> getTraceWithStages(
            @PathVariable String pipelineId) {
        return ResponseEntity.ok(ApiResponse.ok(pipelineTraceService.getTraceWithStages(pipelineId)));
    }
}