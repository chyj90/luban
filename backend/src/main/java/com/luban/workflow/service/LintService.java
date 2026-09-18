package com.luban.workflow.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.repository.UserDeptRepository;
import com.luban.workflow.entity.FormDefinition;
import com.luban.workflow.entity.FormWorkflowBinding;
import com.luban.workflow.entity.WorkflowDefinition;
import com.luban.workflow.repository.DepartmentRepository;
import com.luban.workflow.repository.FormDefinitionRepository;
import com.luban.workflow.repository.FormWorkflowBindingRepository;
import com.luban.workflow.repository.WorkflowDefinitionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
@RequiredArgsConstructor
public class LintService {

    private final ObjectMapper objectMapper;
    private final WorkflowDefinitionRepository workflowDefinitionRepository;
    private final FormWorkflowBindingRepository formWorkflowBindingRepository;
    private final FormDefinitionRepository formDefinitionRepository;
    private final UserDeptRepository userDeptRepository;
    private final DepartmentRepository departmentRepository;

    /** 触发器合法事件全集（与引擎 ProcessService 的发布校验一致） */
    private static final Set<String> VALID_TRIGGER_EVENTS = Set.of(
            "NODE_ENTERED", "APPROVED", "REJECTED", "INSTANCE_COMPLETED", "INSTANCE_REJECTED");

    private static final List<String> REQUIRED_HTML_PATTERNS = List.of(
        "id=\"workflow-form\"",
        "class=\"form-field\"",
        "data-field=\"",
        "class=\"form-input\"",
        "class=\"field-error\"",
        "class=\"form-label\"",
        "class=\"required-mark\""
    );

    private static final List<String> REQUIRED_CSS_PATTERNS = List.of(
        "#workflow-form",
        ".form-field",
        ".form-input",
        ".field-error",
        ".readonly",
        ".hidden",
        "@media"
    );

    private static final List<String> FORBIDDEN_JS_PATTERNS = List.of(
        "=>",
        "const ",
        "let ",
        "addEventListener",
        "import ",
        "export ",
        "fetch(",
        "axios.",
        "console.log"
    );

    private static final List<String> REQUIRED_JS_PATTERNS = List.of(
        "function getFormData",
        "function validateForm",
        "function submitForm"
    );

    private static final Set<String> VALID_FIELD_TYPES = Set.of(
        "text", "textarea", "number", "amount", "select", "multi_select",
        "radio", "checkbox", "date", "datetime", "switch", "file", "excel",
        "member", "department", "detail_table", "computed", "reference"
    );

    private static final Set<String> VALID_NODE_TYPES = Set.of(
        "start", "approval", "condition", "parallel", "cc", "sub_process", "end"
    );

    public Map<String, Object> lintFormCode(String html, String css, String js) {
        List<Map<String, Object>> errors = new ArrayList<>();
        List<Map<String, Object>> warnings = new ArrayList<>();

        if (html != null && !html.isEmpty()) {
            lintHtml(html, errors, warnings);
        }
        if (css != null && !css.isEmpty()) {
            lintCss(css, errors, warnings);
        }
        if (js != null && !js.isEmpty()) {
            lintJs(js, errors, warnings);
        }

        return buildResult(errors, warnings);
    }

    private void lintHtml(String html, List<Map<String, Object>> errors, List<Map<String, Object>> warnings) {
        for (String pattern : REQUIRED_HTML_PATTERNS) {
            if (!html.contains(pattern)) {
                errors.add(Map.of("category", "HTML", "message", "缺少必填元素: " + pattern, "severity", "ERROR"));
            }
        }

        Pattern dataFieldPattern = Pattern.compile("data-field=\"([^\"]+)\"");
        Pattern namePattern = Pattern.compile("name=\"([^\"]+)\"");
        Matcher dfMatcher = dataFieldPattern.matcher(html);
        Matcher nMatcher = namePattern.matcher(html);

        Set<String> dataFields = new HashSet<>();
        Set<String> names = new HashSet<>();
        while (dfMatcher.find()) dataFields.add(dfMatcher.group(1));
        while (nMatcher.find()) names.add(nMatcher.group(1));

        for (String df : dataFields) {
            if (!names.contains(df)) {
                warnings.add(Map.of("category", "HTML", "message",
                    "data-field=\"" + df + "\" 缺少对应的 name 属性", "severity", "WARNING"));
            }
        }
    }

