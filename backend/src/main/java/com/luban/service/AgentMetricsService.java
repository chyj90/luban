package com.luban.service;

import com.luban.entity.AgentQueryLog;
import com.luban.repository.AgentQueryLogRepository;
import com.luban.repository.ConceptRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
public class AgentMetricsService {

    private final AgentQueryLogRepository queryLogRepository;
    private final FaissService faissService;
    private final ConceptRepository conceptRepository;

    public AgentMetricsService(AgentQueryLogRepository queryLogRepository,
                               FaissService faissService,
                               ConceptRepository conceptRepository) {
        this.queryLogRepository = queryLogRepository;
        this.faissService = faissService;
        this.conceptRepository = conceptRepository;
    }

    @Async
    @Transactional
    public void recordQuery(AgentQueryLog queryLog) {
        try {
            queryLogRepository.save(queryLog);
        } catch (Exception e) {
            log.error("Failed to record agent query log", e);
        }
    }

    public Map<String, Object> getOverview() {
        LocalDateTime since = LocalDateTime.now().minusDays(7);
        Map<String, Object> overview = new LinkedHashMap<>();

        long totalRequests = queryLogRepository.countSince(since);
        long sqlExecuted = queryLogRepository.countBySqlExecutedTrueAndCreatedAtAfter(since);
        long sqlSuccess = queryLogRepository.countBySqlSuccessTrueAndCreatedAtAfter(since);
        long permissionDenied = queryLogRepository.countByPermissionDeniedTrueAndCreatedAtAfter(since);
        long feedbackGiven = queryLogRepository.countByFeedbackGivenTrueAndCreatedAtAfter(since);

        Double avgLlmLatency = queryLogRepository.avgLlmLatencySince(since);
        Double avgExecLatency = queryLogRepository.avgExecutionLatencySince(since);
        Double avgTotalLatency = queryLogRepository.avgTotalLatencySince(since);

        List<Object[]> decisionDist = queryLogRepository.countDecisionDistribution(since);

        overview.put("totalRequests", totalRequests);
        overview.put("sqlExecuted", sqlExecuted);
        overview.put("sqlSuccess", sqlSuccess);
        overview.put("sqlSuccessRate", sqlExecuted > 0 ? Math.round(sqlSuccess * 10000.0 / sqlExecuted) / 100.0 : 0);
        overview.put("permissionDenied", permissionDenied);
        overview.put("feedbackGiven", feedbackGiven);
        overview.put("avgLlmLatencyMs", avgLlmLatency != null ? Math.round(avgLlmLatency) : 0);
        overview.put("avgExecutionLatencyMs", avgExecLatency != null ? Math.round(avgExecLatency) : 0);
        overview.put("avgTotalLatencyMs", avgTotalLatency != null ? Math.round(avgTotalLatency) : 0);

        Map<String, Long> decisionMap = new LinkedHashMap<>();
        for (Object[] row : decisionDist) {
            decisionMap.put((String) row[0], (Long) row[1]);
        }
        overview.put("decisionDistribution", decisionMap);

        return overview;
    }

