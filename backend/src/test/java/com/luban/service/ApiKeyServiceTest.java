package com.luban.service;

import com.luban.entity.ApiKey;
import com.luban.entity.ApiKeyDatasource;
import com.luban.entity.ApplicationApiKey;
import com.luban.repository.ApiKeyDatasourceRepository;
import com.luban.repository.ApiKeyRepository;
import com.luban.repository.ApiKeyToolRepository;
import com.luban.repository.ApplicationApiKeyRepository;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.DatasourceRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.workflow.repository.WorkflowDefinitionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * API Key 生命周期与运行态门禁测试（安全架构 v1.1）。
 * 覆盖：rotate 轮换、revoke/restore 级联、owner 校验、应用数据源审批门禁。
 */
@ExtendWith(MockitoExtension.class)
class ApiKeyServiceTest {

    private static final Long KEY_ID = 5L;
    private static final Long OWNER_ID = 1L;
    private static final Long APP_ID = 10L;
    private static final Long DS_ID = 20L;

    @Mock private ApiKeyRepository apiKeyRepository;
    @Mock private ApiKeyToolRepository apiKeyToolRepository;
    @Mock private ApiKeyDatasourceRepository apiKeyDatasourceRepository;
    @Mock private ApplicationApiKeyRepository applicationApiKeyRepository;
    @Mock private ToolDefinitionRepository toolDefinitionRepository;
    @Mock private DatasourceRepository datasourceRepository;
    @Mock private ApplicationRepository applicationRepository;
    @Mock private WorkflowDefinitionRepository workflowDefinitionRepository;

    private ApiKeyService service;
    private ApiKey key;

    @BeforeEach
    void setUp() {
        // ProcessService 在 Java 25 下 Mockito 无法代理，且被测方法不触达——以 null 注入
        service = new ApiKeyService(apiKeyRepository, apiKeyToolRepository, apiKeyDatasourceRepository,
                applicationApiKeyRepository, toolDefinitionRepository, datasourceRepository,
                applicationRepository, workflowDefinitionRepository, null);

        key = new ApiKey();
        key.setId(KEY_ID);
        key.setOwnerId(OWNER_ID);
        key.setStatus("ACTIVE");
        key.setKeyHash("old-hash");
        key.setKeyPrefix("oldprefix12");
        lenient().when(apiKeyRepository.findById(KEY_ID)).thenReturn(Optional.of(key));
        lenient().when(apiKeyRepository.save(any(ApiKey.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    private ApplicationApiKey binding(String status) {
        ApplicationApiKey b = new ApplicationApiKey();
        b.setApiKeyId(KEY_ID);
        b.setApplicationId(APP_ID);
        b.setStatus(status);
        return b;
    }

    @Test
    void rotateKeyProducesNewHashAndPrefix() {
        var result = service.rotateKey(KEY_ID, OWNER_ID);

        assertThat(result).containsKeys("apiKeyId", "keyPreview");
        assertThat(result.get("apiKeyId")).startsWith("lb_");
        ArgumentCaptor<ApiKey> captor = ArgumentCaptor.forClass(ApiKey.class);
        verify(apiKeyRepository).save(captor.capture());
        ApiKey saved = captor.getValue();
        assertThat(saved.getKeyHash()).isNotEqualTo("old-hash");
        assertThat(saved.getKeyPrefix()).hasSize(12).isNotEqualTo("oldprefix12");
        // rotate 只换密钥值：状态与绑定/审批关系保持不变
        assertThat(saved.getStatus()).isEqualTo("ACTIVE");
    }

    @Test
    void rotateKeyRejectedForNonOwner() {
        assertThatThrownBy(() -> service.rotateKey(KEY_ID, 999L))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("无权");
    }

    @Test
    void revokeKeyCascadesBindingsToInactive() {
        ApplicationApiKey b = binding("ACTIVE");
        when(applicationApiKeyRepository.findByApiKeyId(KEY_ID)).thenReturn(List.of(b));

        service.revokeKey(KEY_ID, OWNER_ID);

        assertThat(b.getStatus()).isEqualTo("INACTIVE");
        assertThat(key.getStatus()).isEqualTo("REVOKED");
    }

    @Test
    void revokeKeyRejectedForNonOwner() {
        assertThatThrownBy(() -> service.revokeKey(KEY_ID, 999L))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("无权");
    }

    @Test
    void restoreKeyReactivatesBindings() {
        key.setStatus("REVOKED");
        ApplicationApiKey b = binding("INACTIVE");
        when(applicationApiKeyRepository.findByApiKeyId(KEY_ID)).thenReturn(List.of(b));

        service.restoreKey(KEY_ID, OWNER_ID);

        assertThat(b.getStatus()).isEqualTo("ACTIVE");
        assertThat(key.getStatus()).isEqualTo("ACTIVE");
    }

    @Test
    void applicationDatasourcePermissionRequiresApprovedBinding() {
        ApplicationApiKey activeBinding = binding("ACTIVE");
        when(applicationApiKeyRepository.findByApplicationIdAndStatus(APP_ID, "ACTIVE"))
                .thenReturn(List.of(activeBinding));

        // APPROVED → 通过
        ApiKeyDatasource approved = new ApiKeyDatasource();
        approved.setApiKeyId(KEY_ID);
        approved.setDatasourceId(DS_ID);
        approved.setStatus("APPROVED");
        when(apiKeyDatasourceRepository.findByApiKeyIdAndDatasourceId(KEY_ID, DS_ID))
                .thenReturn(Optional.of(approved));
        assertThat(service.hasApplicationDatasourcePermission(APP_ID, DS_ID)).isTrue();

        // PENDING → 拒绝；无记录 → 拒绝
        approved.setStatus("PENDING");
        assertThat(service.hasApplicationDatasourcePermission(APP_ID, DS_ID)).isFalse();
        when(apiKeyDatasourceRepository.findByApiKeyIdAndDatasourceId(KEY_ID, DS_ID))
                .thenReturn(Optional.empty());
        assertThat(service.hasApplicationDatasourcePermission(APP_ID, DS_ID)).isFalse();

        // 绑定全部 INACTIVE（Key 已吊销）→ 拒绝
        when(applicationApiKeyRepository.findByApplicationIdAndStatus(APP_ID, "ACTIVE"))
                .thenReturn(List.of());
        assertThat(service.hasApplicationDatasourcePermission(APP_ID, DS_ID)).isFalse();
    }
}
