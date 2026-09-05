package com.luban.service;

import com.luban.entity.SessionContinuation;
import com.luban.repository.SessionContinuationRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
@Slf4j
public class SessionContinuationService {

    private final SessionContinuationRepository repository;

    @Transactional(readOnly = true)
    public boolean hasPendingContinuation(String sessionId) {
        return repository.findById(sessionId)
                .map(SessionContinuation::getPendingContinuation)
                .orElse(false);
    }

    @Transactional(readOnly = true)
    public SessionContinuation getState(String sessionId) {
        return repository.findById(sessionId).orElse(null);
    }

    @Transactional
    public void markInterrupted(String sessionId, String messageId,
                                 String userQuestion, String partialResponse,
                                 String interruptReason) {
        SessionContinuation state = repository.findById(sessionId)
                .orElseGet(() -> {
                    SessionContinuation sc = new SessionContinuation();
                    sc.setSessionId(sessionId);
                    return sc;
                });

        state.setPendingContinuation(true);
        state.setLastInterruptedMessageId(messageId);
        state.setLastUserQuestion(userQuestion);
        state.setLastPartialResponse(partialResponse);
        state.setUpdatedAt(LocalDateTime.now());
        repository.save(state);
    }

    @Transactional
    public void clearContinuation(String sessionId) {
        repository.findById(sessionId).ifPresent(state -> {
            state.setPendingContinuation(false);
            state.setLastInterruptedMessageId(null);
            state.setLastUserQuestion(null);
            state.setLastPartialResponse(null);
            state.setUpdatedAt(LocalDateTime.now());
            repository.save(state);
        });
    }
}