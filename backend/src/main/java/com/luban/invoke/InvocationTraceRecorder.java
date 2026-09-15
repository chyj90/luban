package com.luban.invoke;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** 调用审计落库：独立事务（REQUIRES_NEW），失败也要有迹可查且不回滚业务。 */
@Component
@RequiredArgsConstructor
public class InvocationTraceRecorder {

    private final InvocationTraceRepository repository;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public InvocationTrace record(InvocationTrace trace) {
        return repository.save(trace);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void complete(Long id, String status, String errorCode, String errorMessage, Long elapsedMs) {
        repository.findById(id).ifPresent(t -> {
            t.setStatus(status);
            t.setErrorCode(errorCode);
            t.setErrorMessage(trim(errorMessage));
            t.setElapsedMs(elapsedMs);
            repository.save(t);
        });
    }

    private String trim(String message) {
        if (message == null) return null;
        return message.length() > 512 ? message.substring(0, 512) : message;
    }
}
