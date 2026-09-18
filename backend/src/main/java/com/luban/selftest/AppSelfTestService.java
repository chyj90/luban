package com.luban.selftest;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.dto.RunQueryRequest;
import com.luban.dto.RunQueryResponse;
import com.luban.selftest.dto.Expectation;
import com.luban.selftest.dto.StepResult;
import com.luban.selftest.dto.TestRunReport;
import com.luban.selftest.dto.TestSpec;
import com.luban.selftest.dto.TestStep;
import com.luban.entity.Application;
import com.luban.entity.Datasource;
import com.luban.entity.Query;
import com.luban.entity.User;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.DatasourceRepository;
import com.luban.repository.QueryRepository;
import com.luban.repository.UserRepository;
import com.luban.service.QueryService;
import com.luban.workflow.entity.WorkflowDefinition;
import com.luban.workflow.entity.WorkflowInstance;
import com.luban.workflow.entity.WorkflowTask;
import com.luban.workflow.entity.WorkflowTriggerOutbox;
import com.luban.workflow.repository.WorkflowDefinitionRepository;
import com.luban.workflow.repository.WorkflowHistoryRepository;
import com.luban.workflow.repository.WorkflowInstanceRepository;
import com.luban.workflow.repository.WorkflowTaskRepository;
import com.luban.workflow.repository.WorkflowTriggerOutboxRepository;
import com.luban.workflow.service.ProcessEngine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 应用自检测试引擎（L2 业务链路层）：以真实平台用户身份端到端执行
 * "写库 → 发起流程 → 审批 → 触发器派发 → 数据断言"，全部复用现有服务层
 *（runPreviewAs / startProcess / completeTask），不绕过任何业务规则。
 *
 * 安全设计（渗透测试缓解，见设计文档威胁模型）：
 *  - owner-only（app.createdBy 强校验）；actor 必须是真实平台用户；
 *  - 断言/捕获仅单条 SELECT；清理全部由引擎按写入记账生成（无用户声明 SQL）；
 *  - steps/actors/超时/并发/频次多重限额。
 */
@Service
public class AppSelfTestService {

    private static final Logger log = LoggerFactory.getLogger(AppSelfTestService.class);
    static final long TOTAL_TIMEOUT_MS = 60_000;
    static final int MAX_STEPS = 50;
    static final int MAX_ACTORS = 5;
    static final int DEFAULT_WAIT_SECONDS = 20;
    static final int MAX_WAIT_SECONDS = 55;
    static final int MAX_RUNS_PER_USER_PER_HOUR = 10;
    private static final long WAIT_POLL_INTERVAL_MS = 500;
    private static final Pattern REF_PATTERN = Pattern.compile("\\$\\{([^}]+)}");
    private static final Pattern NUMERIC_WHERE_ID = Pattern.compile(
            "(?i)WHERE[\\s\\S]*?\\bid\\b\\s*=\\s*(\\d+)");

    private final ApplicationRepository applicationRepository;
    private final UserRepository userRepository;
    private final QueryRepository queryRepository;
    private final DatasourceRepository datasourceRepository;
    private final WorkflowDefinitionRepository workflowDefinitionRepository;
    private final WorkflowInstanceRepository workflowInstanceRepository;
    private final WorkflowTaskRepository workflowTaskRepository;
    private final WorkflowHistoryRepository workflowHistoryRepository;
    private final WorkflowTriggerOutboxRepository outboxRepository;
    private final QueryService queryService;
    private final ProcessEngine processEngine;
    private final SelfTestCleanupService cleanupService;
    private final ObjectMapper objectMapper;

    private final Map<Long, Boolean> runningApps = new ConcurrentHashMap<>();
    private final Map<Long, Deque<Long>> userRunTimes = new ConcurrentHashMap<>();

    public AppSelfTestService(
            ApplicationRepository applicationRepository,
            UserRepository userRepository,
            QueryRepository queryRepository,
            DatasourceRepository datasourceRepository,
            WorkflowDefinitionRepository workflowDefinitionRepository,
            WorkflowInstanceRepository workflowInstanceRepository,
            WorkflowTaskRepository workflowTaskRepository,
            WorkflowHistoryRepository workflowHistoryRepository,
            WorkflowTriggerOutboxRepository outboxRepository,
            QueryService queryService,
            ProcessEngine processEngine,
            SelfTestCleanupService cleanupService,
            ObjectMapper objectMapper) {
        this.applicationRepository = applicationRepository;
        this.userRepository = userRepository;
        this.queryRepository = queryRepository;
        this.datasourceRepository = datasourceRepository;
        this.workflowDefinitionRepository = workflowDefinitionRepository;
        this.workflowInstanceRepository = workflowInstanceRepository;
        this.workflowTaskRepository = workflowTaskRepository;
        this.workflowHistoryRepository = workflowHistoryRepository;
        this.outboxRepository = outboxRepository;
        this.queryService = queryService;
        this.processEngine = processEngine;
        this.cleanupService = cleanupService;
        this.objectMapper = objectMapper;
    }

