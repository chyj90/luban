package com.luban.orchestration.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.constant.Permissions;
import com.luban.entity.ToolDefinition;
import com.luban.orchestration.dsl.OrchestrationDsl;
import com.luban.orchestration.engine.OrchestrationEngine;
import com.luban.orchestration.entity.OrchestrationDefinition;
import com.luban.orchestration.entity.OrchestrationExecution;
import com.luban.orchestration.entity.OrchestrationVersion;
import com.luban.orchestration.lint.OrchestrationLinter;
import com.luban.orchestration.repository.OrchestrationDefinitionRepository;
import com.luban.orchestration.repository.OrchestrationExecutionRepository;
import com.luban.orchestration.repository.OrchestrationVersionRepository;
import com.luban.repository.ApiKeyToolRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.security.appaccess.AppAccessService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 编排定义服务：保存（新版本）/ lint / 试运行 / 发布（→ ToolDefinition）/ 执行。
 *
 * 权限语义（由 Controller 的 @AppAccess 注解 + 本服务的二次校验共同保证）：
 * - DEVELOP：保存 / lint / 试运行
 * - MANAGE：发布 / 下线
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OrchestrationService {

    public static final String STATUS_DRAFT = "DRAFT";
    public static final String STATUS_PUBLISHED = "PUBLISHED";
    public static final String STATUS_ARCHIVED = "ARCHIVED";

    private final OrchestrationDefinitionRepository definitionRepository;
    private final OrchestrationVersionRepository versionRepository;
    private final OrchestrationExecutionRepository executionRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final com.luban.repository.ApiKeyToolRepository apiKeyToolRepository;
    private final com.luban.workflow.repository.WorkflowDefinitionRepository workflowDefinitionRepository;
    private final OrchestrationLinter linter;
    private final OrchestrationEngine engine;
    private final OrchestrationExecutionRecorder executionRecorder;
    private final AppAccessService appAccessService;
    private final com.luban.service.ApiKeyRateLimiter apiKeyRateLimiter;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public OrchestrationDefinition getById(Long id) {
        return definitionRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("编排不存在: " + id));
    }

    public OrchestrationVersion getCurrentVersion(OrchestrationDefinition def) {
        return def.getCurrentVersionId() == null ? null
                : versionRepository.findById(def.getCurrentVersionId()).orElse(null);
    }

    @Transactional
    public OrchestrationDefinition create(String name, String description, Long applicationId,
                                          String dslJson, Long userId) {
        var lint = lintDslJson(dslJson);
        if (!lint.passed()) {
            throw new IllegalArgumentException("编排校验未通过: " + String.join("; ", lint.errors()));
        }

        OrchestrationDefinition def = new OrchestrationDefinition();
        def.setName(name);
        def.setDescription(description);
        def.setApplicationId(applicationId);
        def.setCreatedBy(userId);
        def.setStatus(STATUS_DRAFT);
        def = definitionRepository.save(def);

        OrchestrationVersion version = saveVersion(def.getId(), dslJson, userId, 1);
        def.setCurrentVersionId(version.getId());
        return definitionRepository.save(def);
    }

    /** 保存新版本（DRAFT 链追加；已发布的定义保存后回到 DRAFT，需重新发布） */
    @Transactional
    public OrchestrationVersion saveVersion(Long definitionId, String dslJson, Long userId) {
        OrchestrationDefinition def = getById(definitionId);
        var lint = lintDslJson(dslJson);
        if (!lint.passed()) {
            throw new IllegalArgumentException("编排校验未通过: " + String.join("; ", lint.errors()));
        }
        OrchestrationVersion version = saveVersion(definitionId, dslJson, userId,
                nextMaxVersion(definitionId));
        def.setCurrentVersionId(version.getId());
        if (STATUS_PUBLISHED.equals(def.getStatus())) {
            def.setStatus(STATUS_DRAFT); // 内容已变，需重新发布
        }
        definitionRepository.save(def);
        return version;
    }

    private int nextMaxVersion(Long definitionId) {
        return versionRepository.findAll().stream()
                .filter(v -> v.getDefinitionId().equals(definitionId))
                .mapToInt(OrchestrationVersion::getVersion).max().orElse(0) + 1;
    }

    private OrchestrationVersion saveVersion(Long definitionId, String dslJson, Long userId, int version) {
        OrchestrationVersion v = new OrchestrationVersion();
        v.setDefinitionId(definitionId);
        v.setVersion(version);
        v.setDsl(dslJson);
        v.setChecksum(sha256(dslJson));
        v.setCreatedBy(userId);
        v.setCreatedAt(java.time.LocalDateTime.now());
        return versionRepository.save(v);
    }

    public OrchestrationLinter.LintResult lintDsl(OrchestrationDsl.Dsl dsl) {
        return linter.lint(dsl,
                queryId -> queryRepositoryExists(queryId),
                toolId -> toolDefinitionRepository.existsById(toolId),
                wfDefId -> workflowDefinitionRepository.existsById(wfDefId),
                orchId -> definitionRepository.existsById(orchId));
    }

    /**
     * 完整 lint：结构/引用/语义校验 + 未知字段扫描。
     * 入参是原始 DSL 字符串——反序列化用 ignoreUnknown=true，字段名写错会被静默丢弃，
     * 必须在原始 JSON 上扫一遍未知字段，否则 LLM 生成的 DSL 会变成空壳节点还查不出原因。
     */
    public OrchestrationLinter.LintResult lintDslJson(String dslJson) {
        OrchestrationDsl.Dsl dsl = parseDsl(dslJson);
        var structural = lintDsl(dsl);
        var unknown = linter.checkUnknownFields(dslJson);
        if (unknown.errors().isEmpty() && unknown.warnings().isEmpty()) {
            return structural;
        }
        java.util.List<String> errors = new java.util.ArrayList<>(structural.errors());
        errors.addAll(unknown.errors());
        java.util.List<String> warnings = new java.util.ArrayList<>(structural.warnings());
        warnings.addAll(unknown.warnings());
        return new OrchestrationLinter.LintResult(errors.isEmpty(), errors, warnings);
    }

    /** 既有 Query 存在性（避免依赖具体 service；此处用 repository 精确查询） */
    @org.springframework.beans.factory.annotation.Autowired
    private com.luban.repository.QueryRepository queryRepository;

    private boolean queryRepositoryExists(Long queryId) {
        return queryRepository.existsById(queryId);
    }

    public OrchestrationDsl.Dsl parseDsl(String dslJson) {
        try {
            OrchestrationDsl.Dsl dsl = objectMapper.readValue(dslJson, OrchestrationDsl.Dsl.class);
            if (dsl == null || dsl.getNodes() == null) throw new IllegalArgumentException("DSL 解析结果为空");
            return dsl;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("DSL JSON 解析失败: " + e.getMessage(), e);
        }
    }

    /**
     * 试运行 / 执行：engine.execute + 执行留痕。
     * 刻意不加 @Transactional：workflow 等节点会调用 ProcessService 等 @Transactional(REQUIRED)
     * 服务并加入本事务，节点异常即使被引擎捕获，事务也已被标记 rollback-only，方法正常返回后
     * 提交时抛 UnexpectedRollbackException，结构化失败结果与 nodeTrace 全部丢失
     * （2026-09-14 请假编排案例）。节点各自管理事务；执行记录由
     * OrchestrationExecutionRecorder 以独立事务落库，保证失败也有迹可查。
     */
    public Map<String, Object> execute(Long definitionId, Long userId, String trigger,
                                       Long apiKeyId, Map<String, Object> inputs) {
        return execute(definitionId, userId, trigger, apiKeyId, inputs, null);
    }

    /**
     * 带调用上下文的执行：版本 manifest 作为内部触发的授权清单写入 ctx，
     * 由漏斗在节点级调用时校验（深度/环/清单）。
     */
    public Map<String, Object> execute(Long definitionId, Long userId, String trigger,
                                       Long apiKeyId, Map<String, Object> inputs,
                                       com.luban.invoke.ExecutionContext ctx) {
        OrchestrationDefinition def = getById(definitionId);
        Long versionId = def.getPublishedVersionId() != null
                && !OrchestrationExecution.TRIGGER_USER_TEST.equals(trigger)
                ? def.getPublishedVersionId() : def.getCurrentVersionId();
        OrchestrationVersion version = versionRepository.findById(versionId)
                .orElseThrow(() -> new IllegalArgumentException("编排版本不存在"));
        OrchestrationDsl.Dsl dsl = parseDsl(version.getDsl());
        if (ctx != null) {
            ctx = ctx.withAppId(def.getApplicationId())
                    .withAllowedTargets(manifestOf(version));
        }

        long start = System.currentTimeMillis();
        OrchestrationEngine.ExecutionResult result = ctx != null
                ? engine.execute(dsl, inputs, inputSchemaOf(dsl), ctx)
                : engine.execute(dsl, inputs, inputSchemaOf(dsl));
        long duration = System.currentTimeMillis() - start;

        OrchestrationExecution exec = new OrchestrationExecution();
        exec.setDefinitionId(definitionId);
        exec.setVersionId(versionId);
        exec.setTriggerType(trigger);
        exec.setApiKeyId(apiKeyId);
        exec.setInputs(maskAndTruncate(inputs));
        exec.setNodeTrace(toJson(result.nodeTrace()));
        exec.setStatus(result.success() ? "SUCCESS" : ("TIMEOUT".equals(result.errorCode()) ? "TIMEOUT" : "FAILED"));
        exec.setErrorCode(result.errorCode());
        exec.setDurationMs((int) duration);
        executionRecorder.save(exec);
        if (!result.success()) {
            log.warn("编排 {} 执行失败（{}）：{}，nodeTrace={}", definitionId, result.errorCode(),
                    result.errorMessage(), result.nodeTrace());
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("success", result.success());
        out.put("data", result.success() ? result.output() : Map.of());
        out.put("errorCode", result.errorCode());
        out.put("errorMessage", result.errorMessage());
        out.put("nodeTrace", result.nodeTrace());
        out.put("durationMs", duration);
        out.put("executionId", exec.getId());
        return out;
    }

    private Map<String, Object> inputSchemaOf(OrchestrationDsl.Dsl dsl) {
        return dsl.getNodes().stream()
                .filter(n -> "start".equals(n.getNodeType()))
                .findFirst()
                .map(n -> {
                    Map<String, Object> schema = new LinkedHashMap<>();
                    if (n.config().getInputs() != null) {
                        for (OrchestrationDsl.PortDef p : n.config().getInputs()) {
                            Map<String, Object> spec = new LinkedHashMap<>();
                            if (p.getDefaultValue() != null) spec.put("defaultValue", p.getDefaultValue());
                            schema.put(p.getName(), spec);
                        }
                    }
                    return schema;
                })
                .orElse(Map.of());
    }

    /** 发布：固定当前版本 + 注册 ToolDefinition（ORCHESTRATION 类型） */
    @Transactional
    public Map<String, Object> publish(Long definitionId, Long userId) {
        OrchestrationDefinition def = getById(definitionId);
        if (def.getCurrentVersionId() == null) {
            throw new IllegalArgumentException("当前定义没有任何版本可发布");
        }
        def.setStatus(STATUS_PUBLISHED);
        def.setPublishedVersionId(def.getCurrentVersionId());
        definitionRepository.save(def);

        OrchestrationVersion version = versionRepository.findById(def.getCurrentVersionId()).orElseThrow();
        OrchestrationDsl.Dsl dsl = parseDsl(version.getDsl());

        // 固化目标清单（capability manifest）：运行时内部触发只允许调用清单内目标
        if (version.getTargets() == null || version.getTargets().isBlank()) {
            version.setTargets(extractTargetsJson(dsl));
            version = versionRepository.save(version);
        }

        // 注册/更新 ToolDefinition（ORCHESTRATION 类型），input/output schema 由 DSL 推导
        String toolName = "orch_" + definitionId;
        ToolDefinition tool = toolDefinitionRepository.findAll().stream()
                .filter(t -> toolName.equals(t.getName()))
                .findFirst().orElseGet(() -> {
                    ToolDefinition t = new ToolDefinition();
                    t.setName(toolName);
                    // 应用级 scope：编排只对本应用可见/可调用（跨应用隔离）。
                    // 外部调用 = 外部开发者加入应用（或经应用 owner 授权）后，用应用绑定的 Key 调用。
                    t.setScope("APPLICATION");
                    t.setGroupId(def.getApplicationId());
                    t.setToolType(com.luban.constant.ToolType.ORCHESTRATION);
                    t.setConfig(toJson(Map.of("orchestrationId", definitionId,
                            "versionId", def.getPublishedVersionId())));
                    return t;
                });
        tool.setDisplayName(def.getName());
        tool.setDescription(def.getDescription() == null
                ? "API 编排: " + def.getName()
                : "API 编排: " + def.getName() + " — " + def.getDescription());
        tool.setInputSchema(toJson(inputSchemaJson(dsl)));
        tool.setOutputSchema(toJson(outputSchemaJson(dsl)));
        tool = toolDefinitionRepository.save(tool);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("definitionId", definitionId);
        out.put("publishedVersionId", def.getPublishedVersionId());
        out.put("toolDefinitionId", tool.getId());
        out.put("toolName", tool.getName());
        return out;
    }

    private Map<String, Object> inputSchemaJson(OrchestrationDsl.Dsl dsl) {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");
        Map<String, Object> props = new LinkedHashMap<>();
        dsl.getNodes().stream().filter(n -> "start".equals(n.getNodeType())).findFirst()
                .ifPresent(start -> {
                    if (start.config().getInputs() != null) {
                        for (OrchestrationDsl.PortDef p : start.config().getInputs()) {
                            props.put(p.getName(), Map.of("type", p.getType() == null ? "string" : p.getType()));
                        }
                    }
                });
        schema.put("properties", props);
        return schema;
    }

    private Map<String, Object> outputSchemaJson(OrchestrationDsl.Dsl dsl) {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");
        return schema;
    }

    private String maskAndTruncate(Map<String, Object> inputs) {
        if (inputs == null) return "{}";
        Map<String, Object> masked = new LinkedHashMap<>();
        inputs.forEach((k, v) -> {
            if (k != null && (k.toLowerCase().contains("password") || k.toLowerCase().contains("token")
                    || k.toLowerCase().contains("secret") || k.toLowerCase().contains("key"))) {
                masked.put(k, "***");
            } else {
                String s = String.valueOf(v);
                masked.put(k, s.length() > 200 ? s.substring(0, 200) + "…" : s);
            }
        });
        return toJson(masked);
    }

    private String toJson(Object o) {
        try {
            return objectMapper.writeValueAsString(o);
        } catch (Exception e) {
            return "{}";
        }
    }

    private String sha256(String input) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public List<OrchestrationDefinition> listByApplication(Long applicationId) {
        return definitionRepository.findByApplicationIdAndStatusNotOrderByUpdatedAtDesc(
                applicationId, STATUS_ARCHIVED);
    }

    public List<OrchestrationExecution> executions(Long definitionId) {
        return executionRepository.findTop50ByDefinitionIdOrderByCreatedAtDesc(definitionId);
    }

    /** 频控检查：超限抛 SecurityException（由 controller 转 429）。实现抽取为 ApiKeyRateLimiter，与查询外调入口共享每 KEY 配额 */
    private void checkRateLimit(Long apiKeyId) {
        apiKeyRateLimiter.check(apiKeyId);
    }

    /**
     * 内部直接调用（JWT 认证）：用户必须是编排所属应用的成员，无需 Key。
     */
    public Map<String, Object> invokeInternal(String toolName, Long userId, Map<String, Object> inputs) {
        ToolDefinition tool = toolDefinitionRepository.findAll().stream()
                .filter(t -> toolName.equals(t.getName()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("编排工具不存在: " + toolName));
        var config = parseConfigJson(tool.getConfig());
        long definitionId = ((Number) config.get("orchestrationId")).longValue();
        long publishedVersionId = ((Number) config.getOrDefault("versionId", 0)).longValue();

        OrchestrationDefinition def = getById(definitionId);
        if (!STATUS_PUBLISHED.equals(def.getStatus())) {
            throw new IllegalArgumentException("编排未发布，无法调用");
        }
        // 用户必须是编排所属应用成员
        appAccessService.assertAccess(userId, def.getApplicationId(),
                com.luban.security.appaccess.AppAction.RUN);

        OrchestrationVersion version = versionRepository.findById(publishedVersionId)
                .orElseThrow(() -> new IllegalArgumentException("发布版本不存在"));

        long start = System.currentTimeMillis();
        OrchestrationDsl.Dsl dsl = parseDsl(version.getDsl());
        OrchestrationEngine.ExecutionResult result = engine.execute(dsl, inputs, inputSchemaOf(dsl));
        long duration = System.currentTimeMillis() - start;

        OrchestrationExecution exec = new OrchestrationExecution();
        exec.setDefinitionId(definitionId);
        exec.setVersionId(publishedVersionId);
        exec.setTriggerType(OrchestrationExecution.TRIGGER_USER_TEST);
        exec.setInputs(maskAndTruncate(inputs));
        exec.setNodeTrace(toJson(result.nodeTrace()));
        exec.setStatus(result.success() ? "SUCCESS" : ("TIMEOUT".equals(result.errorCode()) ? "TIMEOUT" : "FAILED"));
        exec.setErrorCode(result.errorCode());
        exec.setDurationMs((int) duration);
        executionRecorder.save(exec);
        if (!result.success()) {
            log.warn("编排 {} 执行失败（{}）：{}，nodeTrace={}", definitionId, result.errorCode(),
                    result.errorMessage(), result.nodeTrace());
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("success", result.success());
        out.put("data", result.success() ? result.output() : Map.of());
        out.put("errorCode", result.errorCode());
        out.put("errorMessage", result.errorMessage());
        out.put("nodeTrace", result.nodeTrace());
        out.put("durationMs", duration);
        out.put("executionId", exec.getId());
        return out;
    }

    /**
     * 外部数据面调用：API Key 必须对发布该编排的 ToolDefinition 持有 APPROVED 权限。
     * 无状态校验（不依赖 SecurityContext）——供 ApiKeyAuthFilter 白名单路径调用。
     */
    public Map<String, Object> invokeByApiKey(String toolName, Long apiKeyId, Map<String, Object> inputs) {
        return invokeByApiKey(toolName, apiKeyId, inputs, null);
    }

    public Map<String, Object> invokeByApiKey(String toolName, Long apiKeyId, Map<String, Object> inputs,
                                              com.luban.invoke.ExecutionContext ctx) {
        checkRateLimit(apiKeyId);
        ToolDefinition tool = toolDefinitionRepository.findAll().stream()
                .filter(t -> toolName.equals(t.getName()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("编排工具不存在: " + toolName));
        var config = parseConfigJson(tool.getConfig());
        long definitionId = ((Number) config.get("orchestrationId")).longValue();
        long publishedVersionId = ((Number) config.getOrDefault("versionId", 0)).longValue();

        // Key 对该工具的授权校验（ApiKeyTool APPROVED）
        boolean approved = apiKeyToolRepository.findByApiKeyIdAndStatus(apiKeyId, "APPROVED").stream()
                .anyMatch(kt -> kt.getToolId().equals(tool.getId()));
        if (!approved) {
            throw new SecurityException("该 API KEY 未获此编排调用授权");
        }

        OrchestrationDefinition def = getById(definitionId);
        if (!STATUS_PUBLISHED.equals(def.getStatus())) {
            throw new IllegalArgumentException("编排未发布，无法调用");
        }
        OrchestrationVersion version = versionRepository.findById(publishedVersionId)
                .orElseThrow(() -> new IllegalArgumentException("发布版本不存在"));

        if (ctx != null) {
            ctx = ctx.withAppId(def.getApplicationId()).withAllowedTargets(manifestOf(version));
        }
        long start = System.currentTimeMillis();
        OrchestrationDsl.Dsl dsl = parseDsl(version.getDsl());
        OrchestrationEngine.ExecutionResult result = ctx != null
                ? engine.execute(dsl, inputs, inputSchemaOf(dsl), ctx)
                : engine.execute(dsl, inputs, inputSchemaOf(dsl));
        long duration = System.currentTimeMillis() - start;

        OrchestrationExecution exec = new OrchestrationExecution();
        exec.setDefinitionId(definitionId);
        exec.setVersionId(publishedVersionId);
        exec.setTriggerType(OrchestrationExecution.TRIGGER_API_KEY);
        exec.setApiKeyId(apiKeyId);
        exec.setInputs(maskAndTruncate(inputs));
        exec.setNodeTrace(toJson(result.nodeTrace()));
        exec.setStatus(result.success() ? "SUCCESS" : "FAILED");
        exec.setErrorCode(result.errorCode());
        exec.setDurationMs((int) duration);
        executionRecorder.save(exec);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("success", result.success());
        out.put("data", result.success() ? result.output() : Map.of());
        out.put("durationMs", duration);
        if (!result.success()) out.put("errorCode", result.errorCode());
        return out;
    }

    /** 版本发布清单解析；历史版本无 targets 字段时返回 null（不限制，向后兼容） */
    public java.util.Set<String> manifestOf(OrchestrationVersion version) {
        if (version == null || version.getTargets() == null || version.getTargets().isBlank()) {
            return null;
        }
        try {
            List<String> keys = objectMapper.readValue(version.getTargets(),
                    new com.fasterxml.jackson.core.type.TypeReference<List<String>>() {});
            return new java.util.LinkedHashSet<>(keys);
        } catch (Exception e) {
            log.warn("版本 {} manifest 解析失败，按不限制处理", version.getId());
            return null;
        }
    }

    /** 从 DSL 提取所有跨对象目标引用，作为发布固化清单 */
    private String extractTargetsJson(OrchestrationDsl.Dsl dsl) {
        java.util.Set<String> targets = new java.util.LinkedHashSet<>();
        if (dsl.getNodes() == null) return toJson(targets);
        for (OrchestrationDsl.NodeDef node : dsl.getNodes()) {
            OrchestrationDsl.NodeDef.Config c = node.config();
            String type = node.getNodeType() == null ? "" : node.getNodeType();
            switch (type) {
                case "query" -> { if (c.getQueryId() != null) targets.add("QUERY:" + c.getQueryId()); }
                case "http" -> { if (c.getToolId() != null) targets.add("TOOL:" + c.getToolId()); }
                case "workflow" -> { if (c.getWorkflowDefinitionId() != null) targets.add("FLOW:" + c.getWorkflowDefinitionId()); }
                case "subflow" -> { if (c.getSubOrchestrationId() != null) targets.add("ORCHESTRATION:" + c.getSubOrchestrationId()); }
                default -> { }
            }
        }
        return toJson(targets);
    }

    private Map<String, Object> parseConfigJson(String config) {
        try {
            return objectMapper.readValue(config == null ? "{}" : config,
                    new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }

    /** 供 AppAccessResolver 使用：编排 → 应用 */
    public Long applicationIdOf(Long definitionId) {
        return definitionRepository.findById(definitionId)
                .map(OrchestrationDefinition::getApplicationId).orElse(null);
    }

    public boolean exists(Long definitionId) {
        return definitionRepository.existsById(definitionId);
    }

    @Transactional
    public void delete(Long definitionId) {
        OrchestrationDefinition def = definitionRepository.findById(definitionId)
                .orElseThrow(() -> new IllegalArgumentException("编排不存在: " + definitionId));
        def.setStatus(STATUS_ARCHIVED);
        definitionRepository.save(def);
    }
}