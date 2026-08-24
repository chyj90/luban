package com.luban.service;

import com.luban.entity.ConceptImportLog;
import com.luban.repository.ConceptImportLogRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class ConceptImportLogService {

    private final ConceptImportLogRepository importLogRepository;

    public ConceptImportLog createLog(String industry, String source, Long targetGroupId,
            Integer totalConcepts, Integer importedCount, Integer skippedCount, String importedBy) {
        ConceptImportLog log = new ConceptImportLog();
        log.setIndustry(industry);
        log.setSource(source);
        log.setTargetGroupId(targetGroupId);
        log.setTotalConcepts(totalConcepts);
        log.setImportedCount(importedCount);
        log.setSkippedCount(skippedCount);
        log.setImportedBy(importedBy);
        return importLogRepository.save(log);
    }

    public List<ConceptImportLog> listLogs() {
        return importLogRepository.findAllByOrderByCreatedAtDesc();
    }
}