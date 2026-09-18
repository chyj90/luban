package com.luban.selftest;

import com.luban.dto.ApiResponse;
import com.luban.entity.User;
import com.luban.selftest.dto.SelfTestRunView;
import com.luban.selftest.dto.TestSpec;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 应用链路自检（一键测试的 L2 业务链路层端点）。
 * 异步运行记录模型：POST 立即返回 runId（status=RUNNING），引擎后台执行，
 * 报告持久化并可经 GET 回读——前端超时不再丢报告，历史构成回归台账。
 * 全部端点 owner-only（AppSelfTestService 内强校验，威胁模型 T1；
 * 运行记录含业务数据证据，读取同样仅限所有者）。
 */
@RestController
@RequestMapping("/api/v1/applications/{appId}/self-test")
public class AppSelfTestController {

    private final AppSelfTestService selfTestService;

    public AppSelfTestController(AppSelfTestService selfTestService) {
        this.selfTestService = selfTestService;
    }

    /** 启动运行：立即返回 RUNNING 记录；应用已有自检在跑时返回那条记录（followedExisting=true） */
    @PostMapping("/runs")
    public ApiResponse<SelfTestRunView> start(
            @PathVariable Long appId,
            @RequestParam(defaultValue = "MANUAL") String source,
            @RequestBody TestSpec spec,
            @AuthenticationPrincipal User user) {
        AppSelfTestService.StartOutcome outcome = selfTestService.startRun(appId, spec, user, source);
        SelfTestRunView view = selfTestService.toView(outcome.run());
        view.setFollowedExisting(outcome.followedExisting());
        return ApiResponse.ok(view, outcome.followedExisting()
                ? "该应用已有自检正在运行，已转而返回该运行（runId=" + outcome.run().getRunId() + "）"
                : "ok");
    }

    /** 运行历史（按创建时间倒序，limit 上限 50） */
    @GetMapping("/runs")
    public ApiResponse<List<SelfTestRunView>> list(
            @PathVariable Long appId,
            @RequestParam(defaultValue = "20") int limit,
            @AuthenticationPrincipal User user) {
        List<SelfTestRunView> runs = selfTestService.listRuns(appId, user, limit).stream()
                .map(selfTestService::toView)
                .toList();
        return ApiResponse.ok(runs);
    }

    /** 单条运行详情：RUNNING 含当前步骤进度，终态含完整报告 */
    @GetMapping("/runs/{runId}")
    public ApiResponse<SelfTestRunView> detail(
            @PathVariable Long appId,
            @PathVariable String runId,
            @AuthenticationPrincipal User user) {
        return ApiResponse.ok(selfTestService.toView(selfTestService.getRun(appId, runId, user)));
    }
}
