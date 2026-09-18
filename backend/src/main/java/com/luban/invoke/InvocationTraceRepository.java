package com.luban.invoke;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface InvocationTraceRepository extends JpaRepository<InvocationTrace, Long> {

    List<InvocationTrace> findByChainIdOrderByIdAsc(String chainId);

    /** 幂等去重：同幂等键的根调用已成功过（at-least-once 重发场景） */
    boolean existsByIdempotencyKeyAndStatus(String idempotencyKey, String status);
}
