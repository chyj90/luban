package com.luban.selftest.dto;

import lombok.Data;
import java.util.Map;

/**
 * 自检测试步骤。字段按 type 选用，与步骤无关的字段必须留空（引擎校验）。
 */
@Data
public class TestStep {
    /** 步骤唯一 ID，供 ${id.xxx} 占位符引用 */
    private String id;
    /** 执行身份：TestSpec.actors 的别名；缺省为应用所有者 */
    private String actor;
    /** query_run | workflow_start | task_complete | wait_outbox | assert_sql | capture_sql */
    private String type;

    // ── query_run ──
    private Long queryId;
    private Map<String, Object> params;

    // ── workflow_start ──
    private Long definitionId;
    private Map<String, Object> formData;

    // ── task_complete ──
    /** 引用发起步骤的 ${...} 表达式或步骤 ID，指向要操作的流程实例 */
    private String instanceRef;
    /** APPROVE | REJECT */
    private String action;
    private String comment;

    // ── wait_outbox ──
    /** 等待超时秒数，缺省 20，上限 55 */
    private Integer timeoutSeconds;

    // ── assert_sql / capture_sql ──
    private String sql;
    /** capture_sql：把首行首列存入该变量，供后续 ${var} 引用 */
    private String captureVar;

    // ── assert_sql ──
    private Expectation expect;
}
