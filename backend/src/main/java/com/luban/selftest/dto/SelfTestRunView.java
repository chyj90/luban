package com.luban.selftest.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 自检运行记录视图（GET 端点返回）：元数据 + 解析后的终态报告/原始 spec。
 * report 解析失败时为 null（reportJson 仍在，可人工排查），不影响元数据展示。
 */
@Data
@JsonInclude(JsonInclude.Include.NON_NULL)
public class SelfTestRunView {
    private Long id;
    private String runId;
    private Long applicationId;
    private String source;
    private String status;
    private String testName;
    private String summary;
    private Boolean passed;
    private String currentStepId;
    private LocalDateTime createdAt;
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;
    private TestRunReport report;
    private TestSpec spec;
    /** true = 本次调用请求运行时应用已有自检在跑，返回的是那个正在运行的记录 */
    private Boolean followedExisting;
}
