package com.luban.repository;

import com.luban.entity.AgentQueryLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface AgentQueryLogRepository extends JpaRepository<AgentQueryLog, Long> {

    List<AgentQueryLog> findBySessionId(String sessionId);

    AgentQueryLog findByMessageId(String messageId);

    List<AgentQueryLog> findByCreatedAtBetween(LocalDateTime start, LocalDateTime end);

    @Query("SELECT l FROM AgentQueryLog l WHERE l.createdAt >= :since ORDER BY l.createdAt DESC")
    List<AgentQueryLog> findRecentSince(@Param("since") LocalDateTime since);

    @Query("SELECT COUNT(l) FROM AgentQueryLog l WHERE l.createdAt >= :since")
    long countSince(@Param("since") LocalDateTime since);

    @Query("SELECT l.decisionType, COUNT(l) FROM AgentQueryLog l WHERE l.createdAt >= :since GROUP BY l.decisionType")
    List<Object[]> countDecisionDistribution(@Param("since") LocalDateTime since);

    @Query("SELECT AVG(l.llmLatencyMs) FROM AgentQueryLog l WHERE l.createdAt >= :since AND l.llmLatencyMs IS NOT NULL")
    Double avgLlmLatencySince(@Param("since") LocalDateTime since);

    @Query("SELECT AVG(l.executionLatencyMs) FROM AgentQueryLog l WHERE l.createdAt >= :since AND l.executionLatencyMs IS NOT NULL")
    Double avgExecutionLatencySince(@Param("since") LocalDateTime since);

    @Query("SELECT AVG(l.totalLatencyMs) FROM AgentQueryLog l WHERE l.createdAt >= :since AND l.totalLatencyMs IS NOT NULL")
    Double avgTotalLatencySince(@Param("since") LocalDateTime since);

    long countBySqlExecutedTrueAndCreatedAtAfter(LocalDateTime since);

    long countBySqlSuccessTrueAndCreatedAtAfter(LocalDateTime since);

    long countByPermissionDeniedTrueAndCreatedAtAfter(LocalDateTime since);

    long countByFeedbackGivenTrueAndCreatedAtAfter(LocalDateTime since);

    @Query(value = "SELECT COALESCE(MAX(llm_latency_ms), 0) FROM (SELECT llm_latency_ms, ROW_NUMBER() OVER (ORDER BY llm_latency_ms) AS rn, COUNT(*) OVER () AS cnt FROM agent_query_log WHERE created_at >= :since AND llm_latency_ms IS NOT NULL) t WHERE rn = CEIL(cnt * 0.95)", nativeQuery = true)
    Double p95LlmLatencySince(@Param("since") LocalDateTime since);

    @Query(value = "SELECT COALESCE(MAX(execution_latency_ms), 0) FROM (SELECT execution_latency_ms, ROW_NUMBER() OVER (ORDER BY execution_latency_ms) AS rn, COUNT(*) OVER () AS cnt FROM agent_query_log WHERE created_at >= :since AND execution_latency_ms IS NOT NULL) t WHERE rn = CEIL(cnt * 0.95)", nativeQuery = true)
    Double p95ExecutionLatencySince(@Param("since") LocalDateTime since);
}