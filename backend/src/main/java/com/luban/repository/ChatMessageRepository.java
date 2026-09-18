package com.luban.repository;

import com.luban.entity.ChatMessage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface ChatMessageRepository extends JpaRepository<ChatMessage, Long> {

    List<ChatMessage> findBySessionIdOrderByCreatedAtAsc(String sessionId);

    Optional<ChatMessage> findFirstBySessionIdOrderByIdAsc(String sessionId);

    Optional<ChatMessage> findByMessageIdAndRole(String messageId, String role);

    void deleteBySessionId(String sessionId);

    int countBySessionId(String sessionId);

    @Query("select m.sessionId as sessionId, max(m.createdAt) as updatedAt, count(m.id) as messageCount "
            + "from ChatMessage m "
            + "where m.userId = :userId "
            + "group by m.sessionId "
            + "order by max(m.createdAt) desc")
    List<ChatSessionSummary> summarizeSessionsByUserId(@Param("userId") Long userId);

    @Query("select m.sessionId as sessionId, m.content as content from ChatMessage m "
            + "where m.role = 'user' and m.id in "
            + "(select min(x.id) from ChatMessage x where x.role = 'user' and x.userId = :userId group by x.sessionId)")
    List<ChatSessionTitle> findSessionTitlesByUserId(@Param("userId") Long userId);

    interface ChatSessionSummary {
        String getSessionId();

        LocalDateTime getUpdatedAt();

        Long getMessageCount();
    }

    interface ChatSessionTitle {
        String getSessionId();

        String getContent();
    }
}
