package com.luban.repository;

import com.luban.entity.ConceptFeedback;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

public interface ConceptFeedbackRepository extends JpaRepository<ConceptFeedback, Long> {
    List<ConceptFeedback> findBySessionId(String sessionId);
    List<ConceptFeedback> findByStatus(String status);
    List<ConceptFeedback> findByFeedbackType(String feedbackType);
    List<ConceptFeedback> findByPipelineId(String pipelineId);

    @Query("SELECT f FROM ConceptFeedback f WHERE f.llmAnalysis IS NOT NULL AND f.status IN :statuses")
    List<ConceptFeedback> findWithLlmAnalysisByStatusIn(@Param("statuses") List<String> statuses);

    @Query("SELECT COUNT(f) FROM ConceptFeedback f WHERE f.feedbackType = :type")
    long countByFeedbackType(@Param("type") String type);
}