    // ============================================================
    // 执行入口
    // ============================================================

    public TestRunReport execute(Long appId, TestSpec spec, User operator) {
        Application app = applicationRepository.findById(appId)
                .orElseThrow(() -> new IllegalArgumentException("应用不存在"));
        if (!app.getCreatedBy().equals(operator.getId())) {
            // T1：owner-only，与 runPreviewAs 同语义
            throw new IllegalArgumentException("仅应用所有者可执行链路自检");
        }
        if (runningApps.putIfAbsent(appId, Boolean.TRUE) != null) {
            throw new IllegalArgumentException("该应用已有自检正在运行，请稍后再试");
        }
        if (!acquireRunQuota(operator.getId())) {
            runningApps.remove(appId);
            throw new IllegalArgumentException("运行过于频繁（每小时最多 " + MAX_RUNS_PER_USER_PER_HOUR + " 次），请稍后再试");
        }
        try {
            return doExecute(appId, spec, operator);
        } finally {
            runningApps.remove(appId);
        }
    }

    private TestRunReport doExecute(Long appId, TestSpec spec, User operator) {
        TestRunReport report = new TestRunReport();
        report.setRunId("run-" + System.currentTimeMillis() + "-" + UUID.randomUUID().toString().substring(0, 6));
        long startMs = System.currentTimeMillis();
        long deadline = startMs + TOTAL_TIMEOUT_MS;

        validateSpec(spec);
        Map<String, Long> actorIds = resolveActors(spec, operator);
        validateDatasource(appId, spec.getDatasourceId());

        Map<String, Object> vars = new HashMap<>();
        for (Map.Entry<String, Long> e : actorIds.entrySet()) {
            vars.put("actors." + e.getKey(), e.getValue());
        }
        List<LedgerEntry> ledger = new ArrayList<>();
        List<String> residuals = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        log.info("[self-test] 开始 | runId={} appId={} operator={} actors={} steps={} testName={}",
                report.getRunId(), appId, operator.getId(), actorIds.values(),
                spec.getSteps().size(), spec.getTestName());

        boolean allPassed = true;
        try {
            for (TestStep step : spec.getSteps()) {
                if (System.currentTimeMillis() > deadline) {
                    allPassed = false;
                    StepResult timeout = newStepResult(step, operator.getId());
                    timeout.setError("整体超时（60s），本步未执行");
                    report.getSteps().add(timeout);
                    break;
                }
                Set<String> missing = new LinkedHashSet<>();
                StepResult result = runStep(step, appId, spec.getDatasourceId(), actorIds, operator, vars, ledger, residuals, warnings, missing, deadline);
                report.getSteps().add(result);
                if (!result.isPassed()) allPassed = false;
            }
        } finally {
            runCleanup(ledger, spec.getDatasourceId(), report);
        }

        report.setWarnings(warnings);
        report.setResiduals(residuals);
        report.setPassed(allPassed);
        long passedCount = report.getSteps().stream().filter(StepResult::isPassed).count();
        report.setSummary((allPassed ? "通过" : "未通过") + "：" + passedCount + "/" + report.getSteps().size()
                + " 步成功，用时 " + (System.currentTimeMillis() - startMs) + "ms"
                + (residuals.isEmpty() ? "" : "；有 " + residuals.size() + " 条测试残留待处理"));
        log.info("[self-test] 结束 | runId={} passed={} summary={}", report.getRunId(), report.isPassed(), report.getSummary());
        return report;
    }

    // ============================================================
    // 单步执行
    // ============================================================

