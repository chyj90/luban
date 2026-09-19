package com.luban.workflow.repository;

import com.luban.workflow.entity.WorkflowTriggerOutbox;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface WorkflowTriggerOutboxRepository extends JpaRepository<WorkflowTriggerOutbox, Long> {

    /**
     * 可派发行：到期 PENDING + 认领超时的 stale DISPATCHING（实例崩溃残留）。
     * 多副本下各实例并发扫描同一批行，实际执行前必须先走条件 UPDATE 认领。
     */
    @Query("""
           select o from WorkflowTriggerOutbox o
           where (o.status = 'PENDING' and o.nextRetryAt <= :now)
              or (o.status = 'DISPATCHING' and o.claimedAt <= :staleBefore)
           order by o.id asc
           """)
    List<WorkflowTriggerOutbox> findDispatchable(@Param("now") LocalDateTime now,
                                                 @Param("staleBefore") LocalDateTime staleBefore,
                                                 Pageable pageable);

    /** 认领（PENDING→DISPATCHING）：条件更新赢者派发，输者跳过——多副本防重复执行的核心 */
    @Modifying
    @Query("update WorkflowTriggerOutbox o set o.status = 'DISPATCHING', o.claimedAt = :now " +
           "where o.id = :id and o.status = 'PENDING'")
    int claimPendingRow(@Param("id") Long id, @Param("now") LocalDateTime now);

    /** 重认领崩溃残留（DISPATCHING 且 claimedAt 已超时）：同样条件更新，赢者派发 */
    @Modifying
    @Query("update WorkflowTriggerOutbox o set o.status = 'DISPATCHING', o.claimedAt = :now " +
           "where o.id = :id and o.status = 'DISPATCHING' and o.claimedAt <= :staleBefore")
    int reclaimStaleRow(@Param("id") Long id, @Param("now") LocalDateTime now,
                        @Param("staleBefore") LocalDateTime staleBefore);

    /** 释放认领（组门槛未就绪时归还，交还轮询队列） */
    @Modifying
    @Query("update WorkflowTriggerOutbox o set o.status = 'PENDING', o.claimedAt = null " +
           "where o.id = :id and o.status = 'DISPATCHING'")
    int releaseClaim(@Param("id") Long id);

    /** 触发器组全成员：派发门槛用它判断前序成员是否已成功 */
    List<WorkflowTriggerOutbox> findByGroupIdOrderByGroupOrderAsc(String groupId);

    /** 实例的派发记录时间线（可观测） */
    List<WorkflowTriggerOutbox> findByInstanceIdOrderByIdAsc(Long instanceId);
    void deleteByInstanceId(Long instanceId);

    /** 最近死信（可观测） */
    List<WorkflowTriggerOutbox> findTop50ByStatusOrderByIdDesc(String status);
}
