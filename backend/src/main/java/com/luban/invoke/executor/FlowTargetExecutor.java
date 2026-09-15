package com.luban.invoke.executor;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.User;
import com.luban.invoke.ExecutionContext;
import com.luban.invoke.InvocationRequest;
import com.luban.invoke.InvocationResult;
import com.luban.invoke.TargetExecutor;
import com.luban.invoke.TargetType;
import com.luban.repository.UserRepository;
import com.luban.workflow.entity.WorkflowTask;
import com.luban.workflow.repository.WorkflowTaskRepository;
import com.luban.workflow.service.ProcessService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 流程目标执行器：编排 workflow 节点 / 流程触发器经此调用流程引擎。
 * params：{action: start|get_status|approve|reject, instanceId, formData, comment}。
 * 权限沿用流程引擎语义（发起 canSubmitWorkflow、审批 assignee 校验）。
 */
@Component
@RequiredArgsConstructor
public class FlowTargetExecutor implements TargetExecutor {

    private final ProcessService processService;
    private final UserRepository userRepository;
    private final WorkflowTaskRepository workflowTaskRepository;
    private final ObjectMapper objectMapper;

    @Override
    public TargetType support() {
        return TargetType.FLOW;
    }

    @Override
    public InvocationResult execute(InvocationRequest request, ExecutionContext ctx) {
        Long userId = ctx.getPrincipal() != null ? ctx.getPrincipal().getUserId() : null;
        if (userId == null) {
            throw new IllegalStateException("流程调用需要用户身份（on-behalf-of 或登录用户）");
        }
        String userName = userRepository.findById(userId).map(User::getAccount).orElse("unknown");

        Map<String, Object> params = request.getParams();
        String action = String.valueOf(params.getOrDefault("action", "start"));
        Long instanceId = params.get("instanceId") instanceof Number n ? n.longValue() : null;
        String comment = params.get("comment") != null ? String.valueOf(params.get("comment")) : "";

        Map<String, Object> out = new LinkedHashMap<>();
        switch (action) {
            case "start" -> {
                Object formData = params.getOrDefault("formData", Map.of());
                try {
                    var instance = processService.startProcess(request.getTargetId(),
                            objectMapper.writeValueAsString(formData), userId, userName);
                    out.put("instanceId", instance.getId());
                    out.put("status", instance.getStatus());
                } catch (Exception e) {
                    throw new RuntimeException("流程发起失败: " + e.getMessage(), e);
                }
            }
            case "get_status" -> {
                var instance = processService.getInstance(instanceId, userId);
                out.put("instanceId", instance.getId());
                out.put("status", instance.getStatus());
            }
            case "approve" -> {
                var task = pendingTaskForInstance(instanceId, userId);
                var approved = processService.approveTask(task.getId(), comment, userId, userName);
                out.put("taskId", approved.getId());
                out.put("status", approved.getStatus());
            }
            case "reject" -> {
                var task = pendingTaskForInstance(instanceId, userId);
                var rejected = processService.rejectTask(task.getId(), comment, userId, userName);
                out.put("taskId", rejected.getId());
                out.put("status", rejected.getStatus());
            }
            default -> throw new IllegalArgumentException("流程动作无效: " + action);
        }
        return InvocationResult.ok(out, 0, ctx.getTraceRowId());
    }

    private WorkflowTask pendingTaskForInstance(Long instanceId, Long userId) {
        var tasks = workflowTaskRepository.findByAssigneeIdAndInstanceId(userId, instanceId);
        return tasks.stream().filter(t -> "PENDING".equals(t.getStatus())).findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "当前用户在该流程实例下没有待审批任务（instanceId=" + instanceId + "）"));
    }
}