    private void lintCss(String css, List<Map<String, Object>> errors, List<Map<String, Object>> warnings) {
        for (String pattern : REQUIRED_CSS_PATTERNS) {
            if (!css.contains(pattern)) {
                warnings.add(Map.of("category", "CSS", "message", "缺少建议样式: " + pattern, "severity", "WARNING"));
            }
        }
    }

    private void lintJs(String js, List<Map<String, Object>> errors, List<Map<String, Object>> warnings) {
        for (String pattern : FORBIDDEN_JS_PATTERNS) {
            if (js.contains(pattern)) {
                errors.add(Map.of("category", "JS", "message", "使用了禁止语法: " + pattern, "severity", "ERROR"));
            }
        }
        for (String pattern : REQUIRED_JS_PATTERNS) {
            if (!js.contains(pattern)) {
                errors.add(Map.of("category", "JS", "message", "缺少必填函数: " + pattern, "severity", "ERROR"));
            }
        }
    }

    public Map<String, Object> lintFieldSchema(String fieldsJson) {
        List<Map<String, Object>> errors = new ArrayList<>();
        List<Map<String, Object>> warnings = new ArrayList<>();

        try {
            JsonNode fields = objectMapper.readTree(fieldsJson);
            if (!fields.isArray()) {
                errors.add(Map.of("category", "Schema", "message", "fields 必须是数组", "severity", "ERROR"));
                return buildResult(errors, warnings);
            }

            Set<String> keys = new HashSet<>();
            for (JsonNode field : fields) {
                if (!field.has("key")) {
                    errors.add(Map.of("category", "Schema", "message", "字段缺少 key", "severity", "ERROR"));
                } else {
                    String key = field.get("key").asText();
                    if (keys.contains(key)) {
                        errors.add(Map.of("category", "Schema", "message",
                            "字段 key 重复: " + key, "severity", "ERROR"));
                    }
                    keys.add(key);
                }

                if (!field.has("type")) {
                    errors.add(Map.of("category", "Schema", "message", "字段缺少 type", "severity", "ERROR"));
                } else {
                    String type = field.get("type").asText();
                    if (!VALID_FIELD_TYPES.contains(type)) {
                        warnings.add(Map.of("category", "Schema", "message",
                            "未知字段类型: " + type, "severity", "WARNING"));
                    }
                    if (Set.of("select", "multi_select", "radio", "checkbox").contains(type)) {
                        if (!field.has("options") || field.get("options").isEmpty()) {
                            String fieldKey = field.has("key") ? field.get("key").asText() : "unknown";
                            warnings.add(Map.of("category", "Schema", "message",
                                "选择类字段 " + fieldKey + " 缺少 options", "severity", "WARNING"));
                        }
                    }
                }

                if (!field.has("label")) {
                    warnings.add(Map.of("category", "Schema", "message", "字段缺少 label", "severity", "WARNING"));
                }
            }
        } catch (JsonProcessingException e) {
            errors.add(Map.of("category", "Schema", "message",
                "JSON 格式错误: " + e.getMessage(), "severity", "ERROR"));
        }

        return buildResult(errors, warnings);
    }

