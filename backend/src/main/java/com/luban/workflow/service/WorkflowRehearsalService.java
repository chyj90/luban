package com.luban.workflow.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.service.QueryService;
import com.luban.workflow.entity.WorkflowDefinition;
import com.luban.workflow.repository.WorkflowDefinitionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 流程触发器预演（rehearsal）：给定样例表单数据，静态推演流程会走哪条分支、
 * 每个节点会触发哪些触发器、paramsMapping 解析出什么参数、QUERY 目标渲染出的 SQL——
 * 不发起实例、不执行任何写操作。
 *
 * 目的：把"断链（form.data.* 缺字段）、审批人解析为空、条件分支不命中、
 * 回写顺序依赖"这类要到真实流程跑一半才静默暴露的问题，在建模/发布阶段就报出来。
 * 预演通过 ≠ 一定没有问题，但预演报出的每一条都是真实运行时必然发生的行为。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WorkflowRehearsalService {

    private static final Set<String> INSTANCE_LEVEL_EVENTS = Set.of(
            WorkflowTriggerService.EVT_INSTANCE_COMPLETED, WorkflowTriggerService.EVT_INSTANCE_REJECTED);

    private static final Set<String> VALID_EVENTS = Set.of(
            WorkflowTriggerService.EVT_NODE_ENTERED, WorkflowTriggerService.EVT_APPROVED,
            WorkflowTriggerService.EVT_REJECTED,
            WorkflowTriggerService.EVT_INSTANCE_COMPLETED, WorkflowTriggerService.EVT_INSTANCE_REJECTED);

    private final WorkflowDefinitionRepository definitionRepository;
    private final QueryService queryService;
    private final WorkflowTriggerService triggerService;
    private final ProcessEngine processEngine;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    /**
     * 预演一个流程定义。
     *
     * @param definitionId      流程定义 id
     * @param sampleFormData    样例表单数据（模拟发起时 startWorkflow 的 formData）
     * @param sampleInitiatorId 样例发起人（平台用户 id，用于审批人解析与 this.auth 渲染；可为 null）
     */
    public Map<String, Object> rehearse(Long definitionId, Map<String, Object> sampleFormData,
                                        Long sampleInitiatorId) {
        WorkflowDefinition definition = definitionRepository.findById(definitionId)
                .orElseThrow(() -> new IllegalArgumentException("流程定义不存在: " + definitionId));
        Map<String, Object> form = sampleFormData == null ? Map.of() : sampleFormData;

        List<Map<String, Object>> nodes = parseArray(definition.getNodes());
        List<Map<String, Object>> edges = parseArray(definition.getEdges());
        Map<String, Map<String, Object>> nodeById = new LinkedHashMap<>();
        for (Map<String, Object> node : nodes) {
            nodeById.put(nodeId(node), node);
        }

        List<Map<String, Object>> errors = new ArrayList<>();
        List<Map<String, Object>> warnings = new ArrayList<>();
        List<Map<String, Object>> infos = new ArrayList<>();

        // ① 路径推演：从 start 沿条件边走（多分支命中时并行推进，与引擎语义一致）
        Set<String> pathNodeIds = new LinkedHashSet<>();
        walkPath("start", nodeById, edges, form, pathNodeIds, warnings);

        // ② 路径节点概要 + 审批人解析预演
        List<Map<String, Object>> path = new ArrayList<>();
        for (String nodeId : pathNodeIds) {
            Map<String, Object> node = nodeById.get(nodeId);
            Map<String, Object> config = configOf(node);
            String nodeType = nodeType(node);
            Map<String, Object> step = new LinkedHashMap<>();
            step.put("nodeId", nodeId);
            step.put("nodeType", nodeType);
            step.put("nodeName", config.getOrDefault("nodeName", node.get("label")));
            if ("approval".equals(nodeType)) {
                String approverType = str(config.getOrDefault("approverType", "member"));
                List<Long> assignees = processEngine.previewAssignees(
                        definitionId, nodeId, sampleInitiatorId, form);
                step.put("approverType", approverType);
                step.put("previewAssignees", assignees);
                if (assignees.isEmpty()) {
                    errors.add(Map.of("category", "Approver", "severity", "ERROR",
                            "nodeId", nodeId,
                            "message", "节点「" + config.getOrDefault("nodeName", nodeId)
                                    + "」审批人解析为空，真实运行时该节点会被静默跳过（SKIP）后直接推进"
                                    + "——APPROVED 触发器永不执行。approverType=" + approverType
                                    + "；leader/department_head 依赖发起人主部门的 leader_id/部门 manager_id，"
                                    + "请核对平台组织架构数据或改用 member/role/form_field 指定审批人"));
                }
            }
            path.add(step);
        }

        // ③ 触发器收集：路径上节点的节点级触发器 + 所有节点的实例级触发器（广播与路径无关）
        List<Map<String, Object>> triggers = new ArrayList<>();
        for (Map<String, Object> node : nodes) {
            String nodeId = nodeId(node);
            boolean onPath = pathNodeIds.contains(nodeId);
            for (Map<String, Object> t : triggersOf(node)) {
                String on = str(t.get("on"));
                boolean instanceLevel = INSTANCE_LEVEL_EVENTS.contains(on);
                if (!instanceLevel && !onPath) continue;
                triggers.add(buildTriggerPreview(node, nodeId, t, on, instanceLevel, form,
                        sampleInitiatorId, errors, warnings));
            }
        }

        // ④ 顺序提示：同一节点同一事件多条触发器 → 组内按配置顺序派发
        Map<String, Integer> perNodeEvent = new LinkedHashMap<>();
        for (Map<String, Object> t : triggers) {
            if (Boolean.TRUE.equals(t.get("instanceLevel"))) continue;
            perNodeEvent.merge(t.get("nodeId") + "#" + t.get("on"), 1, Integer::sum);
        }
        for (Map.Entry<String, Integer> e : perNodeEvent.entrySet()) {
            if (e.getValue() > 1) {
                infos.add(Map.of("category", "TriggerOrder", "severity", "INFO",
                        "message", "节点事件 " + e.getKey() + " 配置了 " + e.getValue()
                                + " 条触发器，运行时同组按配置顺序派发（前序成员成功后才执行后续，"
                                + "失败重试不乱序）。存在先后依赖（如先回写状态再扣余额）时请确认"
                                + "配置顺序，或合并为一条编排目标在事务内完成"));
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("definitionId", definitionId);
        result.put("definitionName", definition.getName());
        result.put("status", definition.getStatus());
        result.put("sampleFormData", form);
        result.put("sampleInitiatorId", sampleInitiatorId);
        result.put("path", path);
        result.put("triggers", triggers);
        result.put("passed", errors.isEmpty());
        result.put("errors", errors);
        result.put("warnings", warnings);
        result.put("infos", infos);
        return result;
    }

    // ── 触发器预演 ──────────────────────────────────────────────

    private Map<String, Object> buildTriggerPreview(Map<String, Object> node, String nodeId,
                                                    Map<String, Object> t, String on, boolean instanceLevel,
                                                    Map<String, Object> form, Long sampleInitiatorId,
                                                    List<Map<String, Object>> errors,
                                                    List<Map<String, Object>> warnings) {
        Map<String, Object> config = configOf(node);
        String nodeName = str(config.getOrDefault("nodeName", node.get("label")));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("nodeId", nodeId);
        out.put("nodeName", nodeName);
        out.put("triggerId", str(t.get("triggerId")));
        out.put("on", on);
        out.put("instanceLevel", instanceLevel);
        out.put("fireTiming", switch (on) {
            case "NODE_ENTERED" -> "进入该节点时";
            case "APPROVED" -> "该节点审批通过时";
            case "REJECTED" -> "该节点被驳回时";
            case "INSTANCE_COMPLETED" -> "实例完结时（广播，与路径无关）";
            case "INSTANCE_REJECTED" -> "实例被驳回时（广播，与路径无关）";
            default -> on;
        });

        Map<String, Object> target = t.get("target") instanceof Map<?, ?> m
                ? (Map<String, Object>) m : Map.of();
        String targetType = str(target.get("type"));
        Object ref = target.get("ref");
        out.put("targetType", targetType);
        out.put("targetRef", ref);
        if (targetType.isBlank() || ref == null) {
            errors.add(Map.of("category", "TriggerTarget", "severity", "ERROR",
                    "message", "节点「" + nodeName + "」的触发器缺少 target.type/ref（或 ref 非法），"
                            + "运行时该触发器会被忽略"));
        }

        Object mapping = t.get("paramsMapping");
        Map<String, Object> params = triggerService.previewParams(mapping, form);
        out.put("params", params);

        // 断链检查：form.data.X 解析为 null → 样例数据缺字段或路径不存在，触发时参数为 NULL
        List<String> nullFromPaths = new ArrayList<>();
        if (mapping instanceof List<?> list) {
            for (Object item : list) {
                if (!(item instanceof Map<?, ?> m)) continue;
                Object to = m.get("to");
                String from = m.get("from") == null ? "" : String.valueOf(m.get("from"));
                if (!from.isBlank() && params.get(to) == null) {
                    nullFromPaths.add(from);
                }
            }
        }
        out.put("nullParamsFrom", nullFromPaths);
        for (String fromPath : nullFromPaths) {
            String hint = fromPath.startsWith("form.data.")
                    ? "（样例表单数据缺少字段 " + fromPath.substring("form.data.".length())
                      + "；若发起侧 formData 也不携带该字段，触发时参数为 NULL，"
                      + "必填参数会派发失败、非必填会静默命中 0 行）"
                    : "（路径解析为 null，请检查 paramsMapping.from 是否正确）";
            warnings.add(Map.of("category", "TriggerParam", "severity", "WARNING",
                    "message", "节点「" + nodeName + "」触发器 paramsMapping " + fromPath
                            + " 在样例数据下解析为 null " + hint));
        }

        if ("QUERY".equals(targetType) && ref instanceof Number n && n.longValue() > 0) {
            Map<String, Object> preview = queryService.previewRenderedSql(n.longValue(), params, sampleInitiatorId);
            out.put("queryPreview", preview);
            if (preview.containsKey("error")) {
                errors.add(Map.of("category", "TriggerTarget", "severity", "ERROR",
                        "message", "节点「" + nodeName + "」触发器目标查询渲染失败: " + preview.get("error")));
            }
        }
        return out;
    }

    // ── 路径推演 ────────────────────────────────────────────────

    /** 从 fromNodeId 沿条件边推演（多分支命中全部推进；全不命中取第一条出边并告警，与引擎默认行为一致） */
    private void walkPath(String fromNodeId, Map<String, Map<String, Object>> nodeById,
                          List<Map<String, Object>> edges, Map<String, Object> form,
                          Set<String> visited, List<Map<String, Object>> warnings) {
        if (!visited.add(fromNodeId)) return;
        Map<String, Object> node = nodeById.get(fromNodeId);
        if (node == null || "end".equals(nodeType(node))) return;

        List<Map<String, Object>> outgoing = new ArrayList<>();
        for (Map<String, Object> e : edges) {
            if (fromNodeId.equals(str(e.get("source")))) outgoing.add(e);
        }
        if (outgoing.isEmpty()) return;

        List<Map<String, Object>> matched = new ArrayList<>();
        boolean hasCondition = false;
        for (Map<String, Object> e : outgoing) {
            String cond = edgeCondition(e);
            if (cond.isBlank()) continue;
            hasCondition = true;
            if (ConditionEvaluator.evaluate(cond, form)) matched.add(e);
        }
        if (matched.isEmpty()) {
            if (hasCondition) {
                warnings.add(Map.of("category", "Condition", "severity", "WARNING",
                        "message", "节点「" + str(configOf(node).getOrDefault("nodeName", fromNodeId))
                                + "」的所有条件分支均未命中样例数据，运行时将取默认第一条出边推进"));
            }
            matched = List.of(outgoing.get(0));
        }
        for (Map<String, Object> e : matched) {
            walkPath(str(e.get("target")), nodeById, edges, form, visited, warnings);
        }
    }

    // ── 定义 JSON 解析（与引擎的宽容语义保持一致） ────────────────

    private List<Map<String, Object>> parseArray(String json) {
        try {
            if (json == null || json.isEmpty()) return List.of();
            return objectMapper.readValue(json, new TypeReference<List<Map<String, Object>>>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    private String nodeId(Map<String, Object> node) {
        return str(node.getOrDefault("id", node.get("nodeId")));
    }

    private String nodeType(Map<String, Object> node) {
        Object t = node.get("nodeType");
        if (t == null) t = castMap(node.get("data")).get("nodeType");
        if (t == null) t = node.get("type");
        return str(t);
    }

    private Map<String, Object> configOf(Map<String, Object> node) {
        Map<String, Object> config = castMap(castMap(node.get("data")).get("config"));
        return config.isEmpty() ? castMap(node.get("config")) : config;
    }

    private List<Map<String, Object>> triggersOf(Map<String, Object> node) {
        return castList(configOf(node).get("triggers"));
    }

    private String edgeCondition(Map<String, Object> edge) {
        Object cond = edge.get("condition");
        if (cond == null) cond = castMap(edge.get("data")).get("condition");
        return cond == null ? "" : String.valueOf(cond);
    }

    private String str(Object o) { return o == null ? "" : String.valueOf(o); }

    @SuppressWarnings("unchecked")
    private Map<String, Object> castMap(Object o) {
        return o instanceof Map ? (Map<String, Object>) o : Map.of();
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> castList(Object o) {
        if (!(o instanceof List<?> list)) return List.of();
        return (List<Map<String, Object>>) list.stream().filter(i -> i instanceof Map).toList();
    }
}
