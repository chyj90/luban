package com.luban.controller;

import com.luban.dto.*;
import com.luban.service.PageService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/pages")
public class PageController {

    private final PageService pageService;

    public PageController(PageService pageService) {
        this.pageService = pageService;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> list(@RequestParam Long applicationId) {
        return ResponseEntity.ok(ApiResponse.ok(pageService.listByApplication(applicationId)));
    }

    @PostMapping("/code")
    public ResponseEntity<ApiResponse<Map<String, Object>>> createCodePage(
            @Valid @RequestBody CreateCodePageRequest request) {
        Map<String, Object> page = pageService.createCodePage(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(page));
    }

    @GetMapping("/{id}/code")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getCodePage(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.ok(pageService.getCodePage(id)));
    }

    @PutMapping("/{id}/code")
    public ResponseEntity<ApiResponse<Map<String, Object>>> updateCodePage(
            @PathVariable Long id, @RequestBody UpdateCodePageRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(pageService.updateCodePage(id, request)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> rename(
            @PathVariable Long id, @RequestBody Map<String, String> body) {
        String name = body.get("name");
        return ResponseEntity.ok(ApiResponse.ok(pageService.renamePage(id, name)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        pageService.delete(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}