    public Map<String, Object> lintWorkflow(String nodesJson, String edgesJson, String fieldsJson) {
        List<Map<String, Object>> errors = new ArrayList<>();
        List<Map<String, Object>> warnings = new ArrayList<>();

        try {
            JsonNode nodes = objectMapper.readTree(nodesJson);
            JsonNode edges = objectMapper.readTree(edgesJson);
            Set<String> nodeIds = new HashSet<>();
            Set<String> fieldKeys = extractFieldKeys(fieldsJson);
            if (!nodes.isArray()) {
                errors.add(Map.of("category", "Workflow", "message", "nodes 必须是数组", "severity", "ERROR"));
                return buildResult(errors, warnings);
            }

            boolean hasStart = false, hasEnd = false;
            boolean hasNodeTypeHint = false;
            for (JsonNode node : nodes) {
                if (!node.has("nodeId")) {
                    errors.add(Map.of("category", "Workflow", "message", "节点缺少 nodeId", "severity", "ERROR"));
                    continue;
                }
                String nodeId = node.get("nodeId").asText();
                nodeIds.add(nodeId);

                if (node.has("nodeType")) {
                    String nodeType = node.get("nodeType").asText();
                    if ("start".equals(nodeType)) hasStart = true;
                    if ("end".equals(nodeType)) hasEnd = true;
                    if (!VALID_NODE_TYPES.contains(nodeType)) {
                        warnings.add(Map.of("category", "Workflow", "message",
                            "未知节点类型: " + nodeType + " (节点: " + nodeId + ")，有效值: " + VALID_NODE_TYPES, "severity", "WARNING"));
                    }
                } else {
                    if (node.has("data") && node.get("data").has("nodeType")) {
                        hasNodeTypeHint = true;
                    }
                    errors.add(Map.of("category", "Workflow", "message",
                        "节点 " + nodeId + " 缺少顶层 nodeType 字段，lint 通过 node.has(\"nodeType\") 读取节点类型，请将 nodeType 放在节点顶层（与 nodeId 同级），不要放在 data 内部", "severity", "ERROR"));
                }
            }

            if (!hasStart) {
                String hint = hasNodeTypeHint
                    ? "（你可能把 nodeType 放在了 data 内部，lint 只读取节点顶层的 nodeType 字段，请将 nodeType: \"start\" 移到节点顶层）"
                    : "（需要有一个节点顶层 nodeType 为 \"start\"）";
                errors.add(Map.of("category", "Workflow", "message", "缺少开始节点" + hint, "severity", "ERROR"));
            }
            if (!hasEnd) {
                String hint = hasNodeTypeHint
                    ? "（你可能把 nodeType 放在了 data 内部，lint 只读取节点顶层的 nodeType 字段，请将 nodeType: \"end\" 移到节点顶层）"
                    : "（需要有一个节点顶层 nodeType 为 \"end\"）";
                errors.add(Map.of("category", "Workflow", "message", "缺少结束节点" + hint, "severity", "ERROR"));
            }

            if (edges.isArray()) {
                for (JsonNode edge : edges) {
                    if (edge.has("source") && !nodeIds.contains(edge.get("source").asText())) {
                        errors.add(Map.of("category", "Workflow", "message",
                            "边引用了不存在的源节点: " + edge.get("source").asText(), "severity", "ERROR"));
                    }
                    if (edge.has("target") && !nodeIds.contains(edge.get("target").asText())) {
                        errors.add(Map.of("category", "Workflow", "message",
                            "边引用了不存在的目标节点: " + edge.get("target").asText(), "severity", "ERROR"));
                    }
                }
            }

            // 孤立节点检测
            Set<String> connectedNodes = new HashSet<>();
            if (edges.isArray()) {
                for (JsonNode edge : edges) {
                    if (edge.has("source")) connectedNodes.add(edge.get("source").asText());
                    if (edge.has("target")) connectedNodes.add(edge.get("target").asText());
                }
            }
            for (String nodeId : nodeIds) {
                if (!connectedNodes.contains(nodeId)) {
                    warnings.add(Map.of("category", "Workflow", "message",
                        "孤立节点: " + nodeId + " (未连接到任何边)", "severity", "WARNING"));
                }
            }

            // 触发器契约检查：事件合法性、target 完整性、paramsMapping 的 form.data.* 字段必须存在于绑定表单。
            // 这类断链在真实运行时表现为"参数为 NULL → 必填派发失败 / 非必填静默命中 0 行"，必须建模期报出。
            // 例外：form.data.id 是平台业务主键约定（发起侧 startWorkflow 运行时注入 Insert 查询的
            // insertId，不在绑定表单 schema 内）——按断链报 ERROR 会制造误报风暴（2026-09-18 请假
            // 案例 9 条 ERROR，流程助手被迫逐条口头解释），降级为每节点一条 WARNING。
            if (nodes.isArray()) {
                lintTriggers(nodes, fieldKeys, errors, warnings);
                lintApprovers(nodes, warnings);
            }

            // 条件边引用字段检查：条件表达式至少引用一个绑定表单字段，否则分支永远走同一边
            if (edges.isArray() && !fieldKeys.isEmpty()) {
                for (JsonNode edge : edges) {
                    String cond = edge.has("condition") && !edge.get("condition").isNull()
                            ? edge.get("condition").asText("")
                            : edge.path("data").path("condition").asText("");
                    if (cond.isBlank()) continue;
                    boolean refsField = false;
                    for (String key : fieldKeys) {
                        if (cond.contains(key)) { refsField = true; break; }
                    }
                    if (!refsField) {
                        warnings.add(Map.of("category", "Condition", "message",
                            "条件表达式 \"" + cond + "\" 未引用任何绑定表单字段，请确认字段名与表单一致"
                                + "（不一致时分支求值恒为同一边）", "severity", "WARNING"));
                    }
                }
            }
        } catch (JsonProcessingException e) {
            errors.add(Map.of("category", "Workflow", "message",
                "JSON 格式错误: " + e.getMessage(), "severity", "ERROR"));
        }

        return buildResult(errors, warnings);
    }

