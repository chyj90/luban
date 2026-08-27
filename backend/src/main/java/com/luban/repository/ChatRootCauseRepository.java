package com.luban.repository;

import com.luban.entity.ChatRootCause;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface ChatRootCauseRepository extends JpaRepository<ChatRootCause, Long> {
    Optional<ChatRootCause> findByMessageId(String messageId);
    List<ChatRootCause> findBySessionId(String sessionId);
    void deleteBySessionId(String sessionId);
}