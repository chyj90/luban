package com.luban.workflow.repository;

import com.luban.workflow.entity.WorkflowTriggerOutbox;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;

public interface WorkflowTriggerOutboxRepository extends JpaRepository<WorkflowTriggerOutbox, Long> {

    List<WorkflowTriggerOutbox> findTop20ByStatusAndNextRetryAtBeforeOrderByIdAsc(
            String status, LocalDateTime before);

    /** 触发器组全成员：派发门槛用它判断前序成员是否已成功 */
    List<WorkflowTriggerOutbox> findByGroupIdOrderByGroupOrderAsc(String groupId);

    /** 实例的派发记录时间线（可观测） */
    List<WorkflowTriggerOutbox> findByInstanceIdOrderByIdAsc(Long instanceId);
    void deleteByInstanceId(Long instanceId);

    /** 最近死信（可观测） */
    List<WorkflowTriggerOutbox> findTop50ByStatusOrderByIdDesc(String status);
}