    /** 触发器契约检查（在 lintWorkflow 的 nodes 数组上执行） */
    private void lintTriggers(JsonNode nodes, Set<String> fieldKeys,
                              List<Map<String, Object>> errors, List<Map<String, Object>> warnings) {
        for (JsonNode node : nodes) {
            JsonNode config = node.path("data").path("config");
            JsonNode triggers = config.path("triggers");
            if (!triggers.isArray() || triggers.isEmpty()) continue;
            String nodeId = node.path("nodeId").asText("?");
            String nodeName = config.has("nodeName") ? config.get("nodeName").asText() : nodeId;

            Map<String, Integer> perEvent = new LinkedHashMap<>();
            boolean businessIdHintGiven = false;
            for (JsonNode t : triggers) {
                String on = t.path("on").asText("");
                if (!VALID_TRIGGER_EVENTS.contains(on)) {
                    errors.add(Map.of("category", "Trigger", "message",
                        "节点「" + nodeName + "」触发器事件非法: \"" + on + "\"（合法值: "
                            + VALID_TRIGGER_EVENTS + "）", "severity", "ERROR"));
                }
                JsonNode target = t.path("target");
                if (target.path("type").asText("").isBlank() || !target.has("ref") || target.get("ref").isNull()) {
                    errors.add(Map.of("category", "Trigger", "message",
                        "节点「" + nodeName + "」的触发器缺少 target.type/ref（或 ref 非法），运行时会被忽略",
                        "severity", "ERROR"));
                }
                for (JsonNode pm : t.path("paramsMapping")) {
                    String from = pm.path("from").asText("");
                    if (from.startsWith("form.data.")) {
                        String fieldKey = from.substring("form.data.".length());
                        if (!fieldKeys.isEmpty() && !fieldKeys.contains(fieldKey)) {
                            if ("id".equals(fieldKey)) {
                                // 业务主键约定：form.data.id 由发起侧（startWorkflowWithForm / 页面代码）
                                // 在运行时注入业务记录主键（Insert 查询的 insertId），不在绑定表单 schema 内，
                                // 不是断链。真断链（发起侧漏带 id）由触发器预演 / 链路自检的运行时证据兜底
                                if (!businessIdHintGiven) {
                                    warnings.add(Map.of("category", "Trigger", "message",
                                        "节点「" + nodeName + "」触发器引用 form.data.id（平台业务主键约定："
                                            + "发起侧运行时注入 insertId，不在绑定表单 schema 内，不作断链处理）。"
                                            + "请以 rehearse_triggers / app_selfcheck 的运行时证据确认发起侧 formData 携带该字段",
                                        "severity", "WARNING"));
                                    businessIdHintGiven = true;
                                }
                            } else {
                                errors.add(Map.of("category", "Trigger", "message",
                                    "断链：节点「" + nodeName + "」的触发器 paramsMapping 引用 form.data."
                                        + fieldKey + "，但绑定表单不存在该字段——发起侧 formData 不携带该字段时"
                                        + "参数为 NULL，回写查询静默命中 0 行", "severity", "ERROR"));
                            }
                        }
                    }
                }
                perEvent.merge(on, 1, Integer::sum);
            }
            for (Map.Entry<String, Integer> en : perEvent.entrySet()) {
                if (en.getValue() > 1) {
                    warnings.add(Map.of("category", "TriggerOrder", "message",
                        "节点「" + nodeName + "」在 " + en.getKey() + " 事件上配置了 " + en.getValue()
                            + " 条触发器，运行时同组按配置顺序派发（前序成功才执行后续，重试不乱序）。"
                            + "存在先后依赖（如先回写状态再扣余额）请确认顺序，可用触发器预演验证",
                        "severity", "WARNING"));
                }
            }
        }
    }

