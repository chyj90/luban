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
            List<Map<String, Object>> triggers = isInstanceLevelEvent(event)
                    ? triggersOfAllNodes(definition, event)
                    : triggersOfNode(definition, nodeId);
            if (triggers.isEmpty()) return;

            for (Map<String, Object> trigger : triggers) {
                String on = str(trigger.get("on"));
                if (!event.equals(on)) continue;
                Map<String, Object> target = castMap(trigger.get("target"));
                String type = str(target.get("type"));
                Object ref = target.get("ref");
                Long refId = ref instanceof Number n && n.longValue() > 0
                        ? n.longValue() : parsePositive(ref);
                if (type.isBlank() || refId == null) {
                    log.warn("触发器配置缺少 target.type/ref（或 ref 非法），忽略: node={} trigger={}", nodeId, trigger);
                    continue;
                }
                enqueue(instance, nodeId, taskId, comment, event, trigger, type, refId);
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
                         String event, Map<String, Object> trigger, String targetType, Long targetRef) {
        Map<String, Object> params = resolveParams(trigger.get("paramsMapping"), instance, taskId, nodeId, lastComment, event);
        Map<String, Object> retry = castMap(trigger.get("retry"));

        WorkflowTriggerOutbox row = new WorkflowTriggerOutbox();
        row.setInstanceId(instance.getId());
        row.setTaskId(taskId);
        row.setNodeId(nodeId);
        row.setTriggerId(str(trigger.getOrDefault("triggerId", targetType + ":" + targetRef)));
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
        row.setNextRetryAt(LocalDateTime.now());
        row.setIdempotencyKey("otb-" + java.util.UUID.randomUUID());
        outboxRepository.save(row);
        log.info("流程触发器已入队: instance={} node={} target={}:{} row={}",
                instance.getId(), nodeId, targetType, targetRef, row.getId());
    }

    /**
     * paramsMapping 解析：条目支持常量 value（{to, value}，优先于 from）或 from 路径。
     * from 路径支持 instance.id / instance.initiatorId / instance.status / trigger.event /
     * form.data / form.data.&lt;field&gt; / task.id / task.comment / node.id。解析失败按 null 处理。
     * 未配置 paramsMapping 时给默认入参 {instanceId, formData}。
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> resolveParams(Object mapping, WorkflowInstance instance,
                                              Long taskId, String nodeId, String comment, String event) {
        Map<String, Object> form = parseJson(instance.getFormData());
        if (!(mapping instanceof List<?>) || ((List<Object>) mapping).isEmpty()) {
            Map<String, Object> defaults = new LinkedHashMap<>();
            defaults.put("instanceId", instance.getId());
            defaults.put("formData", form);
            return defaults;
        }
        Map<String, Object> root = new LinkedHashMap<>();
        Map<String, Object> instanceMap = new LinkedHashMap<>();
        instanceMap.put("id", instance.getId());
        instanceMap.put("initiatorId", instance.getInitiatorId());
        instanceMap.put("status", instance.getStatus());
        root.put("instance", instanceMap);
        root.put("form", Map.of("data", form));
        Map<String, Object> taskMap = new LinkedHashMap<>();
        taskMap.put("id", taskId);
        taskMap.put("comment", comment);
        root.put("task", taskMap);
        root.put("node", Map.of("id", nodeId));
        root.put("trigger", Map.of("event", event == null ? "" : event));

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

    /** 实例级事件广播：收集全部节点上配置了该事件的触发器 */
    private List<Map<String, Object>> triggersOfAllNodes(WorkflowDefinition definition, String event) {
        List<Map<String, Object>> matched = new ArrayList<>();
        for (Map<String, Object> node : parseNodes(definition.getNodes())) {
            Map<String, Object> config = castMap(castMap(node.get("data")).get("config"));
            for (Map<String, Object> t : castList(config.get("triggers"))) {
                if (event.equals(str(t.get("on")))) {
                    matched.add(t);
                }
            }
        }
        return matched;
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
