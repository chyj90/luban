package com.luban.invoke;

/** 调用来源：决定漏斗内的鉴权策略与护栏口径。 */
public enum InvocationOrigin {
    /** 开发态：设计器试运行/调试 */
    DEV,
    /** 运行时：已授权页面 */
    PAGE,
    /** 外部系统：X-API-Key */
    PUBLIC_API,
    /** 编排节点：编排引擎内对 Query/Tool/编排/流程的调用 */
    ORCHESTRATION_NODE,
    /** 流程触发器：审批节点事件经 outbox 异步派发 */
    FLOW_TRIGGER,
    /** Agent 工具调用 */
    AGENT,
    /** 定时/后台任务 */
    SCHEDULER;

    /** 内部触发：权限走发布时固化的目标清单（manifest），不走用户态动态鉴权 */
    public boolean isInternal() {
        return this == ORCHESTRATION_NODE || this == FLOW_TRIGGER || this == SCHEDULER;
    }
}
