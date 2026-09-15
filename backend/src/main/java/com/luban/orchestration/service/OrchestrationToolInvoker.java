package com.luban.orchestration.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.ToolDefinition;
import com.luban.orchestration.entity.OrchestrationExecution;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * 编排作为工具被调用（ToolDefinition type=ORCHESTRATION）的统一分发点。
 * 页面运行时、应用内调试、Agent 三处共用；应用归属校验由调用方按各自上下文完成。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class OrchestrationToolInvoker {

    private final OrchestrationService orchestrationService;
    private final ObjectMapper objectMapper;

    /** 从工具 config 解析 orchestrationId，缺失抛 IllegalArgumentException。 */
    public Long requireOrchestrationId(ToolDefinition tool) {
        Map<String, Object> config;
        try {
            config = objectMapper.readValue(
                    tool.getConfig() == null ? "{}" : tool.getConfig(),
                    new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            throw new IllegalArgumentException("编排工具配置解析失败", e);
        }
        Long orchDefId = config.get("orchestrationId") instanceof Number n ? n.longValue() : null;
        if (orchDefId == null) {
            throw new IllegalArgumentException("编排工具配置缺少 orchestrationId");
        }
        return orchDefId;
    }

    /** 以运行时触发口径执行编排（userId 可为 null，表示系统调用，如 Agent）。 */
    public Map<String, Object> invoke(Long orchestrationId, Long userId, Map<String, Object> params) {
        return orchestrationService.execute(orchestrationId, userId,
                OrchestrationExecution.TRIGGER_RUNTIME, null, params);
    }

    /** 编排归属应用 id（供跨应用校验） */
    public Long applicationIdOf(Long orchestrationId) {
        return orchestrationService.applicationIdOf(orchestrationId);
    }
}
