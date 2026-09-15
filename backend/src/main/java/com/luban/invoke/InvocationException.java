package com.luban.invoke;

import lombok.Getter;

/** 漏斗护栏/鉴权失败的统一异常。 */
@Getter
public class InvocationException extends RuntimeException {

    public static final String DEPTH_EXCEEDED = "DEPTH_EXCEEDED";
    public static final String CYCLE_DETECTED = "CYCLE_DETECTED";
    public static final String TIMEOUT_BUDGET_EXCEEDED = "TIMEOUT_BUDGET_EXCEEDED";
    public static final String TARGET_NOT_IN_MANIFEST = "TARGET_NOT_IN_MANIFEST";
    public static final String UNSUPPORTED_TARGET = "UNSUPPORTED_TARGET";
    public static final String FORBIDDEN = "FORBIDDEN";

    private final String code;

    public InvocationException(String code, String message) {
        super(message);
        this.code = code;
    }
}
