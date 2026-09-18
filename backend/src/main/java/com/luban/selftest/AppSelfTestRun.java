package com.luban.selftest;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 应用链路自检运行记录：每次自检（手工抽屉 / agent 技能）一行，异步执行的状态与终态报告。
 * 报告持久化解决了"同步返回 + 前端 30s 超时 → 报告只存在于后端日志"的丢失问题，
 * 也是自检历史（回归台账）的唯一事实源。
 */
@Data
@Entity
@Table(name = "app_self_test_run", indexes = {
        @Index(name = "uk_self_test_run_run_id", columnList = "runId", unique = true),
        @Index(name = "idx_self_test_run_app", columnList = "applicationId, createdAt")
})
public class AppSelfTestRun {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "run_id", nullable = false, length = 64)
    private String runId;

    @Column(name = "application_id", nullable = false)
    private Long applicationId;

    /** MANUAL（编辑器自检抽屉）/ AGENT（主智能体技能） */
    @Column(nullable = false, length = 16)
    private String source;

    /** RUNNING / PASSED / FAILED / ABORTED（服务重启等导致的运行中断） */
    @Column(nullable = false, length = 16)
    private String status;

    @Column(name = "test_name", length = 255)
    private String testName;

    @Column(columnDefinition = "TEXT")
    private String specJson;

    /** 终态报告 JSON（TestRunReport）；RUNNING 期间为 null */
    @Column(columnDefinition = "LONGTEXT")
    private String reportJson;

    @Column(length = 1024)
    private String summary;

    /** 终态才有值；RUNNING/ABORTED 为 null */
    @Column(name = "passed")
    private Boolean passed;

    /** 进行中的步骤 id（进度展示用） */
    @Column(name = "current_step_id", length = 64)
    private String currentStepId;

    @Column(name = "operator_id", nullable = false)
    private Long operatorId;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "started_at")
    private LocalDateTime startedAt;

    @Column(name = "finished_at")
    private LocalDateTime finishedAt;
}
