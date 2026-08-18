package com.luban.service;

import com.luban.entity.ApiKey;
import com.luban.entity.ApiKeyTool;
import com.luban.entity.ToolDefinition;
import com.luban.repository.ApiKeyRepository;
import com.luban.repository.ApiKeyToolRepository;
import com.luban.repository.ToolDefinitionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.*;

@Service
public class ApiKeyService {

    private static final String KEY_PREFIX = "lb_";
    private static final int KEY_LENGTH = 48;

    private final ApiKeyRepository apiKeyRepository;
    private final ApiKeyToolRepository apiKeyToolRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;

    public ApiKeyService(ApiKeyRepository apiKeyRepository,
                         ApiKeyToolRepository apiKeyToolRepository,
                         ToolDefinitionRepository toolDefinitionRepository) {
        this.apiKeyRepository = apiKeyRepository;
        this.apiKeyToolRepository = apiKeyToolRepository;
        this.toolDefinitionRepository = toolDefinitionRepository;
    }

    public List<ApiKey> listByOwner(Long ownerId) {
        return apiKeyRepository.findByOwnerId(ownerId);
    }

    public List<ApiKeyTool> listKeyTools(Long apiKeyId) {
        return apiKeyToolRepository.findByApiKeyId(apiKeyId);
    }

    public List<ToolDefinition> listAvailableTools() {
        return toolDefinitionRepository.findByStatus("ENABLED");
    }

    @Transactional
    public Map<String, String> generateKey(Long ownerId, String name) {
        String rawKey = generateRawKey();
        String keyPreview = rawKey.substring(0, 12) + "..." + rawKey.substring(rawKey.length() - 4);

        ApiKey apiKey = new ApiKey();
        apiKey.setKeyHash(sha256(rawKey));
        apiKey.setKeyPrefix(rawKey.substring(0, 12));
        apiKey.setName(name);
        apiKey.setOwnerId(ownerId);
        apiKey.setStatus("ACTIVE");
        apiKey.setCreatedAt(LocalDateTime.now());
        apiKeyRepository.save(apiKey);

        Map<String, String> result = new LinkedHashMap<>();
        result.put("id", apiKey.getId().toString());
        result.put("key", rawKey);
        result.put("keyPreview", keyPreview);
        result.put("name", name);
        return result;
    }

    @Transactional
    public ApiKeyTool requestToolPermission(Long apiKeyId, Long toolId) {
        ApiKey apiKey = apiKeyRepository.findById(apiKeyId)
                .orElseThrow(() -> new RuntimeException("API Key 不存在"));

        if (apiKeyToolRepository.findByApiKeyIdAndToolId(apiKeyId, toolId).isPresent()) {
            throw new RuntimeException("该工具权限已申请或已获批");
        }

        ApiKeyTool keyTool = new ApiKeyTool();
        keyTool.setApiKeyId(apiKeyId);
        keyTool.setToolId(toolId);
        keyTool.setStatus("PENDING");
        return apiKeyToolRepository.save(keyTool);
    }

    @Transactional
    public ApiKeyTool approveToolPermission(Long apiKeyToolId) {
        ApiKeyTool keyTool = apiKeyToolRepository.findById(apiKeyToolId)
                .orElseThrow(() -> new RuntimeException("权限申请不存在"));
        if (!"PENDING".equals(keyTool.getStatus())) {
            throw new RuntimeException("该申请状态不是待审批");
        }
        keyTool.setStatus("APPROVED");
        return apiKeyToolRepository.save(keyTool);
    }

    @Transactional
    public ApiKeyTool rejectToolPermission(Long apiKeyToolId) {
        ApiKeyTool keyTool = apiKeyToolRepository.findById(apiKeyToolId)
                .orElseThrow(() -> new RuntimeException("权限申请不存在"));
        keyTool.setStatus("REJECTED");
        return apiKeyToolRepository.save(keyTool);
    }

    @Transactional
    public void revokeKey(Long apiKeyId) {
        ApiKey apiKey = apiKeyRepository.findById(apiKeyId)
                .orElseThrow(() -> new RuntimeException("API Key 不存在"));
        apiKey.setStatus("REVOKED");
        apiKeyRepository.save(apiKey);
    }

    public Optional<ApiKey> validateAndGetKey(String rawKey) {
        String hash = sha256(rawKey);
        return apiKeyRepository.findByKeyHash(hash)
                .filter(k -> "ACTIVE".equals(k.getStatus()))
                .filter(k -> k.getExpiresAt() == null || k.getExpiresAt().isAfter(LocalDateTime.now()));
    }

    public boolean hasToolPermission(Long apiKeyId, Long toolId) {
        return apiKeyToolRepository.findByApiKeyIdAndToolId(apiKeyId, toolId)
                .map(kt -> "APPROVED".equals(kt.getStatus()))
                .orElse(false);
    }

    public void recordUsage(Long apiKeyId) {
        apiKeyRepository.findById(apiKeyId).ifPresent(key -> {
            key.setLastUsedAt(LocalDateTime.now());
            apiKeyRepository.save(key);
        });
    }

    private String generateRawKey() {
        byte[] bytes = new byte[KEY_LENGTH];
        new SecureRandom().nextBytes(bytes);
        return KEY_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String sha256(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : hash) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (Exception e) {
            throw new RuntimeException("SHA-256 failed", e);
        }
    }
}