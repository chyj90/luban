package com.luban.repository;

import com.luban.entity.AlgorithmExecutionLog;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface AlgorithmExecutionLogRepository extends JpaRepository<AlgorithmExecutionLog, Long> {
    List<AlgorithmExecutionLog> findByAlgorithmIdOrderByCreatedAtDesc(Long algorithmId);
    List<AlgorithmExecutionLog> findByAlgorithmIdOrderByCreatedAtDesc(Long algorithmId, org.springframework.data.domain.Pageable pageable);
}