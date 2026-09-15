package com.luban.invoke.executor;

import com.luban.invoke.ExecutionContext;
import com.luban.invoke.InvocationPrincipal;
import com.luban.invoke.InvocationRequest;
import com.luban.invoke.InvocationResult;
import com.luban.invoke.InvocationOrigin;
import com.luban.invoke.TargetExecutor;
import com.luban.invoke.TargetType;
import com.luban.orchestration.entity.OrchestrationExecution;
import com.luban.orchestration.service.OrchestrationService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * 编排目标执行器：委托 OrchestrationService（版本解析、manifest 授权、执行留痕均在其中）。
 */
@Component
@RequiredArgsConstructor
public class OrchestrationTargetExecutor implements TargetExecutor {

    private final OrchestrationService orchestrationService;

    @Override
    public TargetType support() {
        return TargetType.ORCHESTRATION;
    }

    @Override
    public InvocationResult execute(InvocationRequest request, ExecutionContext ctx) {
        Long userId = ctx.getPrincipal() != null ? ctx.getPrincipal().getUserId() : null;
        Long apiKeyId = ctx.getPrincipal() != null ? ctx.getPrincipal().getApiKeyId() : null;
        String trigger = ctx.getOrigin() == InvocationOrigin.PUBLIC_API
                ? OrchestrationExecution.TRIGGER_API_KEY
                : OrchestrationExecution.TRIGGER_RUNTIME;
        Map<String, Object> result = orchestrationService.execute(request.getTargetId(), userId,
                trigger, apiKeyId, request.getParams(), ctx);
        return InvocationResult.ok(result, 0, ctx.getTraceRowId());
    }
}
