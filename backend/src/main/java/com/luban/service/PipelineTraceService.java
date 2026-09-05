package com.luban.service;

import com.luban.entity.PipelineStage;
import com.luban.entity.PipelineTrace;
import com.luban.repository.PipelineStageRepository;
import com.luban.repository.PipelineTraceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

@Slf4j
@Service
@RequiredArgsConstructor
public class PipelineTraceService {

    private final PipelineTraceRepository pipelineTraceRepository;
    private final PipelineStageRepository pipelineStageRepository;

    @Transactional(readOnly = true)
    public PipelineTrace getByPipelineId(String pipelineId) {
        return pipelineTraceRepository.findByPipelineId(pipelineId)
                .orElseThrow(() -> new NoSuchElementException("管道不存在: " + pipelineId));
    }

    @Transactional(readOnly = true)
    public List<PipelineStage> getStages(String pipelineId) {
        return pipelineStageRepository.findByPipelineIdOrderByStageAsc(pipelineId);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getTraceWithStages(String pipelineId) {
        PipelineTrace trace = getByPipelineId(pipelineId);
        List<PipelineStage> stages = getStages(pipelineId);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("pipelineId", trace.getPipelineId());
        result.put("sessionId", trace.getSessionId());
        result.put("messageId", trace.getMessageId());
        result.put("userQuestion", trace.getUserQuestion());
        result.put("isContinued", trace.getIsContinued());
        result.put("continuationMessageId", trace.getContinuationMessageId());
        result.put("interruptReason", trace.getInterruptReason());
        result.put("createdAt", trace.getCreatedAt());

        result.put("stages", stages.stream().map(s -> {
            Map<String, Object> stageMap = new LinkedHashMap<>();
            stageMap.put("stage", s.getStage());
            stageMap.put("name", s.getName());
            stageMap.put("status", s.getStatus());
            stageMap.put("input", s.getInputJson());
            stageMap.put("output", s.getOutputJson());
            stageMap.put("detail", s.getDetailJson());
            stageMap.put("durationMs", s.getDurationMs());
            return stageMap;
        }).toList());

        return result;
    }

    @Transactional
    public PipelineTrace create(PipelineTrace trace) {
        return pipelineTraceRepository.save(trace);
    }

    @Transactional
    public PipelineStage addStage(PipelineStage stage) {
        return pipelineStageRepository.save(stage);
    }

    @Transactional
    public PipelineTrace updateInterruptInfo(String pipelineId, boolean isContinued,
                                              String continuationMessageId, String interruptReason) {
        PipelineTrace trace = getByPipelineId(pipelineId);
        trace.setIsContinued(isContinued);
        trace.setContinuationMessageId(continuationMessageId);
        trace.setInterruptReason(interruptReason);
        return pipelineTraceRepository.save(trace);
    }
}