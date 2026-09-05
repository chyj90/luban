package com.luban.repository;

import com.luban.entity.PipelineStage;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface PipelineStageRepository extends JpaRepository<PipelineStage, Long> {
    List<PipelineStage> findByPipelineIdOrderByStageAsc(String pipelineId);
    List<PipelineStage> findByPipelineId(String pipelineId);
}