package com.luban.selftest.dto;

import lombok.Data;
import java.util.Map;

/** 单步执行结果（含证据） */
@Data
public class StepResult {
    private String id;
    private String type;
    private Long actorId;
    private boolean passed;
    private String error;
    private long durationMs;
    /** 捕获变量（insertId/instanceId/captureVar）与 outbox 证据等 */
    private Map<String, Object> evidence;
}
