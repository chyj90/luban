package com.luban.controller;

import com.luban.dto.*;
import com.luban.entity.User;
import com.luban.repository.UserSessionRepository;
import com.luban.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class AuthController {

    private final AuthService authService;
    private final UserSessionRepository userSessionRepository;

    public AuthController(AuthService authService, UserSessionRepository userSessionRepository) {
        this.authService = authService;
        this.userSessionRepository = userSessionRepository;
    }

    @PostMapping("/auth/register")
    public ResponseEntity<ApiResponse<AuthResponse>> register(@Valid @RequestBody RegisterRequest request) {
        AuthResponse resp = authService.register(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(resp));
    }

    @PostMapping("/auth/login")
    public ResponseEntity<ApiResponse<AuthResponse>> login(@Valid @RequestBody LoginRequest request) {
        AuthResponse resp = authService.login(request);
        return ResponseEntity.ok(ApiResponse.ok(resp));
    }

    @PostMapping("/auth/logout")
    public ResponseEntity<ApiResponse<Void>> logout(@AuthenticationPrincipal User user) {
        if (user != null) {
            userSessionRepository.deleteByUserId(user.getId());
        }
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @GetMapping("/users/me")
    public ResponseEntity<ApiResponse<AuthResponse.UserInfo>> me(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(ApiResponse.ok(
                new AuthResponse.UserInfo(user.getId(), user.getEmail(), user.getName())));
    }
}