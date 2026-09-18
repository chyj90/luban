package com.luban.selftest.dto;

import lombok.Data;
import java.util.ArrayList;
import java.util.List;

/** 自检测试运行报告（MVP 同步返回不落库，无读取端点——渗透缓解 T9） */
@Data
public class TestRunReport {
    private String runId;
    private boolean passed;
    private String summary;
    private List<StepResult> steps = new ArrayList<>();
    /** 清理动作日志（引擎生成的 DELETE/恢复 UPDATE/实例清除） */
    private List<String> cleanupLog = new ArrayList<>();
    /** 清理失败/无法自动恢复的残留（表 + 主键），供用户手动处理 */
    private List<String> residuals = new ArrayList<>();
    private List<String> warnings = new ArrayList<>();
}
