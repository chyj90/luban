package com.luban.controller;

import com.luban.constant.ToolType;
import com.luban.dto.ApiResponse;
import com.luban.entity.Application;
import com.luban.entity.ToolDefinition;
import com.luban.security.appaccess.AppAccess;
import com.luban.security.appaccess.AppAction;
import com.luban.entity.User;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.repository.UserRepository;
import com.luban.service.PageService;
import com.luban.workflow.entity.Role;
import com.luban.workflow.entity.RoleUser;
import com.luban.workflow.repository.RoleRepository;
import com.luban.workflow.repository.RoleUserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/application-tools")
@AppAccess(action = AppAction.RUN, from = AppAccess.Source.PATH, key = "applicationId")
public class ApplicationToolController {

    private final com.luban.orchestration.service.OrchestrationService orchestrationService;
    private final com.luban.service.ToolExecutionService toolExecutionService;
    private final com.luban.orchestration.service.OrchestrationToolInvoker orchestrationToolInvoker;

    private static final Logger log = LoggerFactory.getLogger(ApplicationToolController.class);

    private final ToolDefinitionRepository toolDefinitionRepository;
    private final RoleRepository roleRepository;
    private final RoleUserRepository roleUserRepository;
    private final UserRepository userRepository;
    private final PageService pageService;
    private final ApplicationRepository applicationRepository;
    private final com.luban.security.appaccess.AppAccessService appAccessService;

    public ApplicationToolController(ToolDefinitionRepository toolDefinitionRepository,
                                     RoleRepository roleRepository,
                                     RoleUserRepository roleUserRepository,
                                     UserRepository userRepository,
                                     PageService pageService,
                                     ApplicationRepository applicationRepository,
                                     com.luban.security.appaccess.AppAccessService appAccessService,
            com.luban.orchestration.service.OrchestrationService orchestrationService,
            com.luban.service.ToolExecutionService toolExecutionService,
            com.luban.orchestration.service.OrchestrationToolInvoker orchestrationToolInvoker) {
        this.toolDefinitionRepository = toolDefinitionRepository;
        this.roleRepository = roleRepository;
        this.roleUserRepository = roleUserRepository;
        this.userRepository = userRepository;
        this.pageService = pageService;
        this.applicationRepository = applicationRepository;
        this.appAccessService = appAccessService;
        this.orchestrationService = orchestrationService;
        this.toolExecutionService = toolExecutionService;
        this.orchestrationToolInvoker = orchestrationToolInvoker;
    }

