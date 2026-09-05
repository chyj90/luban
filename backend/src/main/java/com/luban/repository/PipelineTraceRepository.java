package com.luban.repository;

import com.luban.entity.PipelineTrace;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface PipelineTraceRepository extends JpaRepository<PipelineTrace, Long> {
    Optional<PipelineTrace> findByPipelineId(String pipelineId);
}