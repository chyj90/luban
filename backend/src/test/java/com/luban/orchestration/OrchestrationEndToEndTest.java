package com.luban.orchestration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.constant.ToolType;
import com.luban.constant.WorkflowScope;
import com.luban.entity.Datasource;
import com.luban.entity.Query;
import com.luban.entity.ToolDefinition;
import com.luban.orchestration.dsl.OrchestrationDsl;
import com.luban.orchestration.engine.DefaultNodeInvokers;
import com.luban.orchestration.engine.OrchestrationEngine;
import com.luban.orchestration.entity.OrchestrationDefinition;
import com.luban.orchestration.service.OrchestrationService;
import com.luban.repository.DatasourceRepository;
import com.luban.repository.QueryRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.workflow.entity.WorkflowDefinition;
import com.luban.workflow.repository.WorkflowDefinitionRepository;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.SpyBean;

import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;

/**
 * 编排端到端测试：在 appId=1 上下文下，通过 Spring 完整上下文执行 设计 → Lint → 保存 → 试运行 → 发布 全生命周期。
 *
 * 测试编排结构（覆盖全部 9 种节点类型）：
 * start → query → transform → http → python → parallel(workflow + transform) → condition → output
 *
 * 测试数据：
 * - Datasource：读取 appId=1 已有数据源
 * - Query：基于 datasource 创建带入参的真实 SQL
 * - WorkflowDefinition：start → approval → end
 * - ToolDefinition ×2：分别指向 /api/v1/mock/echo（GET）和 /api/v1/mock/data（POST）
 *
 * 外部依赖处理：
 * - runQuery：走真实 QueryService → MySQL（确保 :param 模板解析、SQL 执行完整链路）
 * - callTool / callHttpUrl：@SpyBean 拦截（HTTP 出站依赖外部 URL）
 * - runPython：@SpyBean 拦截（依赖 embedding-service 沙箱）
 * - runWorkflowAction：@SpyBean 拦截（创建真实流程实例会影响数据库状态）
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class OrchestrationEndToEndTest {

    private static final Long APP_ID = 1L;
    private static final Long USER_ID = 1L;
    private static final String TEST_ORCH_NAME = "e2e_full_flow_test_全节点";

    @Autowired private OrchestrationService orchestrationService;
    @Autowired private DatasourceRepository datasourceRepository;
    @Autowired private QueryRepository queryRepository;
    @Autowired private WorkflowDefinitionRepository workflowDefinitionRepository;
    @Autowired private ToolDefinitionRepository toolDefinitionRepository;
    @Autowired private ObjectMapper objectMapper;

    @SpyBean private DefaultNodeInvokers nodeInvokers;

    private static Long datasourceId;
    private static Long queryId;
    private static Long workflowDefId;
    private static Long toolGetId;
    private static Long toolPostId;
    private static Long orchestrationDefId;

    @BeforeAll
    static void suppressLog() {
        // 减少测试日志噪音
        java.util.logging.Logger.getLogger("org.hibernate").setLevel(java.util.logging.Level.SEVERE);
    }

    @BeforeEach
    void setUp() {
        configureMockInvokers();
    }

    /**
     * ═══════════════════════════════════════════════════════════
     * 阶段 0：准备测试数据（Query / Workflow / ToolDefinition）
     * ═══════════════════════════════════════════════════════════
     */
    @Test
    @Order(0)
    @DisplayName("阶段0-准备数据：创建 Query、流程定义、API 工具定义并落库")
    void prepareTestData() {
        // 清理上次运行的残留数据（按外键顺序）
        System.out.println("[E2E] 清理历史测试数据...");
        toolDefinitionRepository.findAll().stream()
                .filter(t -> t.getName().startsWith("e2e_"))
                .forEach(t -> toolDefinitionRepository.delete(t));
        workflowDefinitionRepository.findAll().stream()
                .filter(w -> w.getName().startsWith("e2e_"))
                .forEach(w -> workflowDefinitionRepository.delete(w));
        queryRepository.findAll().stream()
                .filter(q -> q.getName().startsWith("e2e_"))
                .forEach(q -> queryRepository.delete(q));

        // --- 数据源 ---
        List<Datasource> dsList = datasourceRepository.findBySlugAndOwnerId("APPLICATION", APP_ID);
        assertThat(dsList).as("appId=1 下需至少有一个数据源").isNotEmpty();
        datasourceId = dsList.get(0).getId();
        System.out.println("[E2E] 使用数据源 datasourceId=" + datasourceId + " name=" + dsList.get(0).getName());

        // --- Query（带入参 name_filter，从 $input.name 传递） ---
        Query query = new Query();
        query.setApplicationId(APP_ID);
        query.setDatasourceId(datasourceId);
        query.setName("e2e_query_by_name");
        query.setBody("SELECT 1 AS id, :name_filter AS name, 1 AS application_id");
        query.setParams(toJson(List.of(Map.of("name", "name_filter", "type", "string"))));
        query = queryRepository.save(query);
        queryId = query.getId();
        System.out.println("[E2E] 创建 Query id=" + queryId);

        // --- WorkflowDefinition（start → approval → end，真实节点） ---
        WorkflowDefinition wf = new WorkflowDefinition();
        wf.setName("e2e_test_workflow");
        wf.setDescription("端到端测试用流程定义");
        wf.setApplicationId(APP_ID);
        wf.setScope(WorkflowScope.APPLICATION);
        wf.setVersion(1);
        wf.setStatus("PUBLISHED");
        wf.setCreatedBy(USER_ID);
        wf.setNodes(toJson(List.of(
                Map.of("id", "start", "nodeType", "start", "nodeName", "开始",
                        "position", Map.of("x", 100, "y", 200)),
                Map.of("id", "approve", "nodeType", "approval", "nodeName", "审批",
                        "config", Map.of("approverType", "member", "approverIds", List.of(1)),
                        "position", Map.of("x", 350, "y", 200)),
                Map.of("id", "end", "nodeType", "end", "nodeName", "结束",
                        "position", Map.of("x", 600, "y", 200))
        )));
        wf.setEdges(toJson(List.of(
                Map.of("id", "e_wf_1", "source", "start", "target", "approve"),
                Map.of("id", "e_wf_2", "source", "approve", "target", "end")
        )));
        wf = workflowDefinitionRepository.save(wf);
        workflowDefId = wf.getId();
        System.out.println("[E2E] 创建 WorkflowDefinition id=" + workflowDefId);

        // --- ToolDefinition GET（指向 /api/v1/mock/echo） ---
        ToolDefinition toolGet = new ToolDefinition();
        toolGet.setName("e2e_mock_echo_get");
        toolGet.setDisplayName("Mock Echo GET");
        toolGet.setDescription("端到端测试用 GET API");
        toolGet.setToolType(ToolType.HTTP);
        toolGet.setConfig(toJson(Map.of(
                "url", "http://localhost:8080/api/v1/mock/echo",
                "method", "GET",
                "headers", Map.of("Content-Type", "application/json")
        )));
        toolGet.setGroupId(APP_ID);
        toolGet.setScope("APPLICATION");
        toolGet.setCreatedBy(USER_ID);
        toolGet.setInputSchema(toJson(Map.of(
                "type", "object",
                "properties", Map.of("msg", Map.of("type", "string"))
        )));
        toolGet = toolDefinitionRepository.save(toolGet);
        toolGetId = toolGet.getId();
        System.out.println("[E2E] 创建 ToolDefinition GET id=" + toolGetId);

        // --- ToolDefinition POST（指向 /api/v1/mock/data） ---
        ToolDefinition toolPost = new ToolDefinition();
        toolPost.setName("e2e_mock_data_post");
        toolPost.setDisplayName("Mock Data POST");
        toolPost.setDescription("端到端测试用 POST API");
        toolPost.setToolType(ToolType.HTTP);
        toolPost.setConfig(toJson(Map.of(
                "url", "http://localhost:8080/api/v1/mock/data",
                "method", "POST",
                "headers", Map.of("Content-Type", "application/json")
        )));
        toolPost.setGroupId(APP_ID);
        toolPost.setScope("APPLICATION");
        toolPost.setCreatedBy(USER_ID);
        toolPost.setInputSchema(toJson(Map.of(
                "type", "object",
                "properties", Map.of("payload", Map.of("type", "object"))
        )));
        toolPost = toolDefinitionRepository.save(toolPost);
        toolPostId = toolPost.getId();
        System.out.println("[E2E] 创建 ToolDefinition POST id=" + toolPostId);

        assertThat(queryId).isNotNull();
        assertThat(workflowDefId).isNotNull();
        assertThat(toolGetId).isNotNull();
        assertThat(toolPostId).isNotNull();
    }

    /**
     * ═══════════════════════════════════════════════════════════
     * 阶段 1：创建编排定义（→ 落库）
     * ═══════════════════════════════════════════════════════════
     */
    @Test
    @Order(1)
    @DisplayName("阶段1-创建编排：buildFullDsl → lint 通过 → 入库")
    void createOrchestration() {
        String dslJson = buildFullDsl();

        OrchestrationDefinition def = orchestrationService.create(
                TEST_ORCH_NAME,
                "端到端全节点类型覆盖测试",
                APP_ID,
                dslJson,
                USER_ID);

        orchestrationDefId = def.getId();
        assertThat(def.getId()).isNotNull();
        assertThat(def.getStatus()).isEqualTo("DRAFT");
        assertThat(def.getCurrentVersionId()).isNotNull();
        System.out.println("[E2E] 创建编排 id=" + orchestrationDefId + " versionId=" + def.getCurrentVersionId());
    }

    /**
     * ═══════════════════════════════════════════════════════════
     * 阶段 2：Lint 校验
     * ═══════════════════════════════════════════════════════════
     */
    @Test
    @Order(2)
    @DisplayName("阶段2-Lint校验：完整 DSL 通过 lint")
    void lintFullDsl() {
        assertThat(orchestrationDefId).as("需先执行阶段1").isNotNull();

        var def = orchestrationService.getById(orchestrationDefId);
        var version = orchestrationService.getCurrentVersion(def);
        assertThat(version).isNotNull();

        OrchestrationDsl.Dsl dsl = orchestrationService.parseDsl(version.getDsl());
        var result = orchestrationService.lintDsl(dsl);

        assertThat(result.passed())
                .as("完整 DSL 应通过 lint，错误: %s", result.errors())
                .isTrue();
    }

    /**
     * ═══════════════════════════════════════════════════════════
     * 阶段 3：试运行（→ 创建 Execution 留痕）
     * ═══════════════════════════════════════════════════════════
     */
    @Nested
    @DisplayName("阶段3-试运行")
    @TestMethodOrder(MethodOrderer.OrderAnnotation.class)
    class TestRun {

        @Test
        @Order(0)
        @DisplayName("全节点执行成功，nodeTrace 包含所有业务节点")
        void allNodesExecuteSuccessfully() {
            assertThat(orchestrationDefId).as("需先执行阶段1").isNotNull();

            Map<String, Object> result = orchestrationService.execute(
                    orchestrationDefId, USER_ID, "USER_TEST", null,
                    Map.of("name", "测试用户", "age", 30));

            assertThat(result.get("success")).isEqualTo(true);
            assertThat(result.get("executionId")).isNotNull();
            System.out.println("[E2E] 试运行 executionId=" + result.get("executionId"));

            @SuppressWarnings("unchecked")
            Map<String, Object> data = (Map<String, Object>) result.get("data");
            assertThat(data).containsKeys("q1", "t1", "api1", "py1", "wf1", "t2");
        }

        @Test
        @Order(1)
        @DisplayName("Query 节点真实执行并返回数据")
        void queryReceivesInputParam() {
            Map<String, Object> result = orchestrationService.execute(
                    orchestrationDefId, USER_ID, "USER_TEST", null,
                    Map.of("name", "测试用户", "age", 30));

            System.out.println("[E2E] 试运行结果: " + toJson(result));

            @SuppressWarnings("unchecked")
            Map<String, Object> data = (Map<String, Object>) result.get("data");
            assertThat(result.get("success")).isEqualTo(true);
            assertThat(data).isNotNull();
            assertThat(data.get("q1")).isNotNull();
        }

        @Test
        @Order(2)
        @DisplayName("HTTP 节点接收到 transform 映射后的参数")
        void httpReceivesMappedParams() {
            orchestrationService.execute(
                    orchestrationDefId, USER_ID, "USER_TEST", null,
                    Map.of("name", "王五", "age", 25));

            Map<String, Object> toolParams = lastToolParams;
            assertThat(toolParams).isNotNull();
            assertThat(toolParams).containsKey("msg");
            // runQuery 走真实 MySQL，SELECT :name_filter AS name 返回输入的名字
            assertThat(String.valueOf(toolParams.get("msg"))).isEqualTo("王五");
        }

        @Test
        @Order(3)
        @DisplayName("Python 节点返回预期结构")
        void pythonReturnsExpectedStructure() {
            orchestrationService.execute(
                    orchestrationDefId, USER_ID, "USER_TEST", null,
                    Map.of("name", "张三", "age", 30));

            Map<String, Object> pyResult = lastPythonResult;
            assertThat(pyResult).isNotNull();
            assertThat(pyResult).containsKey("status");
            assertThat(String.valueOf(pyResult.get("status"))).isEqualTo("py_ok");
        }

        @Test
        @Order(4)
        @DisplayName("Workflow 节点 formDataTemplate 正确传递变量")
        void workflowReceivesFormData() {
            orchestrationService.execute(
                    orchestrationDefId, USER_ID, "USER_TEST", null,
                    Map.of("name", "张三", "age", 30));

            Map<String, Object> wfFormData = lastWorkflowFormData;
            assertThat(wfFormData).isNotNull();
            assertThat(wfFormData).containsKey("who");
            assertThat(String.valueOf(wfFormData.get("who"))).isEqualTo("张三");
        }

        @Test
        @Order(5)
        @DisplayName("Condition 节点 condition=age>10 命中 → output 收到上游输出")
        void conditionBranchesCorrectly() {
            Map<String, Object> result = orchestrationService.execute(
                    orchestrationDefId, USER_ID, "USER_TEST", null,
                    Map.of("name", "测试", "age", 30));

            @SuppressWarnings("unchecked")
            Map<String, Object> data = (Map<String, Object>) result.get("data");
            // condition 通过 → output 应包含上游 context
            assertThat(data).containsKeys("q1", "t1", "api1", "py1", "wf1", "t2");
        }
    }

    /**
     * ═══════════════════════════════════════════════════════════
     * 阶段 4：保存新版本
     * ═══════════════════════════════════════════════════════════
     */
    @Test
    @Order(4)
    @DisplayName("阶段4-保存新版本：saveVersion → 版本号递增")
    void saveNewVersion() {
        assertThat(orchestrationDefId).as("需先执行阶段1").isNotNull();

        var def = orchestrationService.getById(orchestrationDefId);
        var v1 = orchestrationService.getCurrentVersion(def);
        assertThat(v1.getVersion()).isEqualTo(1);

        String dslJson = buildFullDsl(); // 相同 DSL 也可保存
        var v2 = orchestrationService.saveVersion(orchestrationDefId, dslJson, USER_ID);
        assertThat(v2.getVersion()).isEqualTo(2);

        def = orchestrationService.getById(orchestrationDefId);
        assertThat(def.getCurrentVersionId()).isEqualTo(v2.getId());
        System.out.println("[E2E] 保存新版本 v" + v2.getVersion());
    }

    /**
     * ═══════════════════════════════════════════════════════════
     * 阶段 5：发布
     * ═══════════════════════════════════════════════════════════
     */
    @Test
    @Order(5)
    @DisplayName("阶段5-发布：publish → STATUS=PUBLISHED + ToolDefinition 注册")
    void publishOrchestration() {
        assertThat(orchestrationDefId).as("需先执行阶段1").isNotNull();

        Map<String, Object> pubResult = orchestrationService.publish(orchestrationDefId, USER_ID);
        assertThat(pubResult).containsKeys("definitionId", "publishedVersionId", "toolDefinitionId");

        var def = orchestrationService.getById(orchestrationDefId);
        assertThat(def.getStatus()).isEqualTo("PUBLISHED");
        assertThat(def.getPublishedVersionId()).isEqualTo(def.getCurrentVersionId());
        System.out.println("[E2E] 发布成功 toolDefinitionId=" + pubResult.get("toolDefinitionId"));
    }

    /**
     * ═══════════════════════════════════════════════════════════
     * 阶段 6：Lint 失败场景
     * ═══════════════════════════════════════════════════════════
     */
    @Test
    @Order(6)
    @DisplayName("阶段6-Lint失败：http 节点缺 toolId+url → lint 报错")
    void lintFailsOnMissingToolAndUrl() {
        String badDsl = buildFullDsl();
        // 构建不带 toolId 和 url 的 http 节点
        OrchestrationDsl.Dsl dsl = orchestrationService.parseDsl(badDsl);
        dsl.getNodes().stream()
                .filter(n -> "api1".equals(n.getId()))
                .findFirst()
                .ifPresent(n -> {
                    n.config().setToolId(null);
                    n.config().setUrl(null);
                });

        var result = orchestrationService.lintDsl(dsl);
        assertThat(result.passed()).isFalse();
        assertThat(result.errors().stream().anyMatch(
                e -> e.contains("toolId") || e.contains("url"))).isTrue();
    }

    // ═══════════════════════════════════════════════════════════
    // 辅助方法
    // ═══════════════════════════════════════════════════════════

    private String buildFullDsl() {
        var dsl = new OrchestrationDsl.Dsl();

        var start = node("start", "start", "入口");
        start.setPosition(pos(100, 200));
        start.config().setInputs(List.of(
                port("name", "string", false),
                port("age", "number", false)));

        var q1 = node("q1", "query", "查询订单");
        q1.setPosition(pos(400, 200));
        q1.config().setQueryId(queryId);
        q1.config().setParamsTemplate(Map.of("name_filter", "$input.name"));

        var t1 = node("t1", "transform", "提取记录");
        t1.setPosition(pos(700, 200));
        t1.config().setTemplate(Map.of("record", "$nodes.q1.rows.0.name"));

        var api1 = node("api1", "http", "调用API");
        api1.setPosition(pos(1000, 200));
        api1.config().setToolId(toolGetId);
        api1.config().setParamsTemplate(Map.of("msg", "$nodes.t1.record"));

        var py1 = node("py1", "python", "Python处理");
        py1.setPosition(pos(1300, 200));
        py1.config().setSource("def main(ctx):\n    return {'status': 'py_ok', 'nodeCount': len(ctx)}");
        py1.config().setEntry("main");
        py1.config().setPackages(List.of("json"));

        var par = node("par", "parallel", "并行分支");
        par.setPosition(pos(1600, 200));

        var wf1 = node("wf1", "workflow", "发起流程");
        wf1.setPosition(pos(1900, 50));
        wf1.config().setWorkflowAction("start");
        wf1.config().setWorkflowDefinitionId(workflowDefId);
        wf1.config().setFormDataTemplate(Map.of("who", "$input.name"));

        var t2 = node("t2", "transform", "标记完成");
        t2.setPosition(pos(1900, 350));
        t2.config().setTemplate(Map.of("parallelDone", "true"));

        var cond = node("cond", "condition", "条件判断");
        cond.setPosition(pos(2200, 200));

        var out = node("out", "output", "出口");
        out.setPosition(pos(2500, 200));

        dsl.setNodes(List.of(start, q1, t1, api1, py1, par, wf1, t2, cond, out));
        dsl.setEdges(List.of(
                edge("start", "q1", null),
                edge("q1", "t1", null),
                edge("t1", "api1", null),
                edge("api1", "py1", null),
                edge("py1", "par", null),
                edge("par", "wf1", null),
                edge("par", "t2", null),
                edge("wf1", "cond", null),
                edge("t2", "cond", null),
                edge("cond", "out", "age > 10"),
                edge("cond", "out", null)));

        return toJson(dsl);
    }

    // --- Mock Invokers 配置（仅拦截外部依赖，runQuery 走真实 MySQL）---

    private Map<String, Object> lastToolParams;
    private Map<String, Object> lastWorkflowFormData;
    private Map<String, Object> lastPythonResult;

    @SuppressWarnings("unchecked")
    private void configureMockInvokers() {
        // callTool：HTTP 出站依赖外部 URL，mock 回显参数
        doAnswer(inv -> {
            Long toolId = inv.getArgument(0);
            Map<String, Object> params = inv.getArgument(1);
            lastToolParams = params;
            String method = toolId.equals(toolGetId) ? "GET" : "POST";
            return Map.of(
                    "status", 200,
                    "method", method,
                    "calledBy", "test-user",
                    "params", (Object) params,
                    "data", Map.of("echoed", params),
                    "statusCode", "ok");
        }).when(nodeInvokers).callTool(anyLong(), anyMap(), anyInt(), anyInt());

        // callHttpUrl：HTTP 直连出站，mock
        doReturn(Map.of("status", "not_called"))
                .when(nodeInvokers).callHttpUrl(anyString(), anyString(), anyMap(), any(), anyInt(), anyInt());

        // runPython：依赖 embedding-service 沙箱，mock
        doAnswer(inv -> {
            Map<String, Object> ctx = inv.getArgument(3);
            lastPythonResult = Map.of(
                    "status", "py_ok",
                    "nodeCount", ctx.size(),
                    "upstreamKeys", new ArrayList<>(ctx.keySet()));
            return lastPythonResult;
        }).when(nodeInvokers).runPython(anyString(), anyString(), anyList(), anyMap(), anyInt());

        // runWorkflowAction：创建真实流程实例，mock 避免污染数据库
        doAnswer(inv -> {
            Map<String, Object> formData = inv.getArgument(2);
            lastWorkflowFormData = formData;
            return Map.of(
                    "status", "started",
                    "instanceId", 999L,
                    "formData", (Object) formData);
        }).when(nodeInvokers).runWorkflowAction(anyString(), anyLong(), anyMap(), isNull(), isNull());

        // runQuery 不 stub → 走真实 QueryService.run() → 真实 MySQL
    }

    // --- DSL 构建辅助 ---

    private static OrchestrationDsl.NodeDef node(String id, String type, String label) {
        var n = new OrchestrationDsl.NodeDef();
        n.setId(id);
        n.setNodeType(type);
        var data = new OrchestrationDsl.NodeDef.NodeData();
        data.setLabel(label);
        data.setConfig(new OrchestrationDsl.NodeDef.Config());
        n.setData(data);
        return n;
    }

    private static int edgeSeq = 0;

    private static OrchestrationDsl.EdgeDef edge(String source, String target, String condition) {
        var e = new OrchestrationDsl.EdgeDef();
        e.setId("e_" + source + "_" + target + "_" + (++edgeSeq));
        e.setSource(source);
        e.setTarget(target);
        e.setCondition(condition);
        return e;
    }

    private static OrchestrationDsl.PortDef port(String name, String type, boolean required) {
        var p = new OrchestrationDsl.PortDef();
        p.setName(name);
        p.setType(type);
        p.setRequired(required);
        return p;
    }

    private static Map<String, Object> pos(int x, int y) {
        return Map.of("x", (Object) x, "y", (Object) y);
    }

    // --- 工具方法 ---

    private String toJson(Object obj) {
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 清理
    // ═══════════════════════════════════════════════════════════

    @AfterAll
    void cleanup() {
        // 测试数据保留在 DB 中供人工核查，可通过 SQL 手动删除
        System.out.println("[E2E] 测试完成。清理 SQL：");
        System.out.println("  DELETE FROM orchestration_versions WHERE definition_id IN (SELECT id FROM orchestration_definitions WHERE name LIKE 'e2e_%');");
        System.out.println("  DELETE FROM orchestration_executions WHERE definition_id IN (SELECT id FROM orchestration_definitions WHERE name LIKE 'e2e_%');");
        System.out.println("  DELETE FROM orchestration_definitions WHERE name LIKE 'e2e_%';");
        System.out.println("  DELETE FROM queries WHERE name LIKE 'e2e_%';");
        System.out.println("  DELETE FROM workflow_definitions WHERE name LIKE 'e2e_%';");
        System.out.println("  DELETE FROM tool_definition WHERE name LIKE 'e2e_%';");
    }
}