package com.luban.selftest;

import com.luban.dto.ApiResponse;
import com.luban.entity.User;
import com.luban.selftest.dto.TestRunReport;
import com.luban.selftest.dto.TestSpec;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 应用链路自检（一键测试的 L2 业务链路层端点）。
 * 仅应用所有者可调用（AppSelfTestService 内强校验，威胁模型 T1）；
 * 报告同步返回、不落库、无读取端点（T9）。
 */
@RestController
@RequestMapping("/api/v1/applications/{appId}/self-test")
public class AppSelfTestController {

    private final AppSelfTestService selfTestService;

    public AppSelfTestController(AppSelfTestService selfTestService) {
        this.selfTestService = selfTestService;
    }

    @PostMapping("/run")
    public ApiResponse<TestRunReport> run(
            @PathVariable Long appId,
            @RequestBody TestSpec spec,
            @AuthenticationPrincipal User user) {
        return ApiResponse.ok(selfTestService.execute(appId, spec, user));
    }
}