    @PostMapping("/{applicationId}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> create(
            @PathVariable Long applicationId,
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal User user) {
        String name = (String) body.get("name");
        String displayName = (String) body.getOrDefault("displayName", name);
        String description = (String) body.getOrDefault("description", "");
        String method = (String) body.getOrDefault("method", "GET");
        String url = (String) body.get("url");

        if (name == null || name.isBlank() || url == null || url.isBlank()) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("name 和 url 不能为空"));
        }

        String uniqueName = "app_" + applicationId + "_" + name.replaceAll("[^a-zA-Z0-9_-]", "_");
        if (toolDefinitionRepository.findByName(uniqueName).isPresent()) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("API 名称已存在: " + name));
        }

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> headers = (List<Map<String, Object>>) body.get("headers");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> queryParams = (List<Map<String, Object>>) body.get("queryParams");
        String bodyContent = (String) body.get("body");
        String contentType = (String) body.getOrDefault("contentType", "application/json");

        Map<String, Object> config = new LinkedHashMap<>();
        config.put("method", method);
        config.put("url", url);
        if (headers != null) config.put("headers", headers);
        if (queryParams != null) config.put("queryParams", queryParams);
        if (bodyContent != null && !bodyContent.isBlank()) config.put("body", bodyContent);
        config.put("contentType", contentType);

        ToolDefinition tool = new ToolDefinition();
        tool.setName(uniqueName);
        tool.setDisplayName(displayName);
        tool.setDescription(description);
        tool.setToolType(ToolType.HTTP);
        tool.setGroupId(applicationId);
        tool.setScope("APPLICATION");
        tool.setConfig(toJson(config));
        tool.setCreatedBy(user.getId());

        toolDefinitionRepository.save(tool);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(toToolMap(tool)));
    }

    private void checkAppOwnership(Long applicationId, User user) {
        Application app = applicationRepository.findById(applicationId)
                .orElseThrow(() -> new IllegalArgumentException("应用不存在"));
        if (!app.getCreatedBy().equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "无权操作此应用");
        }
    }

    @PutMapping("/{applicationId}/{id}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> update(
            @PathVariable Long applicationId,
            @PathVariable Long id,
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal User user) {
        checkAppOwnership(applicationId, user);
        ToolDefinition tool = toolDefinitionRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("API 不存在: " + id));

        if (!"APPLICATION".equals(tool.getScope()) || !tool.getGroupId().equals(applicationId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ApiResponse.error("无权修改此 API"));
        }

        String displayName = (String) body.get("displayName");
        String description = (String) body.get("description");
        String method = (String) body.get("method");
        String url = (String) body.get("url");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> headers = (List<Map<String, Object>>) body.get("headers");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> queryParams = (List<Map<String, Object>>) body.get("queryParams");
        String bodyContent = (String) body.get("body");
        String contentType = (String) body.get("contentType");

        Map<String, Object> config = new LinkedHashMap<>();
        config.put("method", method != null ? method : "GET");
        config.put("url", url != null ? url : "");
        if (headers != null) config.put("headers", headers);
        if (queryParams != null) config.put("queryParams", queryParams);
        if (bodyContent != null && !bodyContent.isBlank()) config.put("body", bodyContent);
        if (contentType != null) config.put("contentType", contentType);

        if (displayName != null) tool.setDisplayName(displayName);
        if (description != null) tool.setDescription(description);
        tool.setConfig(toJson(config));

        toolDefinitionRepository.save(tool);
        return ResponseEntity.ok(ApiResponse.ok(toToolMap(tool)));
    }

    @DeleteMapping("/{applicationId}/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(
            @PathVariable Long applicationId,
            @PathVariable Long id,
            @AuthenticationPrincipal User user) {
        checkAppOwnership(applicationId, user);
        ToolDefinition tool = toolDefinitionRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("API 不存在: " + id));

        if (!"APPLICATION".equals(tool.getScope()) || !tool.getGroupId().equals(applicationId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ApiResponse.error("无权删除此 API"));
        }

        toolDefinitionRepository.delete(tool);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    @PostMapping("/{applicationId}/{id}/run")
    public ResponseEntity<ApiResponse<Map<String, Object>>> run(
            @PathVariable Long applicationId,
            @PathVariable Long id,
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal User user) {
        ToolDefinition tool = toolDefinitionRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("API 不存在: " + id));

        String scope = tool.getScope();
        if ("APPLICATION".equals(scope)) {
            checkAppOwnership(applicationId, user);
            if (!tool.getGroupId().equals(applicationId)) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(ApiResponse.error("无权调用此 API"));
            }
        } else if (!"PLATFORM".equals(scope)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ApiResponse.error("不支持的 API 类型"));
        }

        // ORCHESTRATION 类型工具：委托编排引擎执行（params 即 start 入参）。
        // 编排属应用级资源：工具所属应用必须与请求应用一致（防跨应用越权执行）。
        if (tool.getToolType() == com.luban.constant.ToolType.ORCHESTRATION) {
            Long orchDefId;
            try {
                orchDefId = orchestrationToolInvoker.requireOrchestrationId(tool);
            } catch (IllegalArgumentException e) {
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                        .body(ApiResponse.error(e.getMessage()));
            }
            var orchDef = orchestrationService.getById(orchDefId);
            if (!orchDef.getApplicationId().equals(applicationId)) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(ApiResponse.error("无权调用此编排（属于其他应用）"));
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> orchParams = (Map<String, Object>) body.getOrDefault("params", Map.of());
            return ResponseEntity.ok(ApiResponse.ok(orchestrationToolInvoker.invoke(orchDefId, user.getId(), orchParams)));
        }

        // 授权 API（PLATFORM scope）额外校验：白名单 + 系统权限（KEY 绑定不参与内部调用）
        if ("PLATFORM".equals(scope)) {
            List<Role> appRoles = roleRepository.findByApplicationId(applicationId);
            List<Long> appRoleIds = appRoles.stream().map(Role::getId).toList();
            List<RoleUser> userRoles = roleUserRepository.findByUserId(user.getId());
            boolean inWhitelist = userRoles.stream()
                    .anyMatch(ru -> appRoleIds.contains(ru.getRoleId()));
            if (!inWhitelist) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(ApiResponse.error("无权访问此应用，请联系管理员"));
            }
            if (!appAccessService.canUseSystemAsset(user.getId(), tool.getGroupId())) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(ApiResponse.error("无权调用此系统的 API：请先申请该系统的数据访问权限"));
            }
        }

        @SuppressWarnings("unchecked")
        Map<String, Object> params = (Map<String, Object>) body.getOrDefault("params", Map.of());

        try {
            return ResponseEntity.ok(ApiResponse.ok(toolExecutionService.executeApplicationTool(tool, params)));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error(e.getMessage()));
        } catch (Exception e) {
            log.error("API run failed: {}", tool.getDisplayName(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(ApiResponse.error(e.getMessage()));
        }
    }

    @GetMapping("/{applicationId}/roles")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> listRoles(
            @PathVariable Long applicationId) {
        List<Role> roles = roleRepository.findByApplicationId(applicationId);
        List<Map<String, Object>> result = roles.stream().map(role -> {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("id", role.getId());
            map.put("name", role.getName());
            map.put("slug", role.getSlug());
            map.put("description", role.getDescription());
            map.put("memberCount", roleUserRepository.findByRoleId(role.getId()).size());
            return map;
        }).collect(Collectors.toList());
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    @GetMapping("/{applicationId}/pages")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> listPages(
            @PathVariable Long applicationId) {
        return ResponseEntity.ok(ApiResponse.ok(pageService.listByApplication(applicationId)));
    }

    @PostMapping("/{applicationId}/members")
    @AppAccess(action = AppAction.MANAGE, from = AppAccess.Source.PATH, key = "applicationId")
    @Transactional
    public ResponseEntity<ApiResponse<Map<String, Object>>> addMember(
            @PathVariable Long applicationId,
            @RequestBody Map<String, Object> body,
            @AuthenticationPrincipal User user) {
        Long targetUserId = body.get("userId") instanceof Number
                ? ((Number) body.get("userId")).longValue() : null;
        Long roleId = body.get("roleId") instanceof Number
                ? ((Number) body.get("roleId")).longValue() : null;

        if (targetUserId == null || roleId == null) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("userId 和 roleId 不能为空"));
        }

        Role role = roleRepository.findById(roleId)
                .orElseThrow(() -> new RuntimeException("角色不存在: " + roleId));
        if (!role.getApplicationId().equals(applicationId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ApiResponse.error("角色不属于此应用"));
        }

        if (roleUserRepository.findByRoleIdAndUserId(roleId, targetUserId).isPresent()) {
            return ResponseEntity.badRequest()
                    .body(ApiResponse.error("用户已是该角色成员"));
        }

        roleUserRepository.save(new RoleUser(roleId, targetUserId));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("userId", targetUserId);
        result.put("roleId", roleId);
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    @DeleteMapping("/{applicationId}/members/{userId}")
    @AppAccess(action = AppAction.MANAGE, from = AppAccess.Source.PATH, key = "applicationId")
    @Transactional
    public ResponseEntity<ApiResponse<Void>> removeMember(
            @PathVariable Long applicationId,
            @PathVariable Long userId,
            @AuthenticationPrincipal User user) {
        List<Role> appRoles = roleRepository.findByApplicationId(applicationId);
        for (Role role : appRoles) {
            roleUserRepository.findByRoleIdAndUserId(role.getId(), userId)
                    .ifPresent(roleUserRepository::delete);
        }

        return ResponseEntity.ok(ApiResponse.ok(null));
    }

    private Map<String, Object> toToolMap(ToolDefinition tool) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", tool.getId());
        map.put("name", tool.getName());
        map.put("displayName", tool.getDisplayName());
        map.put("description", tool.getDescription());
        map.put("toolType", tool.getToolType().getValue());
        map.put("groupId", tool.getGroupId());
        map.put("scope", tool.getScope());
        map.put("config", tool.getConfig());
        map.put("inputSchema", tool.getInputSchema());
        return map;
    }

    private String toJson(Object obj) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(obj);
        } catch (Exception e) {
            return "{}";
        }
    }
}