package com.luban.workflow.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.workflow.entity.WorkflowDefinition;
import com.luban.workflow.entity.WorkflowInstance;
import com.luban.workflow.entity.WorkflowTriggerOutbox;
import com.luban.workflow.repository.WorkflowDefinitionRepository;
import com.luban.workflow.repository.WorkflowTriggerOutboxRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

/**
 * 流程节点触发器：事件入队（outbox）。
 *
 * ProcessEngine 在节点进入/审批通过/驳回/实例完结点调用 fireNodeEvent，
 * 本服务解析节点 triggers 配置并把命中的触发器写成 outbox 行（与业务同事务），
 * 实际派发由 TriggerDispatcher 异步执行——用异步边界打断"流程→编排→流程"环。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WorkflowTriggerService {

    public static final String EVT_NODE_ENTERED = "NODE_ENTERED";
    public static final String EVT_APPROVED = "APPROVED";
    public static final String EVT_REJECTED = "REJECTED";
    public static final String EVT_INSTANCE_COMPLETED = "INSTANCE_COMPLETED";
    public static final String EVT_INSTANCE_REJECTED = "INSTANCE_REJECTED";

    private final WorkflowTriggerOutboxRepository outboxRepository;
    private final WorkflowDefinitionRepository workflowDefinitionRepository;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    /**
     * 节点事件 → 命中的触发器写入 outbox。入队失败只记日志，不阻断审批主流程。
     * 与业务同事务（REQUIRED，标准 outbox）：outbox 行与流程状态变更同提交同回滚——
     * 审批事务回滚时触发意图一并消失，不会把不存在的状态派发给外部目标；
     * 实际派发由 TriggerDispatcher 异步执行（at-least-once + 退避重试），
     * 用异步边界打断"流程→编排→流程"环。
     *
     * 分组语义：同一来源节点在同一事件上的多个触发器编为一组（groupId + group_order），
     * TriggerDispatcher 按组门槛顺序派发——"先回写状态(155)、再扣减余额(157)"这类
     * 顺序依赖是配置契约的一部分，不依赖轮询的实现巧合；某成员失败重试时，
     * 后续成员被门槛拦住，不会抢先执行。
     */
    @Transactional(propagation = Propagation.REQUIRED)
    public void fireNodeEvent(WorkflowInstance instance, String nodeId, String event,
                              Long taskId, String comment) {
        try {
            WorkflowDefinition definition = workflowDefinitionRepository
                    .findById(instance.getWorkflowId()).orElse(null);
            if (definition == null) return;
            // 实例级事件广播：INSTANCE_COMPLETED 以 nodeId="end" 触发、INSTANCE_REJECTED 以驳回节点触发，
            // 而触发器只允许配置在审批节点上——按节点匹配会让"整个流程完结/被驳回"的触发器永不生效
            // （2026-09-15 请假案例：流程助手把 INSTANCE_COMPLETED 列为可配置事件，实际挂上也收不到）。
            // 改为实例级事件广播到所有配置了该事件的节点，与前端"整个流程完结/被驳回时"的语义一致。
            // 收集 (来源节点, 触发器) 对，同一来源节点的触发器保持配置顺序编组。
            List<Map<String, Object>> matched = new ArrayList<>();
            if (isInstanceLevelEvent(event)) {
                for (Map<String, Object> node : parseNodes(definition.getNodes())) {
                    String sourceNode = str(node.getOrDefault("id", node.get("nodeId")));
                    for (Map<String, Object> t : castList(castMap(castMap(node.get("data")).get("config")).get("triggers"))) {
                        if (event.equals(str(t.get("on")))) {
                            matched.add(Map.of("sourceNode", sourceNode, "trigger", t));
                        }
                    }
                }
            } else {
                for (Map<String, Object> t : triggersOfNode(definition, nodeId)) {
                    if (event.equals(str(t.get("on")))) {
                        matched.add(Map.of("sourceNode", nodeId, "trigger", t));
                    }
                }
            }
            if (matched.isEmpty()) return;

            Map<String, List<Map<String, Object>>> bySourceNode = new LinkedHashMap<>();
            for (Map<String, Object> pair : matched) {
                bySourceNode.computeIfAbsent(str(pair.get("sourceNode")), k -> new ArrayList<>())
                        .add(castMap(pair.get("trigger")));
            }
            for (Map.Entry<String, List<Map<String, Object>>> group : bySourceNode.entrySet()) {
                String groupId = java.util.UUID.randomUUID().toString();
                int order = 0;
                for (Map<String, Object> trigger : group.getValue()) {
                    String on = str(trigger.get("on"));
                    if (!event.equals(on)) continue;
                    Map<String, Object> target = castMap(trigger.get("target"));
                    String type = str(target.get("type"));
                    Object ref = target.get("ref");
                    Long refId = ref instanceof Number n && n.longValue() > 0
                            ? n.longValue() : parsePositive(ref);
                    if (type.isBlank() || refId == null) {
                        log.warn("触发器配置缺少 target.type/ref（或 ref 非法），忽略: node={} trigger={}",
                                group.getKey(), trigger);
                        continue;
                    }
                    enqueue(instance, group.getKey(), taskId, comment, event, trigger, type, refId,
                            groupId, order++);
                }
            }
        } catch (Exception e) {
            log.error("触发器事件入队失败 instance={} node={} event={}",
                    instance.getId(), nodeId, event, e);
        }
    }

    /** 实例级事件：不绑定具体节点，广播到全部配置了该事件的节点 */
    private boolean isInstanceLevelEvent(String event) {
        return EVT_INSTANCE_COMPLETED.equals(event) || EVT_INSTANCE_REJECTED.equals(event);
    }

    private void enqueue(WorkflowInstance instance, String nodeId, Long taskId, String lastComment,
                         String event, Map<String, Object> trigger, String targetType, Long targetRef,
                         String groupId, int groupOrder) {
        Map<String, Object> params = resolveParams(trigger.get("paramsMapping"), instance, taskId, nodeId, lastComment, event);
        Map<String, Object> retry = castMap(trigger.get("retry"));

        WorkflowTriggerOutbox row = new WorkflowTriggerOutbox();
        row.setInstanceId(instance.getId());
        row.setTaskId(taskId);
        row.setNodeId(nodeId);
        row.setTriggerId(str(trigger.getOrDefault("triggerId", targetType + ":" + targetRef)));
        row.setGroupId(groupId);
        row.setGroupOrder(groupOrder);
        row.setTargetType(targetType);
        row.setTargetRef(targetRef);
        row.setPayload(toJson(Map.of(
                "params", params,
                "initiatorId", instance.getInitiatorId() == null ? 0 : instance.getInitiatorId(),
                "applicationId", instance.getApplicationId() == null ? 0 : instance.getApplicationId(),
                "workflowDefinitionId", instance.getWorkflowId())));
        row.setStatus("PENDING");
        row.setAttempts(0);
        row.setMaxAttempts(retry.get("maxAttempts") instanceof Number n ? n.intValue() : 3);
        row.setBackoffSeconds(toJson(retry.getOrDefault("backoffSeconds", List.of(30, 120, 600))));
        // 可选声明：minAffectedRows（仅 QUERY 目标生效）——"必命中"回写的实际影响行数
        // 低于声明值时按失败重试/死信，堵住"守卫未命中/记录不存在 → 0 行还被当成派发成功"的静默缺口
        Object minAffected = trigger.get("minAffectedRows");
        if (minAffected instanceof Number n) row.setMinAffectedRows(n.intValue());
        else {
            Long parsed = parsePositive(minAffected);
            if (parsed != null) row.setMinAffectedRows(parsed.intValue());
        }
        row.setNextRetryAt(LocalDateTime.now());
        // 先落库拿 id，再写确定性幂等键："otb-"+行id 在重试间稳定，
        // 漏斗按该键查重后，"目标已成功但响应丢失"的重发不会重复执行
        row.setIdempotencyKey("pending-" + java.util.UUID.randomUUID());
        outboxRepository.save(row);
        row.setIdempotencyKey("otb-" + row.getId());
        outboxRepository.save(row);
        log.info("流程触发器已入队: instance={} node={} group={}#{} target={}:{} row={}",
                instance.getId(), nodeId, groupId, groupOrder, targetType, targetRef, row.getId());
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> resolveParams(Object mapping, WorkflowInstance instance,
                                              Long taskId, String nodeId, String comment, String event) {
        Map<String, Object> form = parseJson(instance.getFormData());
        Map<String, Object> root = buildMappingRoot(form, instance.getId(), instance.getInitiatorId(),
                instance.getStatus(), taskId, nodeId, comment, event);
        return applyMapping(mapping, root);
    }

    /**
     * 触发器预演用：按样例表单数据解析 paramsMapping（不发起实例、无副作用）。
     * root 上下文与真实运行一致，仅 instance/task/node 概要用占位值。
     */
    public Map<String, Object> previewParams(Object mapping, Map<String, Object> sampleFormData) {
        Map<String, Object> form = sampleFormData == null ? Map.of() : sampleFormData;
        Map<String, Object> root = buildMappingRoot(form, 0L, 0L, "PREVIEW", null, "preview", null, null);
        return applyMapping(mapping, root);
    }

    private Map<String, Object> buildMappingRoot(Map<String, Object> form, Long instanceId, Long initiatorId,
                                                 String instanceStatus, Long taskId, String nodeId,
                                                 String comment, String event) {
        Map<String, Object> root = new LinkedHashMap<>();
        Map<String, Object> instanceMap = new LinkedHashMap<>();
        instanceMap.put("id", instanceId);
        instanceMap.put("initiatorId", initiatorId);
        instanceMap.put("status", instanceStatus);
        root.put("instance", instanceMap);
        root.put("form", Map.of("data", form));
        Map<String, Object> taskMap = new LinkedHashMap<>();
        taskMap.put("id", taskId);
        taskMap.put("comment", comment);
        root.put("task", taskMap);
        root.put("node", Map.of("id", nodeId));
        root.put("trigger", Map.of("event", event == null ? "" : event));
        return root;
    }

    /**
     * paramsMapping 解析核心：条目支持常量 value（{to, value}，优先于 from）或 from 路径。
     * from 路径支持 instance.id / instance.initiatorId / instance.status / trigger.event /
     * form.data / form.data.&lt;field&gt; / task.id / task.comment / node.id。解析失败按 null 处理。
     * 未配置 paramsMapping 时给默认入参 {instanceId, formData}。
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> applyMapping(Object mapping, Map<String, Object> root) {
        if (!(mapping instanceof List<?>) || ((List<Object>) mapping).isEmpty()) {
            Map<String, Object> defaults = new LinkedHashMap<>();
            defaults.put("instanceId", ((Map<?, ?>) root.get("instance")).get("id"));
            defaults.put("formData", ((Map<?, ?>) ((Map<?, ?>) root.get("form")).get("data")));
            return defaults;
        }
        Map<String, Object> params = new LinkedHashMap<>();
        for (Object item : (List<Object>) mapping) {
            if (!(item instanceof Map)) continue;
            Map<String, Object> m = (Map<String, Object>) item;
            String to = str(m.get("to"));
            if (to.isBlank()) continue;
            // 常量优先：不同事件绑定不同目标时，"每个事件一条触发器 + 固定状态值"可以
            // 用常量表达，不必为每个状态单独建查询
            if (m.containsKey("value")) {
                params.put(to, m.get("value"));
            } else {
                params.put(to, walk(root, str(m.get("from"))));
            }
        }
        return params;
    }

    private Object walk(Map<String, Object> root, String path) {
        if (path == null || path.isBlank()) return null;
        Object current = root;
        for (String seg : path.split("\\.")) {
            if (!(current instanceof Map<?, ?> map)) return null;
            current = map.get(seg);
            if (current == null) return null;
        }
        return current;
    }

    /** 流程定义的全部触发目标键（"TYPE:ref"），作为 FLOW_TRIGGER 来源的发布固化清单 */
    public Set<String> targetsOfDefinition(Long definitionId) {
        WorkflowDefinition definition = workflowDefinitionRepository.findById(definitionId).orElse(null);
        if (definition == null) return Set.of();
        Set<String> targets = new LinkedHashSet<>();
        for (Map<String, Object> node : parseNodes(definition.getNodes())) {
            Map<String, Object> config = castMap(castMap(node.get("data")).get("config"));
            for (Object t : castList(config.get("triggers"))) {
                if (!(t instanceof Map)) continue;
                Map<String, Object> target = castMap(((Map<String, Object>) t).get("target"));
                String type = str(target.get("type"));
                Object ref = target.get("ref");
                if (!type.isBlank() && ref != null) targets.add(type + ":" + ref);
            }
        }
        return targets;
    }

    private List<Map<String, Object>> triggersOfNode(WorkflowDefinition definition, String nodeId) {
        for (Map<String, Object> node : parseNodes(definition.getNodes())) {
            String id = str(node.getOrDefault("id", node.get("nodeId")));
            if (!id.equals(nodeId)) continue;
            Map<String, Object> config = castMap(castMap(node.get("data")).get("config"));
            return castList(config.get("triggers"));
        }
        return List.of();
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> parseNodes(String nodesJson) {
        try {
            if (nodesJson == null || nodesJson.isEmpty()) return List.of();
            return objectMapper.readValue(nodesJson,
                    new TypeReference<List<Map<String, Object>>>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseJson(String json) {
        try {
            if (json == null || json.isBlank()) return Map.of();
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }

    private String str(Object o) { return o == null ? "" : String.valueOf(o); }

    private Long parsePositive(Object o) {
        try {
            long v = Long.parseLong(String.valueOf(o).trim());
            return v > 0 ? v : null;
        } catch (Exception e) {
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> castMap(Object o) { return o instanceof Map ? (Map<String, Object>) o : Map.of(); }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> castList(Object o) {
        if (!(o instanceof List<?> list)) return List.of();
        return (List<Map<String, Object>>) list.stream().filter(i -> i instanceof Map).toList();
    }

    private String toJson(Object o) {
        try { return objectMapper.writeValueAsString(o); }
        catch (Exception e) { return "{}"; }
    }
}
