package com.luban.service;

import com.luban.dto.CreateAgentConfigRequest;
import com.luban.entity.AgentConfig;
import com.luban.repository.AgentConfigRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import java.security.MessageDigest;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import com.fasterxml.jackson.databind.ObjectMapper;

@Service
public class AgentConfigService {

    private static final String AES_SECRET = System.getenv().getOrDefault(
            "LUBAN_AGENT_AES_KEY", "Luban@Agent#2026");

    private final AgentConfigRepository agentConfigRepository;

    public AgentConfigService(AgentConfigRepository agentConfigRepository) {
        this.agentConfigRepository = agentConfigRepository;
    }

    public List<AgentConfig> listAll() {
        return agentConfigRepository.findAll();
    }

    public AgentConfig getDefault() {
        return agentConfigRepository.findByIsDefaultTrue()
                .orElseThrow(() -> new RuntimeException("未配置默认 Agent"));
    }

    @Transactional
    public AgentConfig create(CreateAgentConfigRequest request) {
        AgentConfig config = new AgentConfig();
        config.setName(request.getName());
        config.setModelEndpoint(request.getModelEndpoint());
        config.setModelName(request.getModelName());
        config.setSecretKeyEnc(encrypt(request.getSecretKey()));
        config.setIsDefault(request.getIsDefault() != null && request.getIsDefault());

        if (Boolean.TRUE.equals(config.getIsDefault())) {
            agentConfigRepository.findByIsDefaultTrue().ifPresent(existing -> {
                existing.setIsDefault(false);
                agentConfigRepository.save(existing);
            });
        }

        return agentConfigRepository.save(config);
    }

    @Transactional
    public AgentConfig update(Long id, CreateAgentConfigRequest request) {
        AgentConfig config = agentConfigRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Agent 配置不存在: " + id));
        config.setName(request.getName());
        config.setModelEndpoint(request.getModelEndpoint());
        config.setModelName(request.getModelName());
        if (request.getSecretKey() != null && !request.getSecretKey().isEmpty()) {
            config.setSecretKeyEnc(encrypt(request.getSecretKey()));
        }
        if (request.getIsDefault() != null) {
            config.setIsDefault(request.getIsDefault());
            if (Boolean.TRUE.equals(request.getIsDefault())) {
                agentConfigRepository.findByIsDefaultTrue().ifPresent(existing -> {
                    if (!existing.getId().equals(id)) {
                        existing.setIsDefault(false);
                        agentConfigRepository.save(existing);
                    }
                });
            }
        }
        return agentConfigRepository.save(config);
    }

    @Transactional
    public void delete(Long id) {
        AgentConfig config = agentConfigRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Agent 配置不存在: " + id));
        config.setStatus("DISABLED");
        agentConfigRepository.save(config);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> testConnection(String modelEndpoint, String secretKey, String modelName) {
        try {
            String chatUrl = normalizeChatUrl(modelEndpoint);
            Map<String, Object> chatBody = new LinkedHashMap<>();
            chatBody.put("model", modelName);
            chatBody.put("messages", List.of(Map.of("role", "user", "content", "hi")));
            chatBody.put("max_tokens", 5);

            HttpClient client = HttpClient.newHttpClient();
            HttpRequest chatRequest = HttpRequest.newBuilder()
                    .uri(URI.create(chatUrl))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + secretKey)
                    .POST(HttpRequest.BodyPublishers.ofString(new ObjectMapper().writeValueAsString(chatBody)))
                    .build();

            HttpResponse<String> chatResponse = client.send(chatRequest, HttpResponse.BodyHandlers.ofString());
            int code = chatResponse.statusCode();
            if (code == 200) {
                return Map.of("success", true);
            }
            if (code == 401 || code == 403) {
                return Map.of("success", false, "error", "API Key 无效（HTTP " + code + "）");
            }
            return Map.of("success", false, "error", "HTTP " + code + ": " + chatResponse.body());
        } catch (Exception e) {
            return Map.of("success", false, "error", e.getMessage());
        }
    }

    private String encrypt(String plainText) {
        try {
            byte[] key = MessageDigest.getInstance("SHA-256").digest(AES_SECRET.getBytes("UTF-8"));
            SecretKeySpec secretKey = new SecretKeySpec(key, "AES");
            Cipher cipher = Cipher.getInstance("AES/ECB/PKCS5Padding");
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            return Base64.getEncoder().encodeToString(cipher.doFinal(plainText.getBytes("UTF-8")));
        } catch (Exception e) {
            throw new RuntimeException("加密失败", e);
        }
    }

    public String decrypt(String encryptedText) {
        try {
            byte[] key = MessageDigest.getInstance("SHA-256").digest(AES_SECRET.getBytes("UTF-8"));
            SecretKeySpec secretKey = new SecretKeySpec(key, "AES");
            Cipher cipher = Cipher.getInstance("AES/ECB/PKCS5Padding");
            cipher.init(Cipher.DECRYPT_MODE, secretKey);
            return new String(cipher.doFinal(Base64.getDecoder().decode(encryptedText)), "UTF-8");
        } catch (Exception e) {
            throw new RuntimeException("解密失败", e);
        }
    }

    /**
     * 将模型端点 URL 规范化为完整的 chat/completions URL。
     * 规则：
     *   1. 去除尾部斜杠
     *   2. 如果已包含 /chat/completions 则直接返回
     *   3. 如果以 /vN 结尾（如 /v1, /v3, /api/coding/v3），追加 /chat/completions
     *   4. 否则追加 /v1/chat/completions
     */
    public String normalizeChatUrl(String endpoint) {
        String url = endpoint.replaceAll("/+$", "");
        if (url.endsWith("/chat/completions")) {
            return url;
        }
        if (url.matches(".*/v\\d+$")) {
            return url + "/chat/completions";
        }
        return url + "/v1/chat/completions";
    }
}