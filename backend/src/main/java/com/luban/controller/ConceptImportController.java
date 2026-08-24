package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.dto.ConceptImportRequest;
import com.luban.service.ConceptImportService;
import com.luban.entity.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/v1/concepts/import")
@RequiredArgsConstructor
public class ConceptImportController {

    private final ConceptImportService conceptImportService;

    @PostMapping("/preview")
    public ResponseEntity<ApiResponse<Map<String, Object>>> preview(@RequestBody ConceptImportRequest request) {
        Map<String, Object> result = conceptImportService.preview(
                request.getSourceType(),
                request.getContent(),
                request.getUrl(),
                request.getIndustryId(),
                request.getGroupId()
        );
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    @PostMapping("/execute")
    public ResponseEntity<ApiResponse<Map<String, Object>>> execute(@RequestBody ConceptImportRequest request) {
        Map<String, Object> result = conceptImportService.execute(
                request.getSourceType(),
                request.getContent(),
                request.getUrl(),
                request.getIndustryId(),
                request.getGroupId(),
                request.getSelectedItems()
        );
        if (result.containsKey("error")) {
            return ResponseEntity.ok(ApiResponse.error((String) result.get("error")));
        }
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    // ===== 异步导入端点 =====

    @PostMapping(value = "/preview/async", consumes = "multipart/form-data")
    public ResponseEntity<ApiResponse<Map<String, Object>>> previewAsync(
            @RequestParam(value = "file", required = false) MultipartFile file,
            @RequestParam("sourceType") String sourceType,
            @RequestParam(value = "content", required = false) String content,
            @RequestParam(value = "url", required = false) String url,
            @RequestParam(value = "industryId", defaultValue = "auto") String industryIdStr,
            @RequestParam(value = "groupId", defaultValue = "auto") String groupIdStr) {
        Long industryId = "auto".equals(industryIdStr) ? null : Long.valueOf(industryIdStr);
        Long groupId = "auto".equals(groupIdStr) ? null : Long.valueOf(groupIdStr);
        Long userId = getCurrentUserId();
        try {
            long taskId = conceptImportService.previewAsync(
                    sourceType,
                    file != null ? file.getBytes() : null,
                    content,
                    url,
                    industryId,
                    groupId,
                    userId
            );
            return ResponseEntity.ok(ApiResponse.ok(Map.of("taskId", taskId, "status", "ok", "message", "导入预览任务已提交")));
        } catch (Exception e) {
            log.error("异步预览失败", e);
            return ResponseEntity.ok(ApiResponse.error("提交失败: " + e.getMessage()));
        }
    }

    @PostMapping("/execute-from-task")
    public ResponseEntity<ApiResponse<Map<String, Object>>> executeFromTask(@RequestBody Map<String, Object> body) {
        Long taskId = body.get("taskId") instanceof Number n ? n.longValue() : null;
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> selectedItems = (List<Map<String, Object>>) body.get("selectedItems");
        if (taskId == null || selectedItems == null) {
            return ResponseEntity.ok(ApiResponse.error("缺少 taskId 或 selectedItems"));
        }
        Map<String, Object> result = conceptImportService.executeFromTask(taskId, selectedItems);
        if (result.containsKey("error")) {
            return ResponseEntity.ok(ApiResponse.error((String) result.get("error")));
        }
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    private Long getCurrentUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof User user) {
            return user.getId();
        }
        return null;
    }
}