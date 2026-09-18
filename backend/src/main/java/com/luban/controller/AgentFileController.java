package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.entity.AgentFile;
import com.luban.entity.User;
import com.luban.service.AgentFileService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Agent 附件文件：前端开发 Agent 对话上传 Word/TXT/Excel。
 * 上传即解析（同步），内容经归属校验后供对话注入与按需读取。
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/agent/files")
@RequiredArgsConstructor
public class AgentFileController {

    private static final int MAX_PYTHON_CODE_CHARS = 20000;

    private final AgentFileService agentFileService;
    private final com.luban.storage.FileStorage storage;
    private final com.luban.orchestration.engine.SandboxPythonClient sandboxPythonClient;

    @PostMapping
    public ResponseEntity<ApiResponse<Map<String, Object>>> upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "appId", required = false) Long appId,
            @AuthenticationPrincipal User user) {
        AgentFile saved = agentFileService.upload(file, appId, user.getId());
        return ResponseEntity.ok(ApiResponse.ok(agentFileService.toResponse(saved)));
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> list(
            @RequestParam("appId") Long appId,
            @AuthenticationPrincipal User user) {
        List<Map<String, Object>> files = agentFileService.listByApp(appId, user.getId())
                .stream().map(agentFileService::toResponse).toList();
        return ResponseEntity.ok(ApiResponse.ok(files));
    }

    @GetMapping("/{fileKey}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> meta(
            @PathVariable String fileKey,
            @AuthenticationPrincipal User user) {
        AgentFile file = agentFileService.getByKey(fileKey);
        agentFileService.assertCanRead(file, user.getId());
        return ResponseEntity.ok(ApiResponse.ok(agentFileService.toResponse(file)));
    }

    /** 提取文本分页读取（word/txt/csv） */
    @GetMapping("/{fileKey}/text")
    public ResponseEntity<ApiResponse<Map<String, Object>>> text(
            @PathVariable String fileKey,
            @RequestParam(defaultValue = "0") int offset,
            @RequestParam(defaultValue = "4000") int limit,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(ApiResponse.ok(agentFileService.readText(fileKey, user.getId(), offset, limit)));
    }

    /** Excel 明细行分页读取 */
    @GetMapping("/{fileKey}/sheet")
    public ResponseEntity<ApiResponse<Map<String, Object>>> sheet(
            @PathVariable String fileKey,
            @RequestParam(required = false) String sheetName,
            @RequestParam(defaultValue = "0") int startRow,
            @RequestParam(defaultValue = "100") int maxRows,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(ApiResponse.ok(
                agentFileService.readSheet(fileKey, user.getId(), sheetName, startRow, maxRows)));
    }

    @GetMapping("/{fileKey}/download")
    public ResponseEntity<byte[]> download(
            @PathVariable String fileKey,
            @AuthenticationPrincipal User user) {
        AgentFile file = agentFileService.getByKey(fileKey);
        agentFileService.assertCanRead(file, user.getId());
        try {
            byte[] content = java.nio.file.Files.readAllBytes(storage.resolve(file.getStoragePath()));
            String encoded = URLEncoder.encode(file.getOriginalName(), StandardCharsets.UTF_8).replace("+", "%20");
            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION,
                            "attachment; filename*=UTF-8''" + encoded)
                    .contentType(MediaType.APPLICATION_OCTET_STREAM)
                    .body(content);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @DeleteMapping("/{fileKey}")
    public ResponseEntity<ApiResponse<Void>> delete(
            @PathVariable String fileKey,
            @AuthenticationPrincipal User user) {
        agentFileService.delete(fileKey, user.getId());
        return ResponseEntity.ok(ApiResponse.ok(null, "deleted"));
    }

    /**
     * 在沙箱里执行 LLM 编写的 Python 代码解析附件（通用能力，无解析协议）：
     * 代码定义 def main(ctx)，经 ctx['_files'][文件名] 取文件路径（pandas/openpyxl 可用，无网络），
     * 返回值 JSON 序列化后 ≤5000 字符。会触发前端危险操作确认门。
     */
    @PostMapping("/{fileKey}/execute-python")
    public ResponseEntity<ApiResponse<Map<String, Object>>> executePython(
            @PathVariable String fileKey,
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal User user) {
        AgentFile file = agentFileService.getByKey(fileKey);
        agentFileService.assertCanRead(file, user.getId());
        String code = body.get("code") == null ? "" : String.valueOf(body.get("code"));
        if (code.isBlank()) {
            return ResponseEntity.badRequest().body(ApiResponse.error("code 不能为空"));
        }
        if (code.length() > MAX_PYTHON_CODE_CHARS) {
            return ResponseEntity.badRequest().body(ApiResponse.error("code 过长（>" + MAX_PYTHON_CODE_CHARS + " 字符）"));
        }
        String absPath = storage.resolve(file.getStoragePath()).toAbsolutePath().toString();
        var result = sandboxPythonClient.executeWithFiles(code, Map.of(), List.of(absPath), 60);
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("success", result.ok());
        resp.put("result", result.result());
        resp.put("stderr", result.stderr());
        resp.put("errorCode", result.errorCode());
        return ResponseEntity.ok(ApiResponse.ok(resp));
    }
}
