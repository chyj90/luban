package com.luban.invoke;

import com.luban.invoke.InvocationException;
import com.luban.invoke.InvocationPrincipal;
import com.luban.invoke.InvocationRequest;
import com.luban.invoke.InvocationResult;
import com.luban.invoke.InvocationService;
import com.luban.invoke.InvocationTraceRecorder;
import com.luban.invoke.InvocationTraceRepository;
import com.luban.invoke.TargetExecutor;
import com.luban.invoke.TargetType;
import com.luban.invoke.ExecutionContext;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 漏斗护栏测试：深度上限 / 环检测 / 发布清单校验 / 审计留痕。 */
class InvocationServiceTest {

    private InvocationTraceRecorder recorderWithIds() {
        InvocationTraceRepository repo = mock(InvocationTraceRepository.class);
        when(repo.save(any())).thenAnswer(inv -> {
            var t = inv.getArgument(0, InvocationTrace.class);
            if (t.getId() == null) t.setId(System.nanoTime());
            return t;
        });
        return new InvocationTraceRecorder(repo);
    }

    private TargetExecutor echoExecutor(TargetType type) {
        return new TargetExecutor() {
            @Override public TargetType support() { return type; }
            @Override public InvocationResult execute(InvocationRequest request, ExecutionContext ctx) {
                return InvocationResult.ok(Map.of("echo", request.getTargetId()), 0, ctx.getTraceRowId());
            }
        };
    }

    private InvocationService service(TargetExecutor... executors) {
        return new InvocationService(List.of(executors), recorderWithIds());
    }

    private ExecutionContext rootCtx() {
        return ExecutionContext.root(InvocationOrigin.PAGE, InvocationPrincipal.ofUser(1L), 9L, null);
    }

    @Test
    void happyPathExecutesAndReturnsData() {
        var svc = service(echoExecutor(TargetType.QUERY));
        var result = svc.invoke(InvocationRequest.of(TargetType.QUERY, 5L, Map.of(), rootCtx()));
        assertThat(result.isSuccess()).isTrue();
        assertThat(result.dataAsMap()).containsEntry("echo", 5L);
        assertThat(result.getTraceRowId()).isNotNull();
    }

    @Test
    void depthBeyondLimitIsRejected() {
        var svc = service(echoExecutor(TargetType.ORCHESTRATION));
        // 模拟已嵌套到上限的 ctx（child 链构造）
        ExecutionContext deep = rootCtx();
        for (int i = 0; i <= InvocationService.MAX_DEPTH; i++) {
            deep = deep.child(TargetType.ORCHESTRATION, String.valueOf(i));
        }
        final ExecutionContext deepCtx = deep;
        assertThatThrownBy(() -> svc.invoke(
                InvocationRequest.of(TargetType.ORCHESTRATION, 1L, Map.of(), deepCtx)))
                .isInstanceOf(InvocationException.class)
                .hasFieldOrPropertyWithValue("code", InvocationException.DEPTH_EXCEEDED);
    }

    @Test
    void cycleWithinChainIsRejected() {
        var svc = service(echoExecutor(TargetType.ORCHESTRATION));
        // 编排 1 → 编排 2 → 编排 1（ancestors 已含 ORCHESTRATION:1）
        ExecutionContext ctx = rootCtx().child(TargetType.ORCHESTRATION, "1")
                .child(TargetType.ORCHESTRATION, "2");
        assertThatThrownBy(() -> svc.invoke(
                InvocationRequest.of(TargetType.ORCHESTRATION, 1L, Map.of(), ctx)))
                .isInstanceOf(InvocationException.class)
                .hasFieldOrPropertyWithValue("code", InvocationException.CYCLE_DETECTED);
    }

    @Test
    void targetOutsideManifestIsRejected() {
        var svc = service(echoExecutor(TargetType.QUERY));
        ExecutionContext ctx = ExecutionContext.root(InvocationOrigin.FLOW_TRIGGER,
                        InvocationPrincipal.onBehalfOf(7L), 9L, "idem-1")
                .withAllowedTargets(Set.of("QUERY:100"));
        assertThatThrownBy(() -> svc.invoke(InvocationRequest.of(TargetType.QUERY, 5L, Map.of(), ctx)))
                .isInstanceOf(InvocationException.class)
                .hasFieldOrPropertyWithValue("code", InvocationException.TARGET_NOT_IN_MANIFEST);
    }

    @Test
    void targetInsideManifestIsAllowed() {
        var svc = service(echoExecutor(TargetType.QUERY));
        ExecutionContext ctx = ExecutionContext.root(InvocationOrigin.FLOW_TRIGGER,
                        InvocationPrincipal.onBehalfOf(7L), 9L, "idem-2")
                .withAllowedTargets(Set.of("QUERY:5"));
        var result = svc.invoke(InvocationRequest.of(TargetType.QUERY, 5L, Map.of(), ctx));
        assertThat(result.isSuccess()).isTrue();
    }

    @Test
    void timeoutBudgetExhaustedIsRejected() {
        var svc = service(echoExecutor(TargetType.QUERY));
        ExecutionContext ctx = rootCtx().child(TargetType.QUERY, "1");
        // 人工构造已过期的预算
        var expired = new ExecutionContext(ctx.getOrigin(), ctx.getPrincipal(), ctx.getAppId(),
                ctx.getChainId(), ctx.getTraceRowId(), ctx.getCallerTraceId(), ctx.getDepth(),
                System.currentTimeMillis() - 1, ctx.getAncestors(), ctx.getSelfKey(),
                ctx.getAllowedTargets(), ctx.getIdempotencyKey());
        assertThatThrownBy(() -> svc.invoke(InvocationRequest.of(TargetType.QUERY, 2L, Map.of(), expired)))
                .isInstanceOf(InvocationException.class)
                .hasFieldOrPropertyWithValue("code", InvocationException.TIMEOUT_BUDGET_EXCEEDED);
    }
}
