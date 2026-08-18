package com.luban.service;

import com.luban.dto.CreateAgentConfigRequest;
import com.luban.entity.AgentConfig;
import com.luban.repository.AgentConfigRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Base64;
import java.util.List;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import java.security.MessageDigest;

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
}