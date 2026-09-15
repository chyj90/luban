package com.luban.invoke;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * 统一调用漏斗（星型中心）：所有跨对象调用唯一入口。
 *
 * 职责顺序：
 *  ① 鉴权：内部触发校验「发布时固化的目标清单」（ctx.allowedTargets）；
 *     页面/外部/Agent 入口自身已完成认证与入口级授权。
 *  ② 护栏：跨对象深度 ≤8、(type,id) 环检测、超时预算校验。
 *  ③ 分发：按 targetType 路由到 TargetExecutor。
 *  ④ 审计：invocation_trace 落库（RUNNING → SUCCESS/FAILED），chainId + parentTraceRowId 串全链路。
 */
@Slf4j
@Service
public class InvocationService {

    /** 跨对象嵌套深度上限 */
    public static final int MAX_DEPTH = 8;

    private final Map<TargetType, TargetExecutor> executors = new EnumMap<>(TargetType.class);
    private final InvocationTraceRecorder recorder;

    public InvocationService(List<TargetExecutor> executorList, InvocationTraceRecorder recorder) {
        this.recorder = recorder;
        for (TargetExecutor executor : executorList) {
            executors.put(executor.support(), executor);
        }
    }

    public InvocationResult invoke(InvocationRequest request) {
        ExecutionContext ctx = request.getCtx();
        if (ctx == null) {
            throw new IllegalArgumentException("ExecutionContext 不能为空（漏斗调用必须携带上下文）");
        }
        long start = System.currentTimeMillis();
        String targetKey = request.targetKey();

        // ① 鉴权：内部触发只允许调用发布清单内的目标
        if (ctx.getAllowedTargets() != null && !ctx.getAllowedTargets().contains(targetKey)) {
            throw new InvocationException(InvocationException.TARGET_NOT_IN_MANIFEST,
                    "目标 " + targetKey + " 不在调用方发布清单内");
        }

        // ② 护栏
        if (ctx.getDepth() > MAX_DEPTH) {
            throw new InvocationException(InvocationException.DEPTH_EXCEEDED,
                    "跨对象调用深度超过上限 " + MAX_DEPTH);
        }
        if (ctx.getAncestors().contains(targetKey)) {
            throw new InvocationException(InvocationException.CYCLE_DETECTED,
                    "检测到循环调用：" + targetKey);
        }
        if (ctx.remainingBudgetMs() <= 0) {
            throw new InvocationException(InvocationException.TIMEOUT_BUDGET_EXCEEDED,
                    "调用链超时预算已耗尽");
        }

        TargetExecutor executor = executors.get(request.getTargetType());
        if (executor == null) {
            throw new InvocationException(InvocationException.UNSUPPORTED_TARGET,
                    "不支持的目标类型：" + request.getTargetType());
        }

        // ④ 审计：先落 RUNNING（拿行 id 供子调用串链），结束后补写结果
        InvocationTrace trace = new InvocationTrace();
        trace.setChainId(ctx.getChainId());
        trace.setParentTraceRowId(ctx.getCallerTraceId());
        trace.setOrigin(ctx.getOrigin().name());
        if (ctx.getPrincipal() != null) {
            trace.setPrincipalKind(ctx.getPrincipal().getKind().name());
            trace.setPrincipalId(ctx.getPrincipal().getUserId() != null
                    ? ctx.getPrincipal().getUserId() : ctx.getPrincipal().getApiKeyId());
        }
        trace.setAppId(ctx.getAppId());
        trace.setTargetType(request.getTargetType().name());
        trace.setTargetId(request.getTargetId());
        trace.setDepth(ctx.getDepth());
        trace.setStatus("RUNNING");
        trace.setIdempotencyKey(ctx.getIdempotencyKey());
        try {
            trace.setCreatedAt(java.time.LocalDateTime.now());
            recorder.record(trace);
        } catch (Exception e) {
            log.warn("调用审计落库失败（不影响执行）: {}", e.getMessage());
        }

        try {
            InvocationResult result = executor.execute(request, ctx.withTraceRowId(trace.getId()));
            long elapsed = System.currentTimeMillis() - start;
            done(trace.getId(), "SUCCESS" , null, null, elapsed);
            return new InvocationResult(result.isSuccess(), result.getData(),
                    result.getErrorCode(), result.getErrorMessage(), elapsed, trace.getId());
        } catch (InvocationException e) {
            long elapsed = System.currentTimeMillis() - start;
            done(trace.getId(), "FAILED", e.getCode(), e.getMessage(), elapsed);
            throw e;
        } catch (Exception e) {
            long elapsed = System.currentTimeMillis() - start;
            String message = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            done(trace.getId(), "FAILED", "EXECUTION_FAILED", message, elapsed);
            if (e instanceof RuntimeException re) throw re;
            throw new RuntimeException(message, e);
        }
    }

    private void done(Long rowId, String status, String errorCode, String errorMessage, long elapsedMs) {
        try {
            recorder.complete(rowId, status, errorCode, errorMessage, elapsedMs);
        } catch (Exception e) {
            log.warn("调用审计完结落库失败（不影响执行）: {}", e.getMessage());
        }
    }
}
