package com.luban.repository;

import com.luban.entity.ConceptFeedback;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

public interface ConceptFeedbackRepository extends JpaRepository<ConceptFeedback, Long> {
    List<ConceptFeedback> findBySessionIdOrderByCreatedAtDesc(String sessionId);
    List<ConceptFeedback> findAllByOrderByCreatedAtDesc();
    List<ConceptFeedback> findByStatusOrderByCreatedAtDesc(String status);

    @Query("SELECT f FROM ConceptFeedback f WHERE f.sessionId = :sessionId AND f.messageId = :messageId")
    List<ConceptFeedback> findBySessionIdAndMessageId(@Param("sessionId") String sessionId,
                                                      @Param("messageId") String messageId);
}
