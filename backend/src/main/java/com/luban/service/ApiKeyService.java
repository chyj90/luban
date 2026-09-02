package com.luban.service;

import com.luban.constant.WorkflowScope;
import com.luban.entity.ApiKey;
import com.luban.entity.ApiKeyDatasource;
import com.luban.entity.ApiKeyTool;
import com.luban.entity.Application;
import com.luban.entity.ApplicationApiKey;
import com.luban.entity.Datasource;
import com.luban.entity.ToolDefinition;
import com.luban.repository.ApiKeyDatasourceRepository;
import com.luban.repository.ApiKeyRepository;
import com.luban.repository.ApiKeyToolRepository;
import com.luban.repository.ApplicationApiKeyRepository;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.DatasourceRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.workflow.entity.WorkflowDefinition;
import com.luban.workflow.entity.WorkflowInstance;
import com.luban.workflow.repository.WorkflowDefinitionRepository;
import com.luban.workflow.service.ProcessService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.MessageDigest;
import java.util.Collections;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class ApiKeyService {

    private static final String KEY_PREFIX = "lb_";
    private static final int KEY_LENGTH = 48;

    private final ApiKeyRepository apiKeyRepository;
    private final ApiKeyToolRepository apiKeyToolRepository;
    private final ApiKeyDatasourceRepository apiKeyDatasourceRepository;
    private final ApplicationApiKeyRepository applicationApiKeyRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final DatasourceRepository datasourceRepository;
    private final ApplicationRepository applicationRepository;
    private final WorkflowDefinitionRepository workflowDefinitionRepository;
    private final ProcessService processService;

    public ApiKeyService(ApiKeyRepository apiKeyRepository,
                         ApiKeyToolRepository apiKeyToolRepository,
                         ApiKeyDatasourceRepository apiKeyDatasourceRepository,
                         ApplicationApiKeyRepository applicationApiKeyRepository,
                         ToolDefinitionRepository toolDefinitionRepository,
                         DatasourceRepository datasourceRepository,
                         ApplicationRepository applicationRepository,
                         WorkflowDefinitionRepository workflowDefinitionRepository,
                         ProcessService processService) {
        this.apiKeyRepository = apiKeyRepository;
        this.apiKeyToolRepository = apiKeyToolRepository;
        this.apiKeyDatasourceRepository = apiKeyDatasourceRepository;
        this.applicationApiKeyRepository = applicationApiKeyRepository;
        this.toolDefinitionRepository = toolDefinitionRepository;
        this.datasourceRepository = datasourceRepository;
        this.applicationRepository = applicationRepository;
        this.workflowDefinitionRepository = workflowDefinitionRepository;
        this.processService = processService;
    }

    public List<ApiKey> listByOwner(Long ownerId) {
        return apiKeyRepository.findByOwnerId(ownerId);
    }

    public List<ApiKeyTool> listKeyTools(Long apiKeyId) {
        return apiKeyToolRepository.findByApiKeyId(apiKeyId);
    }

    public List<ToolDefinition> listAvailableTools() {
        return toolDefinitionRepository.findByScope("PLATFORM");
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
        result.put("apiKeyId", rawKey);
        result.put("keyPreview", keyPreview);
        result.put("name", name);
        return result;
    }

    @Transactional
    public ApiKey renameKey(Long apiKeyId, Long ownerId, String name) {
        ApiKey apiKey = apiKeyRepository.findById(apiKeyId)
                .orElseThrow(() -> new RuntimeException("API Key 不存在"));
        if (!apiKey.getOwnerId().equals(ownerId)) {
            throw new RuntimeException("无权操作该 Key");
        }
        apiKey.setName(name);
        return apiKeyRepository.save(apiKey);
    }

    @Transactional
    public ApiKeyTool requestToolPermission(Long apiKeyId, Long toolId, Long userId, String userName) {
        ApiKey apiKey = apiKeyRepository.findById(apiKeyId)
                .orElseThrow(() -> new RuntimeException("API Key 不存在"));

        if (apiKeyToolRepository.findByApiKeyIdAndToolId(apiKeyId, toolId).isPresent()) {
            throw new RuntimeException("该工具权限已申请或已获批");
        }

        ApiKeyTool keyTool = new ApiKeyTool();
        keyTool.setApiKeyId(apiKeyId);
        keyTool.setToolId(toolId);
        keyTool.setStatus("PENDING");

        ToolDefinition tool = toolDefinitionRepository.findById(toolId).orElse(null);
        String toolName = tool != null ? (tool.getDisplayName() != null ? tool.getDisplayName() : tool.getName()) : "未知工具";

        List<WorkflowDefinition> platformDefs = workflowDefinitionRepository.findByScope(WorkflowScope.PLATFORM);
        WorkflowDefinition toolPermWf = platformDefs.stream()
                .filter(d -> "工具权限审批".equals(d.getName()) && "PUBLISHED".equals(d.getStatus()))
                .findFirst()
                .orElseThrow(() -> new RuntimeException("工具权限审批流程未配置"));

        String formData = "{"
                + "\"keyName\":\"" + apiKey.getName() + "\","
                + "\"toolName\":\"" + toolName + "\","
                + "\"toolId\":" + toolId + ","
                + "\"apiKeyId\":" + apiKeyId + ","
                + "\"applicant\":\"" + userName + "\""
                + "}";

        WorkflowInstance wfInstance = processService.startProcess(
                toolPermWf.getId(), formData, userId, userName);
        keyTool.setWorkflowInstanceId(wfInstance.getId());

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

    @Transactional
    public void restoreKey(Long apiKeyId, Long ownerId) {
        ApiKey apiKey = apiKeyRepository.findById(apiKeyId)
                .orElseThrow(() -> new RuntimeException("API Key 不存在"));
        if (!apiKey.getOwnerId().equals(ownerId)) {
            throw new RuntimeException("无权操作该 Key");
        }
        if (!"REVOKED".equals(apiKey.getStatus())) {
            throw new RuntimeException("只能恢复已吊销的 Key");
        }
        apiKey.setStatus("ACTIVE");
        apiKeyRepository.save(apiKey);
    }

    @Transactional
    public void deleteKey(Long apiKeyId, Long ownerId) {
        ApiKey apiKey = apiKeyRepository.findById(apiKeyId)
                .orElseThrow(() -> new RuntimeException("API Key 不存在"));
        if (!apiKey.getOwnerId().equals(ownerId)) {
            throw new RuntimeException("无权操作该 Key");
        }
        if (!"REVOKED".equals(apiKey.getStatus())) {
            throw new RuntimeException("只能删除已吊销的 Key");
        }
        apiKeyToolRepository.deleteByApiKeyId(apiKeyId);
        apiKeyRepository.delete(apiKey);
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

    // ==================== Datasource Permission ====================

    public List<Datasource> listAvailableDatasources(Long groupId) {
        return datasourceRepository.findBySlugAndOwnerId("PLATFORM", groupId);
    }

    public List<ApiKeyDatasource> listKeyDatasources(Long apiKeyId) {
        return apiKeyDatasourceRepository.findByApiKeyId(apiKeyId);
    }

    @Transactional
    public ApiKeyDatasource requestDatasourcePermission(Long apiKeyId, Long datasourceId, Long userId, String userName) {
        ApiKey apiKey = apiKeyRepository.findById(apiKeyId)
                .orElseThrow(() -> new RuntimeException("API Key 不存在"));

        if (apiKeyDatasourceRepository.findByApiKeyIdAndDatasourceId(apiKeyId, datasourceId).isPresent()) {
            throw new RuntimeException("该数据源权限已申请或已获批");
        }

        ApiKeyDatasource keyDs = new ApiKeyDatasource();
        keyDs.setApiKeyId(apiKeyId);
        keyDs.setDatasourceId(datasourceId);
        keyDs.setStatus("PENDING");

        Datasource ds = datasourceRepository.findById(datasourceId).orElse(null);
        String dsName = ds != null ? ds.getName() : "未知数据源";

        List<WorkflowDefinition> platformDefs = workflowDefinitionRepository.findByScope(WorkflowScope.PLATFORM);
        WorkflowDefinition dsPermWf = platformDefs.stream()
                .filter(d -> "数据源权限审批".equals(d.getName()) && "PUBLISHED".equals(d.getStatus()))
                .findFirst()
                .orElseThrow(() -> new RuntimeException("数据源权限审批流程未配置"));

        String formData = "{"
                + "\"keyName\":\"" + apiKey.getName() + "\","
                + "\"datasourceName\":\"" + dsName + "\","
                + "\"datasourceId\":" + datasourceId + ","
                + "\"apiKeyId\":" + apiKeyId + ","
                + "\"applicant\":\"" + userName + "\""
                + "}";

        WorkflowInstance wfInstance = processService.startProcess(
                dsPermWf.getId(), formData, userId, userName);
        keyDs.setWorkflowInstanceId(wfInstance.getId());

        return apiKeyDatasourceRepository.save(keyDs);
    }

    @Transactional
    public ApiKeyDatasource approveDatasourcePermission(Long apiKeyDatasourceId) {
        ApiKeyDatasource keyDs = apiKeyDatasourceRepository.findById(apiKeyDatasourceId)
                .orElseThrow(() -> new RuntimeException("权限申请不存在"));
        if (!"PENDING".equals(keyDs.getStatus())) {
            throw new RuntimeException("该申请状态不是待审批");
        }
        keyDs.setStatus("APPROVED");
        return apiKeyDatasourceRepository.save(keyDs);
    }

    @Transactional
    public ApiKeyDatasource rejectDatasourcePermission(Long apiKeyDatasourceId) {
        ApiKeyDatasource keyDs = apiKeyDatasourceRepository.findById(apiKeyDatasourceId)
                .orElseThrow(() -> new RuntimeException("权限申请不存在"));
        keyDs.setStatus("REJECTED");
        return apiKeyDatasourceRepository.save(keyDs);
    }

    public boolean hasDatasourcePermission(Long apiKeyId, Long datasourceId) {
        return apiKeyDatasourceRepository.findByApiKeyIdAndDatasourceId(apiKeyId, datasourceId)
                .map(kd -> "APPROVED".equals(kd.getStatus()))
                .orElse(false);
    }

    // ==================== Application Binding ====================

    public List<ApiKey> listKeysByApplication(Long applicationId) {
        List<ApplicationApiKey> bindings = applicationApiKeyRepository.findByApplicationIdAndStatus(applicationId, "ACTIVE");
        return bindings.stream()
                .map(b -> apiKeyRepository.findById(b.getApiKeyId()).orElse(null))
                .filter(k -> k != null)
                .collect(Collectors.toList());
    }

    public List<Application> listApplicationsByKey(Long apiKeyId) {
        List<ApplicationApiKey> bindings = applicationApiKeyRepository.findByApiKeyId(apiKeyId);
        return bindings.stream()
                .filter(b -> "ACTIVE".equals(b.getStatus()))
                .map(b -> applicationRepository.findById(b.getApplicationId()).orElse(null))
                .filter(a -> a != null)
                .collect(Collectors.toList());
    }

    @Transactional
    public ApplicationApiKey bindApplication(Long apiKeyId, Long applicationId, Long userId) {
        ApiKey apiKey = apiKeyRepository.findById(apiKeyId)
                .orElseThrow(() -> new RuntimeException("API Key 不存在"));
        if (!apiKey.getOwnerId().equals(userId)) {
            throw new RuntimeException("无权操作该 Key");
        }

        Application app = applicationRepository.findById(applicationId)
                .orElseThrow(() -> new RuntimeException("应用不存在"));
        if (!app.getCreatedBy().equals(userId)) {
            throw new RuntimeException("无权操作该应用");
        }

        if (applicationApiKeyRepository.findByApplicationIdAndApiKeyId(applicationId, apiKeyId).isPresent()) {
            throw new RuntimeException("该 Key 已绑定到此应用");
        }

        ApplicationApiKey binding = new ApplicationApiKey();
        binding.setApplicationId(applicationId);
        binding.setApiKeyId(apiKeyId);
        binding.setStatus("ACTIVE");
        return applicationApiKeyRepository.save(binding);
    }

    @Transactional
    public void unbindApplication(Long apiKeyId, Long applicationId, Long userId) {
        ApiKey apiKey = apiKeyRepository.findById(apiKeyId)
                .orElseThrow(() -> new RuntimeException("API Key 不存在"));
        if (!apiKey.getOwnerId().equals(userId)) {
            throw new RuntimeException("无权操作该 Key");
        }

        ApplicationApiKey binding = applicationApiKeyRepository
                .findByApplicationIdAndApiKeyId(applicationId, apiKeyId)
                .orElseThrow(() -> new RuntimeException("绑定关系不存在"));

        binding.setStatus("INACTIVE");
        applicationApiKeyRepository.save(binding);
    }

    public List<ApiKeyTool> listApprovedToolsForApplication(Long applicationId) {
        List<ApplicationApiKey> bindings = applicationApiKeyRepository
                .findByApplicationIdAndStatus(applicationId, "ACTIVE");
        if (bindings.isEmpty()) return Collections.emptyList();

        List<Long> keyIds = bindings.stream().map(ApplicationApiKey::getApiKeyId).collect(Collectors.toList());
        return keyIds.stream()
                .flatMap(keyId -> apiKeyToolRepository.findByApiKeyIdAndStatus(keyId, "APPROVED").stream())
                .collect(Collectors.toList());
    }

    public List<ApiKeyDatasource> listApprovedDatasourcesForApplication(Long applicationId) {
        List<ApplicationApiKey> bindings = applicationApiKeyRepository
                .findByApplicationIdAndStatus(applicationId, "ACTIVE");
        if (bindings.isEmpty()) return Collections.emptyList();

        List<Long> keyIds = bindings.stream().map(ApplicationApiKey::getApiKeyId).collect(Collectors.toList());
        return keyIds.stream()
                .flatMap(keyId -> apiKeyDatasourceRepository.findByApiKeyIdAndStatus(keyId, "APPROVED").stream())
                .collect(Collectors.toList());
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