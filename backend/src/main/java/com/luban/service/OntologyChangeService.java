package com.luban.service;

import com.luban.entity.OntologyChangeLog;
import com.luban.repository.OntologyChangeLogRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class OntologyChangeService {

    private final OntologyChangeLogRepository changeLogRepository;

    @Transactional
    public OntologyChangeLog recordChange(String sessionId, String operation, String entityType,
                                          Long entityId, String beforeSnapshot, String afterSnapshot,
                                          Long operatorId, String operatorName, String triggerType,
                                          String reasoning) {
        OntologyChangeLog log = new OntologyChangeLog();
        log.setSessionId(sessionId);
        log.setChangeId(UUID.randomUUID().toString());
        log.setOperation(operation);
        log.setEntityType(entityType);
        log.setEntityId(entityId);
        log.setBeforeSnapshot(beforeSnapshot);
        log.setAfterSnapshot(afterSnapshot);
        log.setStatus("PENDING");
        log.setOperatorId(operatorId);
        log.setOperatorName(operatorName);
        log.setTriggerType(triggerType);
        log.setReasoning(reasoning);
        return changeLogRepository.save(log);
    }

    @Transactional
    public void approveChange(Long changeId) {
        changeLogRepository.findById(changeId).ifPresent(log -> {
            log.setStatus("APPROVED");
            log.setExecutedAt(LocalDateTime.now());
            changeLogRepository.save(log);
        });
    }

    @Transactional
    public void rejectChange(Long changeId) {
        changeLogRepository.findById(changeId).ifPresent(log -> {
            log.setStatus("REJECTED");
            changeLogRepository.save(log);
        });
    }

    public List<OntologyChangeLog> getSessionChanges(String sessionId) {
        return changeLogRepository.findBySessionIdOrderByCreatedAt(sessionId);
    }

    public List<OntologyChangeLog> getPendingChanges(String sessionId) {
        return changeLogRepository.findBySessionIdAndStatus(sessionId, "PENDING");
    }

    public List<OntologyChangeLog> getAllPendingChanges() {
        return changeLogRepository.findByStatusOrderByCreatedAt("PENDING");
    }
}