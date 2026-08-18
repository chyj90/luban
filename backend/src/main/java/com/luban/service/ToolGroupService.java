package com.luban.service;

import com.luban.dto.CreateToolGroupRequest;
import com.luban.entity.ToolGroup;
import com.luban.repository.ToolGroupRepository;
import com.luban.util.AesEncryptUtil;
import com.luban.util.Ed25519Util;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.KeyPair;
import java.time.LocalDateTime;
import java.util.List;

@Service
public class ToolGroupService {

    private final ToolGroupRepository toolGroupRepository;

    public ToolGroupService(ToolGroupRepository toolGroupRepository) {
        this.toolGroupRepository = toolGroupRepository;
    }

    public List<ToolGroup> listAll() {
        return toolGroupRepository.findByStatusOrderBySortOrderAsc("ENABLED");
    }

    public ToolGroup getById(Long id) {
        return toolGroupRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("系统不存在: " + id));
    }

    public ToolGroup getByCode(String code) {
        return toolGroupRepository.findByCode(code)
                .orElseThrow(() -> new RuntimeException("系统不存在: " + code));
    }

    @Transactional
    public ToolGroup create(CreateToolGroupRequest request) {
        if (toolGroupRepository.findByCode(request.getCode()).isPresent()) {
            throw new RuntimeException("系统编码已存在: " + request.getCode());
        }

        ToolGroup group = new ToolGroup();
        group.setName(request.getName());
        group.setCode(request.getCode());
        group.setDescription(request.getDescription());
        group.setSystemPromptHint(request.getSystemPromptHint());
        group.setIcon(request.getIcon());
        group.setDefaultConfig(request.getDefaultConfig());
        group.setSortOrder(request.getSortOrder() != null ? request.getSortOrder() : 0);
        group.setStatus("ENABLED");

        generateKeyPair(group);

        return toolGroupRepository.save(group);
    }

    @Transactional
    public ToolGroup update(Long id, CreateToolGroupRequest request) {
        ToolGroup group = getById(id);
        group.setName(request.getName());
        group.setDescription(request.getDescription());
        group.setSystemPromptHint(request.getSystemPromptHint());
        group.setIcon(request.getIcon());
        group.setDefaultConfig(request.getDefaultConfig());
        if (request.getSortOrder() != null) {
            group.setSortOrder(request.getSortOrder());
        }
        return toolGroupRepository.save(group);
    }

    @Transactional
    public void delete(Long id) {
        ToolGroup group = getById(id);
        group.setStatus("DISABLED");
        toolGroupRepository.save(group);
    }

    private void generateKeyPair(ToolGroup group) {
        try {
            KeyPair keyPair = Ed25519Util.generateKeyPair();
            group.setPublicKey(Ed25519Util.encodePublicKey(keyPair.getPublic()));
            String privateKeyStr = Ed25519Util.encodePrivateKey(keyPair.getPrivate());
            group.setPrivateKeyEnc(AesEncryptUtil.encrypt(privateKeyStr));
            group.setKeyPairCreatedAt(LocalDateTime.now());
        } catch (Exception e) {
            throw new RuntimeException("密钥对生成失败", e);
        }
    }
}