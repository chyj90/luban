package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.dto.CreateJsFunctionRequest;
import com.luban.service.JsFunctionService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/js-functions")
public class JsFunctionController {

    private final JsFunctionService jsFunctionService;

    public JsFunctionController(JsFunctionService jsFunctionService) {
        this.jsFunctionService = jsFunctionService;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> list(@RequestParam Long pageId) {
        return ResponseEntity.ok(ApiResponse.ok(jsFunctionService.listByPage(pageId)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<Map<String, Object>>> create(
            @Valid @RequestBody CreateJsFunctionRequest request) {
        Map<String, Object> fn = jsFunctionService.create(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(fn));
    }
}