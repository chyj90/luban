package com.luban.invoke;

import lombok.Value;

import java.util.Map;

/** 漏斗调用请求：目标 + 参数 + 上下文。 */
@Value
public class InvocationRequest {

    TargetType targetType;
    /** queryId / toolId / 编排 definitionId / 流程 definitionId */
    Long targetId;
    Map<String, Object> params;
    ExecutionContext ctx;

    public static InvocationRequest of(TargetType type, Long targetId,
                                       Map<String, Object> params, ExecutionContext ctx) {
        return new InvocationRequest(type, targetId, params == null ? Map.of() : params, ctx);
    }

    /** 漏斗内的目标键，用于环检测与 manifest 校验 */
    public String targetKey() {
        return targetType.name() + ":" + targetId;
    }
}
