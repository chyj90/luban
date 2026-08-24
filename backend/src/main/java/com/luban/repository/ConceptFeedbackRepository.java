package com.luban.repository;

import com.luban.entity.ConceptFeedback;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ConceptFeedbackRepository extends JpaRepository<ConceptFeedback, Long> {
    List<ConceptFeedback> findBySessionId(String sessionId);
    List<ConceptFeedback> findByStatus(String status);
}