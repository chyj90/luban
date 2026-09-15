package com.luban.invoke;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface InvocationTraceRepository extends JpaRepository<InvocationTrace, Long> {

    List<InvocationTrace> findByChainIdOrderByIdAsc(String chainId);
}
