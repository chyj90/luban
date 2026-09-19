package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.service.QuestionGapMiningService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 问题洞察：问数流量的语义缺口挖掘（未命中概念 / SQL 失败 / 权限拦截 / 用户反馈）。
 * 内置语义包的内容清单由这里反推。
 */
@RestController
@RequestMapping("/api/v1/ontology/gaps")
@RequiredArgsConstructor
@RequirePermission(Permissions.CONNECT_CONCEPTS)
public class QuestionGapController {

    private final QuestionGapMiningService miningService;

    @GetMapping
    public ResponseEntity<ApiResponse<Map<String, Object>>> gaps(
            @RequestParam(defaultValue = "14") int days) {
        return ResponseEntity.ok(ApiResponse.ok(miningService.mine(days)));
    }
}
