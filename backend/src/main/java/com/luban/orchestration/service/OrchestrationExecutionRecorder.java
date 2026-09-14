package com.luban.orchestration.service;

import com.luban.orchestration.entity.OrchestrationExecution;
import com.luban.orchestration.repository.OrchestrationExecutionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 编排执行记录独立事务落库。
 *
 * 必须单独成 bean：@Transactional(REQUIRES_NEW) 只有经 Spring 代理调用才生效，
 * 写成调用方内部的 private/self-invoked 方法会被静默忽略（2026-09-14 请假编排案例：
 * REQUIRES_NEW 写在 OrchestrationService 的 private 方法上未生效，workflow 节点失败
 * 把共享事务标记为 rollback-only 后，执行记录连同节点级 trace 一起回滚，排障只剩一个裸
 * UnexpectedRollbackException）。
 */
@Service
@RequiredArgsConstructor
public class OrchestrationExecutionRecorder {

    private final OrchestrationExecutionRepository executionRepository;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public OrchestrationExecution save(OrchestrationExecution exec) {
        return executionRepository.save(exec);
    }
}