    public List<Map<String, Object>> getConceptHealth() {
        LocalDateTime since = LocalDateTime.now().minusDays(7);
        List<AgentQueryLog> recentLogs = queryLogRepository.findRecentSince(since);

        Map<String, Map<String, Object>> conceptStats = new LinkedHashMap<>();
        for (AgentQueryLog log : recentLogs) {
            String conceptIds = log.getConceptIds();
            if (conceptIds == null || conceptIds.isEmpty()) continue;

            String[] ids = conceptIds.replaceAll("[\\[\\]\"]", "").split(",");
            for (String idStr : ids) {
                String cid = idStr.trim();
                if (cid.isEmpty()) continue;
                conceptStats.computeIfAbsent(cid, k -> {
                    Map<String, Object> stat = new LinkedHashMap<>();
                    stat.put("conceptId", cid);
                    stat.put("totalQueries", 0L);
                    stat.put("sqlSuccess", 0L);
                    stat.put("sqlTotal", 0L);
                    stat.put("feedbackCount", 0L);
                    return stat;
                });
                Map<String, Object> stat = conceptStats.get(cid);
                stat.put("totalQueries", (Long) stat.get("totalQueries") + 1);
                if (log.isSqlExecuted()) {
                    stat.put("sqlTotal", (Long) stat.get("sqlTotal") + 1);
                    if (log.isSqlSuccess()) {
                        stat.put("sqlSuccess", (Long) stat.get("sqlSuccess") + 1);
                    }
                }
                if (log.isFeedbackGiven()) {
                    stat.put("feedbackCount", (Long) stat.get("feedbackCount") + 1);
                }
            }
        }

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map.Entry<String, Map<String, Object>> entry : conceptStats.entrySet()) {
            Map<String, Object> stat = entry.getValue();
            long sqlTotal = (Long) stat.get("sqlTotal");
            stat.put("sqlSuccessRate", sqlTotal > 0 ? Math.round((Long) stat.get("sqlSuccess") * 10000.0 / sqlTotal) / 100.0 : 0);
            result.add(stat);
        }
        return result;
    }

    public List<Map<String, Object>> getRecentAnomalies() {
        LocalDateTime since = LocalDateTime.now().minusDays(7);
        List<Map<String, Object>> anomalies = new ArrayList<>();

        long total = queryLogRepository.countSince(since);
        if (total < 10) return anomalies;

        long sqlExecuted = queryLogRepository.countBySqlExecutedTrueAndCreatedAtAfter(since);
        long sqlSuccess = queryLogRepository.countBySqlSuccessTrueAndCreatedAtAfter(since);
        if (sqlExecuted > 0) {
            double rate = (double) sqlSuccess / sqlExecuted;
            if (rate < 0.85) {
                anomalies.add(Map.of(
                        "type", "sql_success_rate_low",
                        "level", "warning",
                        "message", "SQL 成功率低于 85%: " + Math.round(rate * 10000) / 100.0 + "%",
                        "detail", "SQL 执行 " + sqlExecuted + " 次，成功 " + sqlSuccess + " 次",
                        "time", LocalDateTime.now().toString()
                ));
            }
        }

        Double p95Llm = queryLogRepository.p95LlmLatencySince(since);
        if (p95Llm != null && p95Llm > 5000) {
            anomalies.add(Map.of(
                    "type", "llm_latency_high",
                    "level", "warning",
                    "message", "LLM P95 延迟超过 5s: " + Math.round(p95Llm) + "ms",
                    "detail", "LLM 响应时间过长，可能影响用户体验",
                    "time", LocalDateTime.now().toString()
            ));
        }

        Double p95Exec = queryLogRepository.p95ExecutionLatencySince(since);
        if (p95Exec != null && p95Exec > 10000) {
            anomalies.add(Map.of(
                    "type", "execution_latency_high",
                    "level", "warning",
                    "message", "SQL 执行 P95 延迟超过 10s: " + Math.round(p95Exec) + "ms",
                    "detail", "数据源连接或查询性能有问题",
                    "time", LocalDateTime.now().toString()
            ));
        }

        long feedbackCount = queryLogRepository.countByFeedbackGivenTrueAndCreatedAtAfter(since);
        if (total > 0 && (double) feedbackCount / total > 0.1) {
            anomalies.add(Map.of(
                    "type", "feedback_rate_high",
                    "level", "warning",
                    "message", "用户反馈率超过 10%: " + Math.round(feedbackCount * 10000.0 / total) / 100.0 + "%",
                    "detail", "反馈 " + feedbackCount + " 条，总请求 " + total + " 次",
                    "time", LocalDateTime.now().toString()
            ));
        }

        long permissionDenied = queryLogRepository.countByPermissionDeniedTrueAndCreatedAtAfter(since);
        if (total > 0 && (double) permissionDenied / total > 0.05) {
            anomalies.add(Map.of(
                    "type", "permission_denied_rate_high",
                    "level", "info",
                    "message", "无权限拒绝率超过 5%: " + Math.round(permissionDenied * 10000.0 / total) / 100.0 + "%",
                    "detail", "拒绝 " + permissionDenied + " 次，总请求 " + total + " 次",
                    "time", LocalDateTime.now().toString()
            ));
        }

        return anomalies;
    }

    public Map<String, Object> getQueryDetail(String messageId) {
        AgentQueryLog log = queryLogRepository.findByMessageId(messageId);
        if (log == null) return Map.of("found", false);

        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("found", true);
        detail.put("sessionId", log.getSessionId());
        detail.put("messageId", log.getMessageId());
        detail.put("userQuery", log.getUserQuery());
        detail.put("decisionType", log.getDecisionType());
        detail.put("conceptIds", log.getConceptIds());
        detail.put("conceptMatchCount", log.getConceptMatchCount());
        detail.put("conceptExpandCount", log.getConceptExpandCount());
        detail.put("apiToolCount", log.getApiToolCount());
        detail.put("sqlGenerated", log.getSqlGenerated());
        detail.put("sqlExecuted", log.isSqlExecuted());
        detail.put("sqlSuccess", log.isSqlSuccess());
        detail.put("sqlError", log.getSqlError());
        detail.put("llmLatencyMs", log.getLlmLatencyMs());
        detail.put("executionLatencyMs", log.getExecutionLatencyMs());
        detail.put("totalLatencyMs", log.getTotalLatencyMs());
        detail.put("permissionDenied", log.isPermissionDenied());
        detail.put("feedbackGiven", log.isFeedbackGiven());
        detail.put("createdAt", log.getCreatedAt() != null ? log.getCreatedAt().toString() : null);
        return detail;
    }

    public Map<String, Object> getFaissHealth() {
        Map<String, Object> health = new LinkedHashMap<>();

        long totalConcepts = conceptRepository.count();
        long embeddedCount = conceptRepository.countByEmbeddingIsNotNull();
        double coverage = totalConcepts > 0
                ? Math.round(embeddedCount * 10000.0 / totalConcepts) / 100.0 : 0;

        boolean isHealthy = faissService.isHealthy();
        int indexCount = faissService.getIndexCount();

        health.put("totalConcepts", totalConcepts);
        health.put("embeddedCount", embeddedCount);
        health.put("embeddingCoverage", coverage);
        health.put("indexes", indexCount);
        health.put("isHealthy", isHealthy);
        health.put("lastRebuild", faissService.getLastRebuildTime());

        return health;
    }
}