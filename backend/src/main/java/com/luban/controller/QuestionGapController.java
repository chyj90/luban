package com.luban.controller;

import com.luban.annotation.RequirePermission;
import com.luban.constant.Permissions;
import com.luban.dto.ApiResponse;
import com.luban.service.GapAutoFixService;
import com.luban.service.QuestionGapMiningService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
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
    private final GapAutoFixService gapAutoFixService;

    @GetMapping
    public ResponseEntity<ApiResponse<Map<String, Object>>> gaps(
            @RequestParam(defaultValue = "14") int days) {
        return ResponseEntity.ok(ApiResponse.ok(miningService.mine(days)));
    }

    /**
     * AI 修复建议：LLM 分析缺口聚簇（未命中概念 → 概念定义建议；SQL 失败 → 绑定诊断）。
     * body: { bucket, term, samples: [{question, sql?, error?}] }，只出建议不落库。
     */
    @PostMapping("/fix-proposal")
    public ResponseEntity<ApiResponse<Map<String, Object>>> fixProposal(
            @RequestBody Map<String, Object> body) {
        String bucket = body.get("bucket") instanceof String s ? s : null;
        String term = body.get("term") instanceof String s ? s : "";
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> samples = (List<Map<String, Object>>) body.get("samples");
        if (bucket == null || bucket.isBlank()) {
            throw new IllegalArgumentException("缺少 bucket");
        }
        return ResponseEntity.ok(ApiResponse.ok(gapAutoFixService.propose(bucket, term, samples)));
    }
}
