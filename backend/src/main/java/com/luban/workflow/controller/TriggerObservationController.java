package com.luban.workflow.controller;

import com.luban.entity.User;
import com.luban.security.appaccess.AppAccessService;
import com.luban.workflow.entity.WorkflowTriggerOutbox;
import com.luban.workflow.repository.WorkflowTriggerOutboxRepository;
import com.luban.workflow.service.ProcessService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 触发器链路可观测（A6）：触发器回写"静默失败"曾是最难排查的问题——
 * outbox 状态（PENDING/DISPATCHED/DEAD）、重试次数与最后错误，加上实例时间线里的
 * SKIP/SUSPENDED/FAIL 留痕，是定位断链的第一手证据。
 * 实例视图对能查看该实例的人开放；死信总览是平台级视图，需要 APPS_READ 权限。
 */
@RestController
@RequestMapping("/api/v1/workflow-observability")
@RequiredArgsConstructor
public class TriggerObservationController {

    private final WorkflowTriggerOutboxRepository outboxRepository;
    private final ProcessService processService;
    private final AppAccessService appAccessService;

    /** 某实例的全部触发器派发记录（组/顺序/状态/重试/最后错误） */
    @GetMapping("/instances/{id}/trigger-outbox")
    public List<Map<String, Object>> instanceOutbox(@PathVariable Long id, @AuthenticationPrincipal User user) {
        processService.getInstance(id, user.getId()); // 访问校验：无权查看该实例时抛错
        return outboxRepository.findByInstanceIdOrderByIdAsc(id).stream()
                .map(TriggerObservationController::toMap)
                .toList();
    }

    /** 最近死信（DEAD）：重试耗尽仍失败的回写，需要人工介入（平台级视图） */
    @GetMapping("/trigger-outbox/dead")
    public List<Map<String, Object>> deadLetters(@AuthenticationPrincipal User user,
                                                 @RequestParam(defaultValue = "50") int top) {
        appAccessService.assertPlatformPermission(user.getId(), com.luban.constant.Permissions.APPS_READ);
        return outboxRepository.findTop50ByStatusOrderByIdDesc("DEAD").stream()
                .limit(Math.max(1, Math.min(top, 200)))
                .map(TriggerObservationController::toMap)
                .toList();
    }

    private static Map<String, Object> toMap(WorkflowTriggerOutbox row) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", row.getId());
        m.put("instanceId", row.getInstanceId());
        m.put("nodeId", row.getNodeId());
        m.put("triggerId", row.getTriggerId());
        m.put("targetType", row.getTargetType());
        m.put("targetRef", row.getTargetRef());
        m.put("groupId", row.getGroupId());
        m.put("groupOrder", row.getGroupOrder());
        m.put("status", row.getStatus());
        m.put("attempts", row.getAttempts());
        m.put("maxAttempts", row.getMaxAttempts());
        m.put("minAffectedRows", row.getMinAffectedRows());
        m.put("lastError", row.getLastError());
        m.put("createdAt", row.getCreatedAt());
        m.put("nextRetryAt", row.getNextRetryAt());
        m.put("dispatchedAt", row.getDispatchedAt());
        return m;
    }
}
