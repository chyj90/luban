package com.luban.workflow.controller;

import com.luban.workflow.service.ExcelImportService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.util.*;

@RestController
@RequestMapping("/api/v1/excel")
@RequiredArgsConstructor
public class ExcelController {

    private final ExcelImportService excelImportService;

    @PostMapping("/parse")
    public ResponseEntity<Map<String, Object>> parse(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "columnMapping", required = false) String columnMappingJson) {
        try {
            List<Map<String, String>> columnMapping = new ArrayList<>();
            if (columnMappingJson != null && !columnMappingJson.isEmpty()) {
                columnMapping = new com.fasterxml.jackson.databind.ObjectMapper()
                        .readValue(columnMappingJson, new com.fasterxml.jackson.core.type.TypeReference<>() {});
            }

            ExcelImportService.ExcelParseResult result = excelImportService.parse(file, columnMapping);

            Map<String, Object> response = new LinkedHashMap<>();
            response.put("headers", result.headers);
            response.put("rows", result.rows);
            response.put("errors", result.errors);
            response.put("totalRows", result.totalRows);
            response.put("validRows", result.validRows);
            response.put("errorRows", result.errorRows);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", "Excel 解析失败: " + e.getMessage()));
        }
    }

    @PostMapping("/guess-mapping")
    public ResponseEntity<Map<String, Object>> guessMapping(@RequestBody Map<String, Object> params) {
        @SuppressWarnings("unchecked")
        List<String> excelHeaders = (List<String>) params.get("excelHeaders");
        @SuppressWarnings("unchecked")
        List<String> fieldKeys = (List<String>) params.get("fieldKeys");

        if (excelHeaders == null || fieldKeys == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "excelHeaders 和 fieldKeys 不能为空"));
        }

        List<Map<String, String>> mapping = excelImportService.guessColumnMapping(excelHeaders, fieldKeys);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("mapping", mapping);
        return ResponseEntity.ok(response);
    }
}