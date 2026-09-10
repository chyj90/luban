package com.luban.orchestration.security;

import com.luban.orchestration.service.OrchestrationService;
import com.luban.security.appaccess.AppResourceResolver;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 编排资源解析器：definitionId → applicationId。
 * 编排均为应用内资源（无平台级共享态），不存在 → null → 拦截器 404。
 */
@Component
@RequiredArgsConstructor
public class OrchestrationResolver implements AppResourceResolver {

    private final OrchestrationService orchestrationService;

    @Override
    public String resourceType() {
        return "orchestration";
    }

    @Override
    public Long applicationIdOf(Long definitionId) {
        if (!orchestrationService.exists(definitionId)) return null;
        return orchestrationService.applicationIdOf(definitionId);
    }

    @Override
    public boolean resourceExists(Long definitionId) {
        return orchestrationService.exists(definitionId);
    }
}
