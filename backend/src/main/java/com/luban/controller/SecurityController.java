package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.security.RsaKeyProvider;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 传输层信封加密公钥下发端点：前端提交敏感字段前拉取公钥，RSA-OAEP 加密后再上传。
 */
@RestController
@RequestMapping("/api/v1/security")
public class SecurityController {

    private final RsaKeyProvider rsaKeyProvider;

    public SecurityController(RsaKeyProvider rsaKeyProvider) {
        this.rsaKeyProvider = rsaKeyProvider;
    }

    @GetMapping("/public-key")
    public ApiResponse<Map<String, String>> publicKey() {
        return ApiResponse.ok(Map.of("publicKey", rsaKeyProvider.publicKeyPem()));
    }
}