package com.luban.invoke;

/**
 * 目标执行器（策略模式）：每种 TargetType 一个实现，只负责"怎么执行"，
 * 鉴权与护栏由 InvocationService 统一处理。需要发起子调用时经 ObjectProvider
 * 取 InvocationService（避免与漏斗的构造循环）。
 */
public interface TargetExecutor {

    TargetType support();

    /**
     * @param ctx 漏斗回填 traceRowId 后的上下文；子调用请用 ctx.child(type, ref)
     */
    InvocationResult execute(InvocationRequest request, ExecutionContext ctx);
}
