package com.luban.workflow.controller;

import com.luban.workflow.service.LintService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/lint")
@RequiredArgsConstructor
public class LintController {

    private final LintService lintService;

    @PostMapping("/form-code")
    public Map<String, Object> lintFormCode(@RequestBody Map<String, Object> params) {
        String html = params.getOrDefault("html", "").toString();
        String css = params.getOrDefault("css", "").toString();
        String js = params.getOrDefault("js", "").toString();
        return lintService.lintFormCode(html, css, js);
    }

    @PostMapping("/field-schema")
    public Map<String, Object> lintFieldSchema(@RequestBody Map<String, Object> params) {
        String fields = params.getOrDefault("fields", "[]").toString();
        return lintService.lintFieldSchema(fields);
    }

    @PostMapping("/workflow")
    public Map<String, Object> lintWorkflow(@RequestBody Map<String, Object> params) {
        String nodes = params.getOrDefault("nodes", "[]").toString();
        String edges = params.getOrDefault("edges", "[]").toString();
        String fields = params.getOrDefault("fields", "[]").toString();
        return lintService.lintWorkflow(nodes, edges, fields);
    }

    @PostMapping("/condition")
    public Map<String, Object> lintCondition(@RequestBody Map<String, Object> params) {
        String expression = params.getOrDefault("expression", "").toString();
        String fields = params.getOrDefault("fields", "[]").toString();
        return lintService.lintCondition(expression, fields);
    }
}