    /** 审批人依赖提示：leader/department_head 解析不到时节点按 resolutionPolicy 跳过/挂起/失败 */
    private void lintApprovers(JsonNode nodes, List<Map<String, Object>> warnings) {
        for (JsonNode node : nodes) {
            JsonNode config = node.path("data").path("config");
            if (!"approval".equals(node.path("nodeType").asText(""))) continue;
            String approverType = config.path("approverType").asText("");
            if (!"leader".equals(approverType) && !"department_head".equals(approverType)) continue;
            String nodeName = config.has("nodeName") ? config.get("nodeName").asText()
                    : node.path("nodeId").asText("?");
            warnings.add(Map.of("category", "Approver", "message",
                "节点「" + nodeName + "」审批人依赖组织架构（发起人主部门 leader_id / 部门 manager_id）。"
                    + "发布前建议用 rehearse_triggers 以真实平台账号预演审批人可解析；"
                    + "也可在节点 config 声明 resolutionPolicy=skip|fail|suspend 控制解析为空时的行为"
                    + "（依赖回写触发器的流程建议 fail/suspend，避免静默跳过后触发器永不执行）",
                "severity", "WARNING"));
        }
    }

    /**
     * 按流程定义 lint：服务端自动装载绑定表单字段（不再依赖调用方传 fields），
     * 触发器/条件断链检查据此生效。绑定优先取当前定义 id，DRAFT 且存在已发布版本时兜底发布版本。
     * 额外做组织架构前置数据检查（A4）：审批节点依赖的 leader/manager 映射必须有数据。
     */
    public Map<String, Object> lintWorkflowDefinition(Long processId) {
        WorkflowDefinition definition = workflowDefinitionRepository.findById(processId).orElse(null);
        if (definition == null) {
            return Map.of(
                    "passed", false,
                    "errors", List.of(Map.of("category", "Workflow", "message",
                            "流程定义不存在: " + processId, "severity", "ERROR")),
                    "warnings", List.of());
        }
        String fieldsJson = loadBoundFormFields(definition);
        Map<String, Object> result = lintWorkflow(definition.getNodes(), definition.getEdges(), fieldsJson);

        // 组织架构前置数据检查（A4）：审批节点依赖的 leader/manager 映射必须有数据，
        // 否则真实发起时这些节点统一按策略走空（跳过/挂起/失败），回写链路整体失效
        if (usesApproverType(definition.getNodes(), "leader")
                && !userDeptRepository.existsByIsPrimaryTrueAndLeaderIdIsNotNull()) {
            appendError(result, "流程包含 leader 审批节点，但 user_dept 中没有任何主部门配置了直属上级（leader_id）"
                    + "——真实发起时这些节点将按 resolutionPolicy 走空，请先在平台组织架构中补齐数据");
        }
        if (usesApproverType(definition.getNodes(), "department_head")
                && !departmentRepository.existsByManagerIdIsNotNull()) {
            appendError(result, "流程包含 department_head 审批节点，但 departments 中没有任何部门配置了负责人（manager_id）"
                    + "——真实发起时这些节点将按 resolutionPolicy 走空，请先在平台组织架构中补齐数据");
        }
        return result;
    }

