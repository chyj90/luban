package com.luban.exception;

import com.luban.dto.ApiResponse;
import com.luban.security.appaccess.AppAccessService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import java.util.stream.Collectors;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(AppAccessService.AppAccessDeniedException.class)
    public ResponseEntity<ApiResponse<Void>> handleAppAccessDenied(AppAccessService.AppAccessDeniedException ex) {
        log.warn("应用访问被拒绝: status={} message={}", ex.getStatus(), ex.getMessage());
        return ResponseEntity.status(ex.getStatus())
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ApiResponse<Void>> handleResponseStatus(ResponseStatusException ex) {
        log.warn("请求被拒绝: {} {}", ex.getStatusCode(), ex.getReason());
        return ResponseEntity.status(ex.getStatusCode())
                .body(ApiResponse.error(ex.getReason()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiResponse<Void>> handleNotReadable(HttpMessageNotReadableException ex) {
        String detail = ex.getMostSpecificCause().getMessage();
        log.error("请求体解析失败: {}", detail, ex);
        // TestSpec 反序列化失败：原始 Jackson 报错对 LLM/用户不可操作（2026-09-17 请假案例自检
        // 3 轮失败中 2 轮源于契约字段名/结构不符），归一化为"常见错误 + 期望结构"的自解释错误
        if (detail != null && detail.contains("com.luban.selftest.dto")) {
            return ResponseEntity.badRequest().body(ApiResponse.error(
                    "TestSpec 结构不符合契约: " + detail
                    + "。常见错误：① expect 必须是对象 {\"operator\":\"cell_eq|rows_count_eq|cell_contains|is_empty\",\"value\":\"期望值\"}，不是数组；"
                    + "② query_run 步骤用数字字段 \"queryId\"、workflow_start 步骤用数字字段 \"definitionId\"，不是 queryName/processId；"
                    + "③ actors 是平的 {\"别名\": 平台用户ID}。完整字段契约见 app_selfcheck 工具描述"));
        }
        return ResponseEntity.badRequest().body(ApiResponse.error("请求体格式错误: " + detail));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidation(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
                .collect(Collectors.joining(", "));
        log.warn("参数校验失败: {}", message);
        return ResponseEntity.badRequest().body(ApiResponse.error(message));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<Void>> handleIllegalArg(IllegalArgumentException ex) {
        log.warn("非法参数: {}", ex.getMessage());
        return ResponseEntity.badRequest().body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResponse<Void>> handleBusiness(BusinessException ex) {
        log.warn("业务异常: {}", ex.getMessage());
        return ResponseEntity.badRequest().body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<ApiResponse<Void>> handleRuntime(RuntimeException ex) {
        log.warn("运行时异常: {}", ex.getMessage(), ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.error(describe(ex)));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleAll(Exception ex) {
        log.error("未捕获异常: {}", ex.getMessage(), ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.error(describe(ex)));
    }

    /** 500 响应必须带异常类名：NPE 等 message 为 null 的异常若只回 null，调用方只能看到裸状态码，无从排查 */
    private String describe(Exception ex) {
        String cls = ex.getClass().getSimpleName();
        return ex.getMessage() == null ? cls : cls + ": " + ex.getMessage();
    }
}