    private StepResult runStep(TestStep step, Long appId, Long datasourceId, Map<String, Long> actorIds,
                               User operator, Map<String, Object> vars, List<LedgerEntry> ledger,
                               List<String> residuals, List<String> warnings, Set<String> missing, long deadline) {
        StepResult result = newStepResult(step, resolveActorId(step, actorIds, operator));
        long stepStart = System.currentTimeMillis();
        try {
            switch (normalizedType(step)) {
                case "query_run" -> executeQueryRun(step, appId, datasourceId, actorIds, operator, vars, ledger, residuals, warnings, missing, result);
                case "workflow_start" -> executeWorkflowStart(step, appId, datasourceId, actorIds, operator, vars, ledger, warnings, missing, result);
                case "task_complete" -> executeTaskComplete(step, appId, actorIds, operator, vars, ledger, residuals, warnings, missing, result);
                case "wait_outbox" -> executeWaitOutbox(step, vars, deadline, result);
                case "assert_sql" -> executeAssertSql(step, datasourceId, operator, vars, missing, result);
                case "capture_sql" -> executeCaptureSql(step, datasourceId, operator, vars, missing, result);
                default -> result.setError("未知步骤类型: " + step.getType());
            }
        } catch (Exception e) {
            result.setError(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
        }
        result.setDurationMs(System.currentTimeMillis() - stepStart);
        result.setPassed(result.getError() == null);
        return result;
    }

    private void executeQueryRun(TestStep step, Long appId, Long datasourceId, Map<String, Long> actorIds, User operator,
                                 Map<String, Object> vars, List<LedgerEntry> ledger, List<String> residuals,
                                 List<String> warnings, Set<String> missing, StepResult result) {
        if (step.getQueryId() == null) {
            result.setError("query_run 缺少 queryId（数字类型的查询 ID；如果写的是 queryName 请改为对应查询的数字 ID。"
                    + "示例: {\"id\":\"s1\",\"type\":\"query_run\",\"queryId\":175,\"params\":{}}）");
            return;
        }
        Query query = queryRepository.findById(step.getQueryId()).orElse(null);
        if (query == null || !appId.equals(query.getApplicationId())) {
            result.setError("查询不存在或不属于本应用"); return;
        }
        Long actorId = resolveActorId(step, actorIds, operator);
        Map<String, Object> params = resolveMap(step.getParams(), vars, missing);
        if (!missing.isEmpty()) { result.setError("未定义的占位符: " + missing); return; }

        RunQueryRequest req = new RunQueryRequest();
        req.setParams(params);
        RunQueryResponse resp = queryService.runPreviewAs(step.getQueryId(), req, actorId, operator.getId());

        Map<String, Object> evidence = new LinkedHashMap<>();
        evidence.put("queryName", query.getName());
        evidence.put("resolvedSql", resp.getResolvedSql());
        if (resp.getInsertId() != null) {
            evidence.put("insertId", resp.getInsertId());
            vars.put(step.getId() + ".insertId", resp.getInsertId());
            String table = parseInsertTable(query.getBody());
            if (table != null) {
                LedgerEntry entry = LedgerEntry.rowDelete(table, ((Number) resp.getInsertId()).longValue());
                entry.datasourceId = query.getDatasourceId();
                ledger.add(entry);
            } else {
                residuals.add("INSERT 查询 " + query.getName() + " 无法解析目标表，insertId=" + resp.getInsertId() + " 的行需手动清理");
            }
        }
        evidence.put("totalCount", resp.getTotalCount());
        evidence.put("firstRow", resp.getRows() == null || resp.getRows().isEmpty() ? null : resp.getRows().get(0));
        result.setEvidence(evidence);
        captureWritePreImage(query.getBody(), params, datasourceId, ledger, residuals);
    }

    private void executeWorkflowStart(TestStep step, Long appId, Long datasourceId, Map<String, Long> actorIds,
                                      User operator, Map<String, Object> vars,
                                      List<LedgerEntry> ledger, List<String> warnings, Set<String> missing,
                                      StepResult result) {
        if (step.getDefinitionId() == null) {
            result.setError("workflow_start 缺少 definitionId（数字类型的流程定义 ID；如果写的是 processId/workflowId 请改为流程定义的数字 ID。"
                    + "示例: {\"id\":\"s2\",\"type\":\"workflow_start\",\"definitionId\":261,\"formData\":{}}）");
            return;
        }
        WorkflowDefinition def = workflowDefinitionRepository.findById(step.getDefinitionId()).orElse(null);
        if (def == null || !appId.equals(def.getApplicationId())) {
            result.setError("流程定义不存在或不属于本应用"); return;
        }
        if (!"PUBLISHED".equals(def.getStatus())) {
            result.setError("流程未发布（当前状态 " + def.getStatus() + "），无法发起"); return;
        }
        Map<String, Object> formData = resolveMap(step.getFormData(), vars, missing);
        if (!missing.isEmpty()) { result.setError("未定义的占位符: " + missing); return; }

        // 触发器目标为 QUERY 的回写查询：解析业务表 + form.data.id 对应行，进入原值恢复名单（决策 2）
        List<String> triggerUpdateTables = extractTriggerUpdateTables(def.getNodes());
        Object businessId = formData.get("id");
        if (!triggerUpdateTables.isEmpty() && businessId instanceof Number idNum) {
            for (String table : triggerUpdateTables) {
                capturePreImage(table, idNum.longValue(), datasourceId, ledger, warnings);
            }
        } else if (!triggerUpdateTables.isEmpty()) {
            warnings.add("流程触发器包含回写查询但 formData 无数字 id 字段——触发器将命中 0 行（链路缺口）");
        }

        WorkflowInstance instance;
        try {
            String formDataJson = objectMapper.writeValueAsString(formData);
            instance = processEngine.startProcess(step.getDefinitionId(), formDataJson,
                    resolveActorId(step, actorIdsOf(vars), operator), actorDisplayName(vars, step, operator));
        } catch (Exception e) {
            result.setError("发起流程失败: " + e.getMessage()); return;
        }
        vars.put(step.getId() + ".instanceId", instance.getId());
        ledger.add(LedgerEntry.instancePurge(instance.getId()));
        Map<String, Object> evidence = new LinkedHashMap<>();
        evidence.put("instanceId", instance.getId());
        evidence.put("status", instance.getStatus());
        result.setEvidence(evidence);
    }

    private void executeTaskComplete(TestStep step, Long appId, Map<String, Long> actorIds, User operator,
                                     Map<String, Object> vars, List<LedgerEntry> ledger, List<String> residuals,
                                     List<String> warnings, Set<String> missing, StepResult result) {
        Long instanceId = resolveInstanceId(step, vars);
        if (instanceId == null) { result.setError("task_complete 无法解析 instanceRef: " + step.getInstanceRef()); return; }
        WorkflowInstance instance = workflowInstanceRepository.findById(instanceId).orElse(null);
        if (instance == null || !appId.equals(instance.getApplicationId())) {
            result.setError("流程实例不存在或不属于本应用"); return;
        }
        String action = step.getAction() == null ? "APPROVE" : step.getAction().trim().toUpperCase();
        if (!"APPROVE".equals(action) && !"REJECT".equals(action)) {
            result.setError("action 必须为 APPROVE 或 REJECT"); return;
        }
        Long actorId = resolveActorId(step, actorIds, operator);
        WorkflowTask task = workflowTaskRepository.findByInstanceIdAndStatus(instanceId, "PENDING").stream()
                .filter(t -> actorId.equals(t.getAssigneeId())
                        || (t.getAllAssigneeIds() != null && List.of(t.getAllAssigneeIds().split(",")).contains(String.valueOf(actorId))))
                .findFirst()
                .orElse(null);
        if (task == null) {
            result.setError("实例 " + instanceId + " 没有指派给用户 " + actorId + " 的待办任务（审批人解析结果与 actors 不符？）");
            return;
        }
        processEngine.completeTask(task.getId(), action, step.getComment() == null ? "" : step.getComment(), actorId, actorDisplayName(vars, step, operator));
        Map<String, Object> evidence = new LinkedHashMap<>();
        evidence.put("taskId", task.getId());
        evidence.put("nodeId", task.getNodeId());
        result.setEvidence(evidence);
    }

    private void executeWaitOutbox(TestStep step, Map<String, Object> vars, long deadline, StepResult result) {
        Long instanceId = resolveInstanceId(step, vars);
        if (instanceId == null) { result.setError("wait_outbox 无法解析 instanceRef: " + step.getInstanceRef()); return; }
        int timeoutSeconds = step.getTimeoutSeconds() == null ? DEFAULT_WAIT_SECONDS : Math.min(step.getTimeoutSeconds(), MAX_WAIT_SECONDS);
        long stepDeadline = Math.min(System.currentTimeMillis() + timeoutSeconds * 1000L, deadline);
        List<WorkflowTriggerOutbox> rows = List.of();
        while (System.currentTimeMillis() <= stepDeadline) {
            rows = outboxRepository.findByInstanceIdOrderByIdAsc(instanceId);
            boolean allTerminal = rows.stream().allMatch(r -> !"PENDING".equals(r.getStatus()));
            if (allTerminal) break;
            try { Thread.sleep(WAIT_POLL_INTERVAL_MS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
        }
        rows = outboxRepository.findByInstanceIdOrderByIdAsc(instanceId);
        List<Map<String, Object>> triggerEvidence = new ArrayList<>();
        boolean hasDead = false;
        boolean hasPending = false;
        for (WorkflowTriggerOutbox r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("triggerId", r.getTriggerId());
            m.put("targetRef", r.getTargetRef());
            m.put("status", r.getStatus());
            m.put("attempts", r.getAttempts());
            triggerEvidence.add(m);
            if ("DEAD".equals(r.getStatus())) hasDead = true;
            if ("PENDING".equals(r.getStatus())) hasPending = true;
        }
        Map<String, Object> evidence = new LinkedHashMap<>();
        evidence.put("instanceId", instanceId);
        evidence.put("triggers", triggerEvidence);
        result.setEvidence(evidence);
        if (hasDead) result.setError("触发器派发存在死信（DEAD）");
        else if (hasPending) result.setError("超时：仍有触发器处于 PENDING（可能在重试退避）");
    }

    private void executeAssertSql(TestStep step, Long datasourceId, User operator, Map<String, Object> vars,
                                  Set<String> missing, StepResult result) {
        RunQueryResponse resp = runAssertQuery(step, datasourceId, operator, vars, missing, result);
        if (resp == null) return;
        String err = evaluateExpectation(step.getExpect(), resp);
        if (err != null) {
            result.setError(err);
            result.getEvidence().put("resolvedSql", resp.getResolvedSql());
        }
    }

    private void executeCaptureSql(TestStep step, Long datasourceId, User operator, Map<String, Object> vars,
                                   Set<String> missing, StepResult result) {
        if (step.getCaptureVar() == null || step.getCaptureVar().isBlank()) {
            result.setError("capture_sql 缺少 captureVar"); return;
        }
        RunQueryResponse resp = runAssertQuery(step, datasourceId, operator, vars, missing, result);
        if (resp == null) return;
        if (resp.getRows() == null || resp.getRows().isEmpty() || resp.getRows().get(0).isEmpty()) {
            result.setError("capture_sql 无结果行"); return;
        }
        Object value = resp.getRows().get(0).get(0);
        vars.put(step.getCaptureVar(), value);
        result.getEvidence().put("captured", step.getCaptureVar() + "=" + value);
    }

    private RunQueryResponse runAssertQuery(TestStep step, Long datasourceId, User operator,
                                            Map<String, Object> vars, Set<String> missing, StepResult result) {
        if (step.getSql() == null || step.getSql().isBlank()) { result.setError("缺少 sql"); return null; }
        if (step.getExpect() == null && "assert_sql".equals(normalizedType(step))) {
            result.setError("assert_sql 缺少 expect（对象结构: {\"operator\":\"cell_eq|rows_count_eq|cell_contains|is_empty\",\"value\":\"期望值\"}，"
                    + "不是数组；cell_eq 比较结果集首行首列）");
            return null;
        }
        if (!isSelectOnly(step.getSql())) {
            // T4：断言/捕获仅允许单条 SELECT
            result.setError("断言/捕获仅允许单条 SELECT 语句");
            return null;
        }
        String sql = interpolateText(step.getSql(), vars, missing);
        if (!missing.isEmpty()) { result.setError("未定义的占位符: " + missing); return null; }
        RunQueryResponse resp = queryService.executeSql(datasourceId, sql);
        result.getEvidence().put("resolvedSql", resp.getResolvedSql());
        result.getEvidence().put("rows", resp.getRows());
        return resp;
    }

    // ============================================================
    // 写入记账（ledger）与自动清理
    // ============================================================

    /** 记录 UPDATE/DELETE 类查询的目标行，捕获原值供恢复（决策 2） */
    private void captureWritePreImage(String queryBody, Map<String, Object> params, Long datasourceId,
                                      List<LedgerEntry> ledger, List<String> residuals) {
        if (queryBody == null) return;
        String trimmed = queryBody.trim();
        String upper = trimmed.toUpperCase();
        if (!(upper.startsWith("UPDATE ") || upper.startsWith("DELETE "))) return;
        String table = parseWriteTable(trimmed);
        Matcher m = NUMERIC_WHERE_ID.matcher(trimmed);
        Long rowId = null;
        if (m.find()) rowId = Long.parseLong(m.group(1));
        else if (params != null && params.get("id") instanceof Number n) rowId = n.longValue();
        if (table == null || rowId == null) {
            residuals.add("写查询无法定位目标行（表=" + table + "），其影响无法自动恢复");
            return;
        }
        if (upper.startsWith("DELETE ")) {
            // 删除行不可恢复；若该行本就是本运行创建的，ledger 已有对应 DELETE 记录
            residuals.add("DELETE 查询将删除行 " + table + "#" + rowId + "（若为历史数据则不可恢复）");
            return;
        }
        capturePreImage(table, rowId, datasourceId, ledger, residuals);
    }

    private void capturePreImage(String table, Long rowId, Long datasourceId, List<LedgerEntry> ledger, List<String> warnings) {
        if (datasourceId == null) {
            warnings.add("TestSpec 未指定 datasourceId，无法捕获 " + table + "#" + rowId + " 的原值（该行修改将无法自动恢复）");
            return;
        }
        boolean already = ledger.stream().anyMatch(l -> l.kind == LedgerEntry.Kind.VALUE_RESTORE
                && l.table.equalsIgnoreCase(table) && rowId.equals(l.rowId));
        if (already) return; // 保留最早的原值（回到运行前状态）
        try {
            RunQueryResponse resp = queryService.executeSql(datasourceId,
                    "SELECT * FROM " + table + " WHERE id = " + rowId);
            if (resp.getRows() == null || resp.getRows().isEmpty()) return;
            List<String> columns = resp.getColumns();
            List<Object> row = resp.getRows().get(0);
            Map<String, Object> preImage = new LinkedHashMap<>();
            for (int i = 0; i < columns.size(); i++) preImage.put(columns.get(i), row.get(i));
            ledger.add(LedgerEntry.valueRestore(table, rowId, preImage));
        } catch (Exception e) {
            warnings.add("无法捕获 " + table + "#" + rowId + " 的原值: " + e.getMessage());
        }
    }

    /** 从流程定义 JSON 提取"QUERY 目标且 SQL 为 UPDATE"的触发器目标表 */
    List<String> extractTriggerUpdateTables(String nodesJson) {
        Set<String> tables = new LinkedHashSet<>();
        if (nodesJson == null || nodesJson.isBlank()) return List.of();
        try {
            JsonNode root = objectMapper.readTree(nodesJson);
            List<Long> queryRefs = new ArrayList<>();
            for (JsonNode node : root) {
                JsonNode triggers = node.path("data").path("config").path("triggers");
                if (!triggers.isArray()) continue;
                for (JsonNode t : triggers) {
                    JsonNode target = t.path("target");
                    if ("QUERY".equalsIgnoreCase(target.path("type").asText())) {
                        long ref = target.path("ref").asLong();
                        JsonNode mapping = t.path("paramsMapping");
                        boolean mapsBusinessId = false;
                        if (mapping.isArray()) {
                            for (JsonNode mp : mapping) {
                                if ("id".equalsIgnoreCase(mp.path("to").asText())
                                        && "form.data.id".equalsIgnoreCase(mp.path("from").asText())) {
                                    mapsBusinessId = true;
                                }
                            }
                        }
                        if (mapsBusinessId) queryRefs.add(ref);
                    }
                }
            }
            for (Long ref : queryRefs) {
                queryRepository.findById(ref).ifPresent(q -> {
                    String table = parseWriteTable(q.getBody());
                    if (table != null && q.getBody().trim().toUpperCase().startsWith("UPDATE ")) {
                        tables.add(table);
                    }
                });
            }
        } catch (Exception e) {
            log.warn("[self-test] 解析流程触发器失败: {}", e.getMessage());
        }
        return new ArrayList<>(tables);
    }

    private void runCleanup(List<LedgerEntry> ledger, Long datasourceId, TestRunReport report) {
        // 顺序：先恢复被改的行，再删新增行，最后清流程实例
        for (LedgerEntry entry : ledger) {
            if (entry.kind != LedgerEntry.Kind.VALUE_RESTORE) continue;
            try {
                StringBuilder sql = new StringBuilder("UPDATE ").append(entry.table).append(" SET ");
                boolean first = true;
                for (Map.Entry<String, Object> col : entry.preImage.entrySet()) {
                    if ("id".equalsIgnoreCase(col.getKey())) continue;
                    if (!first) sql.append(", ");
                    sql.append(col.getKey()).append(" = ").append(sqlLiteral(col.getValue()));
                    first = false;
                }
                sql.append(" WHERE id = ").append(entry.rowId);
                queryService.executeSqlBatch(datasourceId, sql.toString());
                report.getCleanupLog().add("恢复 " + entry.table + "#" + entry.rowId + " 原值");
            } catch (Exception e) {
                report.getResiduals().add("恢复失败: " + entry.table + "#" + entry.rowId + "（" + e.getMessage() + "）");
            }
        }
        for (LedgerEntry entry : ledger) {
            if (entry.kind != LedgerEntry.Kind.ROW_DELETE) continue;
            try {
                queryService.executeSqlBatch(entry.datasourceId != null ? entry.datasourceId : datasourceId,
                        "DELETE FROM " + entry.table + " WHERE id = " + entry.rowId);
                report.getCleanupLog().add("删除 " + entry.table + "#" + entry.rowId);
            } catch (Exception e) {
                report.getResiduals().add("删除失败: " + entry.table + "#" + entry.rowId + "（" + e.getMessage() + "）");
            }
        }
        for (LedgerEntry entry : ledger) {
            if (entry.kind != LedgerEntry.Kind.INSTANCE_PURGE) continue;
            try {
                cleanupService.purgeInstance(entry.instanceId);
                report.getCleanupLog().add("清除流程实例 " + entry.instanceId + "（含任务/历史/触发器派发记录）");
            } catch (Exception e) {
                report.getResiduals().add("清除流程实例失败: " + entry.instanceId + "（" + e.getMessage() + "）");
            }
        }
    }

    // ============================================================
    // 校验与解析（纯函数，可单测）
    // ============================================================

    private void validateSpec(TestSpec spec) {
        if (spec == null || spec.getSteps() == null || spec.getSteps().isEmpty()) {
            throw new IllegalArgumentException("TestSpec 缺少 steps");
        }
        if (spec.getSteps().size() > MAX_STEPS) {
            throw new IllegalArgumentException("steps 超过上限 " + MAX_STEPS);
        }
        if (spec.getActors() != null && spec.getActors().size() > MAX_ACTORS) {
            throw new IllegalArgumentException("actors 超过上限 " + MAX_ACTORS);
        }
        Set<String> ids = new HashSet<>();
        for (TestStep s : spec.getSteps()) {
            if (s.getId() == null || s.getId().isBlank()) throw new IllegalArgumentException("步骤缺少 id");
            if (!ids.add(s.getId())) throw new IllegalArgumentException("步骤 id 重复: " + s.getId());
        }
        boolean needsDatasource = spec.getSteps().stream().anyMatch(s ->
                "assert_sql".equals(s.getType()) || "capture_sql".equals(s.getType()));
        if (needsDatasource && spec.getDatasourceId() == null) {
            throw new IllegalArgumentException("存在断言/捕获步骤时必须指定 datasourceId");
        }
    }

    private Map<String, Long> resolveActors(TestSpec spec, User operator) {
        Map<String, Long> resolved = new LinkedHashMap<>();
        if (spec.getActors() != null) {
            for (Map.Entry<String, Long> e : spec.getActors().entrySet()) {
                // T3：统一措辞 + 频次限流抑制枚举
                User actor = userRepository.findById(e.getValue())
                        .orElseThrow(() -> new IllegalArgumentException("参与者 " + e.getKey() + " 不可用"));
                resolved.put(e.getKey(), actor.getId());
            }
        }
        resolved.putIfAbsent("owner", operator.getId());
        return resolved;
    }

    private void validateDatasource(Long appId, Long datasourceId) {
        if (datasourceId == null) return;
        Datasource ds = datasourceRepository.findById(datasourceId)
                .orElseThrow(() -> new IllegalArgumentException("数据源不存在: " + datasourceId));
        if (!appId.equals(ds.getOwnerId())) {
            throw new IllegalArgumentException("数据源不属于被测应用（跨应用数据源禁止用于自检）");
        }
    }

    private Long internalDatasourceId() { return null; }

    private Long resolveActorId(TestStep step, Map<String, Long> actorIds, User operator) {
        if (step.getActor() == null) return operator.getId();
        Long id = actorIds.get(step.getActor());
        if (id == null) throw new IllegalArgumentException("未知 actor: " + step.getActor());
        return id;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Long> actorIdsOf(Map<String, Object> vars) {
        Map<String, Long> ids = new HashMap<>();
        for (Map.Entry<String, Object> e : vars.entrySet()) {
            if (e.getKey().startsWith("actors.") && e.getValue() instanceof Number n) {
                ids.put(e.getKey().substring("actors.".length()), n.longValue());
            }
        }
        return ids;
    }

    private String actorDisplayName(Map<String, Object> vars, TestStep step, User operator) {
        Long actorId = resolveActorId(step, actorIdsOf(vars), operator);
        return userRepository.findById(actorId)
                .map(u -> u.getName() != null ? u.getName() : u.getAccount())
                .orElse("user-" + actorId);
    }

    private Long resolveInstanceId(TestStep step, Map<String, Object> vars) {
        if (step.getInstanceRef() == null) return null;
        String ref = step.getInstanceRef().trim()
                .replaceAll("^\\$\\{", "").replaceAll("}$", "").trim();
        Object v = vars.get(ref);
        if (v instanceof Number n) return n.longValue();
        return null;
    }

    private String normalizedType(TestStep step) {
        return step.getType() == null ? "" : step.getType().trim().toLowerCase();
    }

    private StepResult newStepResult(TestStep step, Long actorId) {
        StepResult r = new StepResult();
        r.setId(step.getId());
        r.setType(step.getType());
        r.setActorId(actorId);
        r.setEvidence(new LinkedHashMap<>());
        return r;
    }

    private boolean acquireRunQuota(Long userId) {
        long now = System.currentTimeMillis();
        Deque<Long> times = userRunTimes.computeIfAbsent(userId, k -> new ArrayDeque<>());
        synchronized (times) {
            while (!times.isEmpty() && now - times.peekFirst() > 3600_000) times.pollFirst();
            if (times.size() >= MAX_RUNS_PER_USER_PER_HOUR) return false;
            times.addLast(now);
            return true;
        }
    }

    // ── 静态纯函数（单测覆盖） ──

    static Map<String, Object> resolveMap(Map<String, Object> input, Map<String, Object> vars, Set<String> missing) {
        if (input == null) return null;
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : input.entrySet()) {
            out.put(e.getKey(), resolveValue(e.getValue(), vars, missing));
        }
        return out;
    }

    static Object resolveValue(Object value, Map<String, Object> vars, Set<String> missing) {
        if (value instanceof String s) {
            Matcher m = REF_PATTERN.matcher(s.trim());
            if (m.matches()) {
                Object v = vars.get(m.group(1).trim());
                if (v == null) missing.add(m.group(1).trim());
                return v;
            }
            return interpolateText(s, vars, missing);
        }
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> out = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : map.entrySet()) {
                out.put(String.valueOf(e.getKey()), resolveValue(e.getValue(), vars, missing));
            }
            return out;
        }
        if (value instanceof List<?> list) {
            List<Object> out = new ArrayList<>();
            for (Object item : list) out.add(resolveValue(item, vars, missing));
            return out;
        }
        return value;
    }

    static String interpolateText(String template, Map<String, Object> vars, Set<String> missing) {
        Matcher m = REF_PATTERN.matcher(template);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String path = m.group(1).trim();
            Object v = vars.get(path);
            if (v == null) {
                missing.add(path);
                m.appendReplacement(sb, Matcher.quoteReplacement(m.group(0)));
            } else {
                m.appendReplacement(sb, Matcher.quoteReplacement(String.valueOf(v)));
            }
        }
        m.appendTail(sb);
        return sb.toString();
    }

