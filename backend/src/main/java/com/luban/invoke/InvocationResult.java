package com.luban.invoke;

import lombok.Value;

import java.util.Map;

/** 漏斗调用结果：data 形态随目标类型不同（Query=列/行、Tool=Map或JSON字符串、编排=执行输出）。 */
@Value
public class InvocationResult {

    boolean success;
    Object data;
    String errorCode;
    String errorMessage;
    long elapsedMs;
    /** 本次调用在 invocation_trace 表中的记录 id */
    Long traceRowId;

    public static InvocationResult ok(Object data, long elapsedMs, Long traceRowId) {
        return new InvocationResult(true, data, null, null, elapsedMs, traceRowId);
    }

    public static InvocationResult fail(String errorCode, String errorMessage, long elapsedMs, Long traceRowId) {
        return new InvocationResult(false, null, errorCode, errorMessage, elapsedMs, traceRowId);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> dataAsMap() {
        return data instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
    }

    public String dataAsString() {
        return data != null ? String.valueOf(data) : null;
    }
}
