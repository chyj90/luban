package com.luban.invoke;

import lombok.Value;

import java.util.LinkedHashSet;
import java.util.Set;

/**
 * 执行上下文：随跨对象调用强制透传，是漏斗护栏（深度/环/超时预算）与链路追踪的载体。
 *
 * - depth：本次被调目标的跨对象嵌套深度，根调用为 0；
 * - deadlineEpochMs：超时预算的绝对截止时间，子调用继承父的剩余预算（不重置）；
 * - ancestors：祖先目标键集（含本次目标自身），用于环检测；
 * - allowedTargets：内部触发的授权清单（发布时固化的 manifest）；null = 不限制（页面/Agent/外部等入口自身已鉴权）。
 */
@Value
public class ExecutionContext {

    InvocationOrigin origin;
    InvocationPrincipal principal;
    Long appId;
    /** 调用链根 id：一次页面操作/一次触发器派发的所有嵌套调用共享 */
    String chainId;
    /** 本次调用在 invocation_trace 表中的记录 id（漏斗落 RUNNING 记录后回填） */
    Long traceRowId;
    /** 父调用的 trace 记录 id */
    Long callerTraceId;
    int depth;
    long deadlineEpochMs;
    Set<String> ancestors;
    /** 本次目标键，如 "ORCHESTRATION:12" */
    String selfKey;
    /** 内部触发授权清单；null 表示不限制 */
    Set<String> allowedTargets;
    /** 幂等键（异步触发场景：outbox id） */
    String idempotencyKey;

    private static final long DEFAULT_BUDGET_MS = 120_000;
    private static final long MAX_BUDGET_MS = 300_000;

    /** 根调用上下文（Controller / Agent / 触发器派发器使用） */
    public static ExecutionContext root(InvocationOrigin origin, InvocationPrincipal principal,
                                        Long appId, String idempotencyKey) {
        long deadline = System.currentTimeMillis()
                + Math.min(DEFAULT_BUDGET_MS, MAX_BUDGET_MS);
        return new ExecutionContext(origin, principal, appId,
                java.util.UUID.randomUUID().toString(), null, null,
                0, deadline, new LinkedHashSet<>(), null, null, idempotencyKey);
    }

    /** 供引擎等场景补全 app 归属 */
    public ExecutionContext withAppId(Long appId) {
        return new ExecutionContext(origin, principal, appId, chainId, traceRowId, callerTraceId,
                depth, deadlineEpochMs, ancestors, selfKey, allowedTargets, idempotencyKey);
    }

    public ExecutionContext withTraceRowId(Long rowId) {
        return new ExecutionContext(origin, principal, appId, chainId, rowId, callerTraceId,
                depth, deadlineEpochMs, ancestors, selfKey, allowedTargets, idempotencyKey);
    }

    public ExecutionContext withAllowedTargets(Set<String> targets) {
        return new ExecutionContext(origin, principal, appId, chainId, traceRowId, callerTraceId,
                depth, deadlineEpochMs, ancestors, selfKey, targets, idempotencyKey);
    }

    /** 构造子调用上下文：深度 +1、祖先累计、超时预算继承；幂等键只属于根派发，不下传 */
    public ExecutionContext child(TargetType targetType, String targetRef) {
        Set<String> next = new LinkedHashSet<>(ancestors);
        if (selfKey != null) next.add(selfKey);
        return new ExecutionContext(origin, principal, appId, chainId, null, traceRowId,
                depth + 1, deadlineEpochMs, next, targetType.name() + ":" + targetRef,
                allowedTargets, null);
    }

    public long remainingBudgetMs() {
        return deadlineEpochMs - System.currentTimeMillis();
    }
}