    /** T4：仅允许单条 SELECT/WITH 语句（容忍尾分号） */
    static boolean isSelectOnly(String sql) {
        String t = sql.trim().replaceAll(";+\\s*$", "");
        String upper = t.toUpperCase();
        if (!(upper.startsWith("SELECT ") || upper.startsWith("WITH "))) return false;
        // 去掉字符串字面量后再检查分号，避免值内分号误判
        String noLiterals = t.replaceAll("'([^']|'')*'", "''").replaceAll("\"([^\"]|\"\")*\"", "\"\"");
        return !noLiterals.contains(";");
    }

    static String parseInsertTable(String sql) {
        if (sql == null) return null;
        Matcher m = Pattern.compile("(?i)^\\s*INSERT\\s+INTO\\s+[`\"']?([A-Za-z_][A-Za-z0-9_$]*)").matcher(sql.trim());
        return m.find() ? m.group(1) : null;
    }

    static String parseWriteTable(String sql) {
        if (sql == null) return null;
        String t = sql.trim();
        Matcher update = Pattern.compile("(?i)^\\s*UPDATE\\s+[`\"']?([A-Za-z_][A-Za-z0-9_$]*)").matcher(t);
        if (update.find()) return update.group(1);
        Matcher delete = Pattern.compile("(?i)^\\s*DELETE\\s+FROM\\s+[`\"']?([A-Za-z_][A-Za-z0-9_$]*)").matcher(t);
        if (delete.find()) return delete.group(1);
        return null;
    }

