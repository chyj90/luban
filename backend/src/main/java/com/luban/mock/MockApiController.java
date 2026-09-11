package com.luban.mock;

import com.luban.entity.User;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 对外测试用 API 端点，仅用于编排端到端测试中 HTTP 节点的真实调用目标。
 *
 * 安全约束：
 * - 必须通过 JWT 登录后调用（禁止未登录裸调，避免渗透扫描报高危）；
 * - 仅限 APPLICATION scope 的工具定义引用，不暴露为公共 API。
 */
@RestController
@RequestMapping("/api/v1/mock")
public class MockApiController {

    /**
     * GET echo：回显 query 参数与调用者信息。
     * 调用示例：GET /api/v1/mock/echo?msg=hello&repeat=3
     */
    @GetMapping("/echo")
    public ResponseEntity<Map<String, Object>> echo(
            @RequestParam Map<String, String> params,
            @AuthenticationPrincipal User user,
            HttpServletRequest request) {

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("method", "GET");
        result.put("calledBy", user.getAccount());
        result.put("userId", user.getId());

        Map<String, Object> echoed = new LinkedHashMap<>();
        params.forEach((k, v) -> {
            if (!"Authorization".equalsIgnoreCase(k)) {
                echoed.put(k, v);
            }
        });
        result.put("params", echoed);
        result.put("status", "ok");

        return ResponseEntity.ok(result);
    }

    /**
     * POST data：回显请求体与调用者信息。
     * 调用示例：POST /api/v1/mock/data  Body: {"action":"create","payload":{"k":"v"}}
     */
    @PostMapping("/data")
    public ResponseEntity<Map<String, Object>> data(
            @RequestBody(required = false) Map<String, Object> body,
            @AuthenticationPrincipal User user,
            HttpServletRequest request) {

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("method", "POST");
        result.put("calledBy", user.getAccount());
        result.put("userId", user.getId());
        result.put("received", body != null ? body : Map.of());
        result.put("status", "ok");

        return ResponseEntity.ok(result);
    }
}