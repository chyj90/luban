package com.luban.selftest;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AppSelfTestRunRepository extends JpaRepository<AppSelfTestRun, Long> {

    Optional<AppSelfTestRun> findByRunId(String runId);

    List<AppSelfTestRun> findByApplicationIdOrderByCreatedAtDesc(Long applicationId, Pageable pageable);

    List<AppSelfTestRun> findByApplicationIdAndStatus(Long applicationId, String status);
}