    static String sqlLiteral(Object v) {
        if (v == null) return "NULL";
        if (v instanceof Number || v instanceof Boolean) return String.valueOf(v);
        return "'" + String.valueOf(v).replace("'", "''") + "'";
    }

    static String evaluateExpectation(Expectation expect, RunQueryResponse resp) {
        String op = expect.getOperator() == null ? "" : expect.getOperator().trim();
        String expected = expect.getValue();
        return switch (op) {
            case "cell_eq" -> {
                if (resp.getRows() == null || resp.getRows().isEmpty() || resp.getRows().get(0).isEmpty()) {
                    yield "无结果行，无法比较（期望 " + expected + "）";
                }
                String actual = String.valueOf(resp.getRows().get(0).get(0));
                if (!valuesEqual(actual, expected)) {
                    yield "断言失败：期望 " + expected + "，实际 " + actual;
                }
                yield null;
            }
            case "rows_count_eq" -> {
                int actual = resp.getRows() == null ? 0 : resp.getRows().size();
                int expectedN;
                try { expectedN = Integer.parseInt(expected == null ? "" : expected.trim()); }
                catch (NumberFormatException e) { yield "rows_count_eq 的期望值不是数字: " + expected; }
                yield actual == expectedN ? null : "断言失败：期望 " + expectedN + " 行，实际 " + actual + " 行";
            }
            case "cell_contains" -> {
                if (resp.getRows() == null || resp.getRows().isEmpty()) yield "无结果行";
                String actual = String.valueOf(resp.getRows().get(0).get(0));
                yield actual.contains(expected == null ? "" : expected) ? null
                        : "断言失败：期望包含 " + expected + "，实际 " + actual;
            }
            case "is_empty" -> {
                boolean empty = resp.getRows() == null || resp.getRows().isEmpty()
                        || resp.getRows().get(0).get(0) == null
                        || String.valueOf(resp.getRows().get(0).get(0)).isEmpty();
                yield empty ? null : "断言失败：期望为空，实际 " + resp.getRows().get(0).get(0);
            }
            default -> "未知断言操作符: " + op + "（允许: cell_eq|rows_count_eq|cell_contains|is_empty，value 为字符串）";
        };
    }

    private static boolean valuesEqual(String a, String b) {
        if (a.equals(b)) return true;
        try {
            return Double.compare(Double.parseDouble(a), Double.parseDouble(b)) == 0;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    /** 写入记账条目 */
    static final class LedgerEntry {
        enum Kind { ROW_DELETE, VALUE_RESTORE, INSTANCE_PURGE }
        final Kind kind;
        final String table;
        final Long rowId;
        final Map<String, Object> preImage;
        final Long instanceId;
        Long datasourceId;

        private LedgerEntry(Kind kind, String table, Long rowId, Map<String, Object> preImage, Long instanceId) {
            this.kind = kind;
            this.table = table;
            this.rowId = rowId;
            this.preImage = preImage;
            this.instanceId = instanceId;
        }

        static LedgerEntry rowDelete(String table, Long rowId) { return new LedgerEntry(Kind.ROW_DELETE, table, rowId, null, null); }
        static LedgerEntry valueRestore(String table, Long rowId, Map<String, Object> preImage) { return new LedgerEntry(Kind.VALUE_RESTORE, table, rowId, preImage, null); }
        static LedgerEntry instancePurge(Long instanceId) { return new LedgerEntry(Kind.INSTANCE_PURGE, null, null, null, instanceId); }
    }
}
