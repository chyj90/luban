package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.entity.JdbcDriver;
import com.luban.service.JdbcDriverService;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;

@RestController
@RequestMapping("/api/v1/drivers")
public class JdbcDriverController {

    private final JdbcDriverService driverService;

    public JdbcDriverController(JdbcDriverService driverService) {
        this.driverService = driverService;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<JdbcDriver>>> list() {
        return ResponseEntity.ok(ApiResponse.ok(driverService.listAll()));
    }

    @GetMapping(value = "/{name}/install", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter install(@PathVariable String name, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-cache, no-store, max-age=0, must-revalidate");
        response.setHeader("Pragma", "no-cache");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("X-Frame-Options", "DENY");
        response.setHeader("X-XSS-Protection", "0");
        return driverService.install(name);
    }
}