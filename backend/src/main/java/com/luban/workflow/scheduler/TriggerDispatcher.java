package com.luban.workflow.scheduler;

import com.luban.invoke.ExecutionContext;
import com.luban.invoke.InvocationOrigin;
import com.luban.invoke.InvocationPrincipal;
import com.luban.invoke.InvocationRequest;
import com.luban.invoke.InvocationResult;
import com.luban.invoke.InvocationService;
import com.luban.invoke.TargetType;
import com.luban.workflow.entity.WorkflowTriggerOutbox;
import com.luban.workflow.repository.WorkflowTriggerOutboxRepository;
import com.luban.workflow.service.WorkflowTriggerService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 触发器派发器：轮询 outbox → 经统一漏斗调用目标（编排/Query/工具）。
 * at-least-once：失败按退避序列重试，超过 maxAttempts 置 DEAD（死信）并告警日志；
 * 幂等键 = "otb-"+outbox.id，目标侧重复派发由漏斗/调用方按幂等键去重。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TriggerDispatcher {

    private static final List<Long> DEFAULT_BACKOFF = List.of(30L, 120L, 600L);

    private final WorkflowTriggerOutboxRepository outboxRepository;
    private final WorkflowTriggerService triggerService;
    private final ObjectProvider<InvocationService> invocationServiceProvider;

    @Scheduled(fixedDelay = 5_000)
    public void dispatchPending() {
        List<WorkflowTriggerOutbox> batch = outboxRepository
                .findTop20ByStatusAndNextRetryAtBeforeOrderByIdAsc("PENDING", LocalDateTime.now());
        for (WorkflowTriggerOutbox row : batch) {
            dispatch(row);
        }
    }

    void dispatch(WorkflowTriggerOutbox row) {
        long start = System.currentTimeMillis();
        try {
            Map<String, Object> payload = parsePayload(row.getPayload());
            Long initiatorId = payload.get("initiatorId") instanceof Number n && n.longValue() > 0
                    ? n.longValue() : null;
            Long appId = payload.get("applicationId") instanceof Number n && n.longValue() > 0
                    ? n.longValue() : null;
            Long definitionId = payload.get("workflowDefinitionId") instanceof Number n
                    ? n.longValue() : null;
            @SuppressWarnings("unchecked")
            Map<String, Object> params = payload.get("params") instanceof Map<?, ?> m
                    ? (Map<String, Object>) m : Map.of();

            ExecutionContext ctx = ExecutionContext.root(InvocationOrigin.FLOW_TRIGGER,
                            InvocationPrincipal.onBehalfOf(initiatorId), appId, "otb-" + row.getId());
            if (definitionId != null) {
                // 发布固化清单：只允许调用该流程定义触发器声明的目标
                ctx = ctx.withAllowedTargets(triggerService.targetsOfDefinition(definitionId));
            }

            InvocationResult result = invocationServiceProvider.getObject().invoke(
                    InvocationRequest.of(TargetType.valueOf(row.getTargetType()),
                            row.getTargetRef(), params, ctx));
            if (!result.isSuccess()) {
                throw new IllegalStateException("目标执行失败: "
                        + (result.getErrorCode() != null ? result.getErrorCode() + " " : "")
                        + result.getErrorMessage());
            }
            markDispatched(row);
            log.info("触发器派发成功: row={} target={}:{} ({}ms)", row.getId(),
                    row.getTargetType(), row.getTargetRef(), System.currentTimeMillis() - start);
        } catch (Exception e) {
            scheduleRetry(row, e);
        }
    }

    private void markDispatched(WorkflowTriggerOutbox row) {
        row.setStatus("DISPATCHED");
        row.setDispatchedAt(LocalDateTime.now());
        outboxRepository.save(row);
    }

    private void scheduleRetry(WorkflowTriggerOutbox row, Exception e) {
        String message = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        int attempts = row.getAttempts() == null ? 0 : row.getAttempts() + 1;
        row.setAttempts(attempts);
        row.setLastError(message.length() > 512 ? message.substring(0, 512) : message);
        if (attempts >= (row.getMaxAttempts() == null ? 3 : row.getMaxAttempts())) {
            row.setStatus("DEAD");
            log.error("触发器派发失败进入死信: row={} target={}:{} err={}",
                    row.getId(), row.getTargetType(), row.getTargetRef(), message, e);
        } else {
            long backoff = backoffSeconds(row).stream()
                    .skip(Math.max(0, attempts - 1)).findFirst().orElse(600L);
            row.setNextRetryAt(LocalDateTime.now().plusSeconds(backoff));
            log.warn("触发器派发失败，{}s 后重试（{}/{}）: row={} err={}",
                    backoff, attempts, row.getMaxAttempts(), row.getId(), message);
        }
        outboxRepository.save(row);
    }

    private List<Long> backoffSeconds(WorkflowTriggerOutbox row) {
        try {
            if (row.getBackoffSeconds() != null && !row.getBackoffSeconds().isBlank()) {
                return com.fasterxml.jackson.databind.json.JsonMapper.builder().build()
                        .readValue(row.getBackoffSeconds(),
                                new com.fasterxml.jackson.core.type.TypeReference<List<Long>>() {});
            }
        } catch (Exception ignored) { }
        return DEFAULT_BACKOFF;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parsePayload(String payload) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper()
                    .readValue(payload == null ? "{}" : payload,
                            new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }
}
