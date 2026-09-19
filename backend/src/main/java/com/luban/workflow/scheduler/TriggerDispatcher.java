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
 * 幂等键 = "otb-"+outbox.id（确定性），漏斗按该键对已成功的调用去重，
 * "目标已成功但响应丢失"的重发不会重复执行。
 * 多副本认领：扫描行后先以条件 UPDATE 抢占（PENDING→DISPATCHING），赢者派发、输者跳过；
 * 认领超时（实例崩溃残留）可被重认领。组门槛：同组（同一来源节点同一事件的多个触发器）
 * 按 group_order 顺序派发，前序成员未成功时后续成员不派发——配置声明的执行顺序在
 * 重试场景下依然成立。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TriggerDispatcher {

    private static final List<Long> DEFAULT_BACKOFF = List.of(30L, 120L, 600L);

    /** 认领超时：DISPATCHING 超过该时长视为实例崩溃，可被重认领（须大于最慢一次派发耗时） */
    private static final java.time.Duration STALE_CLAIM = java.time.Duration.ofMinutes(5);

    private final WorkflowTriggerOutboxRepository outboxRepository;
    private final WorkflowTriggerService triggerService;
    private final ObjectProvider<InvocationService> invocationServiceProvider;
    private final org.springframework.transaction.support.TransactionTemplate transactionTemplate;

    @Scheduled(fixedDelay = 5_000)
    public void dispatchPending() {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime staleBefore = now.minus(STALE_CLAIM);
        List<WorkflowTriggerOutbox> batch = outboxRepository.findDispatchable(
                now, staleBefore, org.springframework.data.domain.PageRequest.of(0, 20));
        for (WorkflowTriggerOutbox row : batch) {
            if (!claimRow(row, now, staleBefore)) continue;
            if (!groupReady(row)) {
                releaseClaim(row);
                continue;
            }
            dispatch(row);
        }
    }

    /**
     * 多副本认领：条件 UPDATE 抢占，赢者派发、输者跳过（另一实例已抢到）。
     * 赢者同步内存实体状态，保证后续 markDispatched/scheduleRetry 落库正确。
     */
    private boolean claimRow(WorkflowTriggerOutbox row, LocalDateTime now, LocalDateTime staleBefore) {
        boolean staleResidual = "DISPATCHING".equals(row.getStatus());
        Integer updated = transactionTemplate.execute(tx -> staleResidual
                ? outboxRepository.reclaimStaleRow(row.getId(), now, staleBefore)
                : outboxRepository.claimPendingRow(row.getId(), now));
        if (updated == null || updated != 1) return false;
        row.setStatus("DISPATCHING");
        row.setClaimedAt(now);
        return true;
    }

    private void releaseClaim(WorkflowTriggerOutbox row) {
        transactionTemplate.executeWithoutResult(tx -> outboxRepository.releaseClaim(row.getId()));
        row.setStatus("PENDING");
        row.setClaimedAt(null);
    }

    /**
     * 组门槛：组内更早的成员尚未 DISPATCHED（含退避重试中/已 DEAD）时，本行不得执行。
     * 历史数据（groupId 为 null）与单触发器组直接放行。
     */
    private boolean groupReady(WorkflowTriggerOutbox row) {
        if (row.getGroupId() == null || row.getGroupOrder() == null) return true;
        List<WorkflowTriggerOutbox> group = outboxRepository
                .findByGroupIdOrderByGroupOrderAsc(row.getGroupId());
        for (WorkflowTriggerOutbox member : group) {
            if (member.getGroupOrder() == null) continue;
            if (member.getGroupOrder() >= row.getGroupOrder()) break;
            if (!"DISPATCHED".equals(member.getStatus())) {
                log.info("触发器组门槛拦截: row={} group={} order={} 前序成员 row={} 状态={}",
                        row.getId(), row.getGroupId(), row.getGroupOrder(),
                        member.getId(), member.getStatus());
                return false;
            }
        }
        return true;
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
            // minAffectedRows（仅 QUERY）：实际影响行数低于声明值视为失败——
            // "必命中"回写命中 0 行（守卫未命中/记录不存在）不再被当成派发成功
            if ("QUERY".equals(row.getTargetType()) && row.getMinAffectedRows() != null) {
                long affected = affectedRows(result);
                if (affected < row.getMinAffectedRows()) {
                    throw new IllegalStateException("QUERY 影响行数 " + affected
                            + " 低于声明的 minAffectedRows=" + row.getMinAffectedRows()
                            + "（守卫未命中或记录不存在），按失败重试/死信处理");
                }
            }
            markDispatched(row);
            log.info("触发器派发成功: row={} target={}:{} ({}ms)", row.getId(),
                    row.getTargetType(), row.getTargetRef(), System.currentTimeMillis() - start);
        } catch (Exception e) {
            scheduleRetry(row, e);
        }
    }

    /** QUERY 目标的实际影响行数：执行器把 UPDATE/DELETE 的 affectedRows 放在 totalCount */
    private long affectedRows(InvocationResult result) {
        Object data = result.getData();
        if (data instanceof Map<?, ?> m && m.get("totalCount") instanceof Number n) {
            return n.longValue();
        }
        return 0;
    }

    private void markDispatched(WorkflowTriggerOutbox row) {
        row.setStatus("DISPATCHED");
        row.setClaimedAt(null);
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
            row.setClaimedAt(null);
            log.error("触发器派发失败进入死信: row={} target={}:{} err={}",
                    row.getId(), row.getTargetType(), row.getTargetRef(), message, e);
        } else {
            // 归还队列：认领失败路径（DISPATCHING）必须回到 PENDING 才会被下一轮扫描
            row.setStatus("PENDING");
            row.setClaimedAt(null);
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