    /** 流程定义中是否存在使用指定 approverType 的审批节点 */
    private boolean usesApproverType(String nodesJson, String approverType) {
        try {
            JsonNode nodes = objectMapper.readTree(nodesJson == null ? "[]" : nodesJson);
            for (JsonNode node : nodes) {
                if ("approval".equals(node.path("nodeType").asText(""))
                        && approverType.equals(node.path("data").path("config").path("approverType").asText(""))) {
                    return true;
                }
            }
        } catch (JsonProcessingException ignored) { }
        return false;
    }

    @SuppressWarnings("unchecked")
    private void appendError(Map<String, Object> lintResult, String message) {
        List<Map<String, Object>> errors = (List<Map<String, Object>>) lintResult.get("errors");
        if (errors == null) return;
        errors.add(Map.of("category", "Approver", "message", message, "severity", "ERROR"));
        lintResult.put("errorCount", errors.size());
        lintResult.put("passed", false);
    }

    private String loadBoundFormFields(WorkflowDefinition definition) {
        List<FormWorkflowBinding> bindings = formWorkflowBindingRepository.findByWorkflowId(definition.getId());
        if (bindings.isEmpty() && definition.getPublishedVersionId() != null
                && !definition.getPublishedVersionId().equals(definition.getId())) {
            bindings = formWorkflowBindingRepository.findByWorkflowId(definition.getPublishedVersionId());
        }
        if (bindings.isEmpty()) return "[]";
        FormDefinition form = formDefinitionRepository.findById(bindings.get(0).getFormId()).orElse(null);
        return form != null && form.getFields() != null ? form.getFields() : "[]";
    }

    public Map<String, Object> lintCondition(String expression, String fieldsJson) {
        List<Map<String, Object>> errors = new ArrayList<>();
        List<Map<String, Object>> warnings = new ArrayList<>();

        if (expression == null || expression.trim().isEmpty()) {
            warnings.add(Map.of("category", "Condition", "message", "条件表达式为空", "severity", "WARNING"));
            return buildResult(errors, warnings);
        }

        Set<String> fieldKeys = extractFieldKeys(fieldsJson);
        for (String key : fieldKeys) {
            if (expression.contains(key)) {
                return buildResult(errors, warnings);
            }
        }
        warnings.add(Map.of("category", "Condition", "message",
            "条件表达式未引用任何已知字段", "severity", "WARNING"));

        return buildResult(errors, warnings);
    }

    private Set<String> extractFieldKeys(String fieldsJson) {
        Set<String> keys = new HashSet<>();
        try {
            if (fieldsJson != null && !fieldsJson.isEmpty()) {
                JsonNode fields = objectMapper.readTree(fieldsJson);
                for (JsonNode field : fields) {
                    if (field.has("key")) keys.add(field.get("key").asText());
                }
            }
        } catch (Exception ignored) {}
        return keys;
    }

    private Map<String, Object> buildResult(List<Map<String, Object>> errors, List<Map<String, Object>> warnings) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("passed", errors.isEmpty());
        result.put("errors", errors);
        result.put("warnings", warnings);
        result.put("errorCount", errors.size());
        result.put("warningCount", warnings.size());
        return result;
    }
}