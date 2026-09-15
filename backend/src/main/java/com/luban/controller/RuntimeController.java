package com.luban.controller;

import com.luban.dto.ApiResponse;
import com.luban.dto.RunQueryRequest;
import com.luban.dto.RunQueryResponse;
import com.luban.entity.Application;
import com.luban.entity.CodePage;
import com.luban.entity.Datasource;
import com.luban.entity.Page;
import com.luban.entity.Query;
import com.luban.entity.ToolDefinition;
import com.luban.entity.User;
import com.luban.entity.ApplicationApiKey;
import com.luban.orchestration.service.OrchestrationService;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.CodePageRepository;
import com.luban.repository.PageRepository;
import com.luban.repository.QueryRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.repository.ApplicationApiKeyRepository;
import com.luban.repository.ApiKeyToolRepository;
import com.luban.service.PageService;
import com.luban.service.QueryService;
import com.luban.workflow.entity.Role;
import com.luban.workflow.entity.RoleUser;
import com.luban.workflow.entity.RolePermission;
import com.luban.workflow.repository.RoleRepository;
import com.luban.workflow.repository.RoleUserRepository;
import com.luban.workflow.repository.RolePermissionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/runtime")
public class RuntimeController {

    private static final Logger log = LoggerFactory.getLogger(RuntimeController.class);

    private final PageService pageService;
    private final PageRepository pageRepository;
    private final CodePageRepository codePageRepository;
    private final QueryRepository queryRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final com.luban.security.appaccess.AppAccessService appAccessService;
    private final com.luban.invoke.InvocationService invocationService;

    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper = new com.fasterxml.jackson.databind.ObjectMapper();

    public RuntimeController(PageService pageService,
                             PageRepository pageRepository,
                             CodePageRepository codePageRepository,
                             QueryRepository queryRepository,
                             ToolDefinitionRepository toolDefinitionRepository,
                             com.luban.security.appaccess.AppAccessService appAccessService,
                             com.luban.invoke.InvocationService invocationService) {
        this.pageService = pageService;
        this.pageRepository = pageRepository;
        this.codePageRepository = codePageRepository;
        this.queryRepository = queryRepository;
        this.toolDefinitionRepository = toolDefinitionRepository;
        this.appAccessService = appAccessService;
        this.invocationService = invocationService;
    }

    @GetMapping("/{pageId}/code")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getPageCode(
            @PathVariable Long pageId,
            @AuthenticationPrincipal User user) {
        checkPageAccess(pageId, user);
        return ResponseEntity.ok(ApiResponse.ok(pageService.getCodePage(pageId)));
    }

    @GetMapping("/{pageId}/resources")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getPageResources(
            @PathVariable Long pageId,
            @AuthenticationPrincipal User user) {
        checkPageAccess(pageId, user);

        CodePage codePage = codePageRepository.findByPageId(pageId)
                .orElseThrow(() -> new RuntimeException("页面资源不存在"));

        List<Long> queryIds = fromJsonLongList(codePage.getQueryIds());
        List<Long> toolIds = fromJsonLongList(codePage.getToolIds());

        List<Query> queries = queryIds.isEmpty() ? List.of() : queryRepository.findAllById(queryIds);
        List<ToolDefinition> tools = toolIds.isEmpty() ? List.of() : toolDefinitionRepository.findAllById(toolIds);

        Map<String, Object> resources = new HashMap<>();
        resources.put("queries", queries);
        resources.put("tools", tools);

        return ResponseEntity.ok(ApiResponse.ok(resources));
    }

    @PostMapping("/{pageId}/query/{queryId}/run")
    public ResponseEntity<ApiResponse<Map<String, Object>>> runQuery(
            @PathVariable Long pageId,
            @PathVariable Long queryId,
            @RequestBody(required = false) RunQueryRequest request,
            @AuthenticationPrincipal User user) {
        checkPageAccess(pageId, user);
        // 查询归属与 PLATFORM 数据源授权由 QueryTargetExecutor 统一执行
        Map<String, Object> params = request == null ? Map.of() : request.getParams();
        var result = invocationService.invoke(com.luban.invoke.InvocationRequest.of(
                com.luban.invoke.TargetType.QUERY, queryId, params,
                com.luban.invoke.ExecutionContext.root(
                        com.luban.invoke.InvocationOrigin.PAGE,
                        com.luban.invoke.InvocationPrincipal.ofUser(user.getId()),
                        getPageApplicationId(pageId), null)));
        return invocationResponse(result);
    }

    @PostMapping("/{pageId}/tool/{toolId}/run")
    public ResponseEntity<ApiResponse<Map<String, Object>>> runTool(
            @PathVariable Long pageId,
            @PathVariable Long toolId,
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal User user) {
        checkPageAccess(pageId, user);
        // scope 归属 / 白名单 / Key 绑定 / ORCHESTRATION 子调用由 ToolTargetExecutor 统一执行
        @SuppressWarnings("unchecked")
        Map<String, Object> params = (Map<String, Object>) body.getOrDefault("params", Map.of());
        var result = invocationService.invoke(com.luban.invoke.InvocationRequest.of(
                com.luban.invoke.TargetType.TOOL, toolId, params,
                com.luban.invoke.ExecutionContext.root(
                        com.luban.invoke.InvocationOrigin.PAGE,
                        com.luban.invoke.InvocationPrincipal.ofUser(user.getId()),
                        getPageApplicationId(pageId), null)));
        return invocationResponse(result);
    }

    private ResponseEntity<ApiResponse<Map<String, Object>>> invocationResponse(
            com.luban.invoke.InvocationResult result) {
        if (result.isSuccess()) {
            return ResponseEntity.ok(ApiResponse.ok(result.dataAsMap()));
        }
        String code = result.getErrorCode();
        HttpStatus status = com.luban.invoke.InvocationException.FORBIDDEN.equals(code)
                || com.luban.invoke.InvocationException.TARGET_NOT_IN_MANIFEST.equals(code)
                ? HttpStatus.FORBIDDEN : HttpStatus.BAD_REQUEST;
        return ResponseEntity.status(status).body(ApiResponse.error(result.getErrorMessage()));
    }

    private void checkPageAccess(Long pageId, User user) {
        Page page = pageRepository.findById(pageId)
                .orElseThrow(() -> new RuntimeException("页面不存在"));

        appAccessService.assertPageAccess(user.getId(), page.getApplicationId(), pageId);
    }

    private Long getPageApplicationId(Long pageId) {
        Page page = pageRepository.findById(pageId)
                .orElseThrow(() -> new RuntimeException("页面不存在"));
        return page.getApplicationId();
    }

    private List<Long> fromJsonLongList(String json) {
        if (json == null || json.isEmpty()) return List.of();
        try {
            return objectMapper.readValue(json, objectMapper.getTypeFactory().constructCollectionType(List.class, Long.class));
        } catch (Exception e) {
            log.warn("Failed to parse JSON long list: {}", json, e);
            return List.of();
        }
    }
}