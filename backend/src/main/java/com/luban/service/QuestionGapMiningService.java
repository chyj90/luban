package com.luban.service;

import com.luban.embedding.EmbeddingHttpClient;
import com.luban.entity.AgentQueryLog;
import com.luban.entity.ConceptFeedback;
import com.luban.repository.AgentQueryLogRepository;
import com.luban.repository.ConceptFeedbackRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 问题洞察：从问数流量（agent_query_log）里挖语义缺口。
 *
 * 每个问题自带结果信号——是否命中概念、SQL 是否执行成功、是否被权限拦截、
 * 是否被用户点过反馈。把"没答好"的问题按高频关键词聚簇，就是下一个该内置的
 * 概念/绑定/授权的动作清单：内置内容由真实流量反推，而不是拍脑袋。
 * 关键词提取走 embedding-service 的 jieba 分词（/v1/segment）；分词服务不可用时
 * 桶统计仍然输出，仅聚簇暂缺。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class QuestionGapMiningService {

    private static final int MAX_SAMPLES_PER_TERM = 3;
    private static final int MAX_CLUSTERS = 15;
    private static final int SEGMENT_TOP_K = 10;
    private static final int MIN_TERM_DOC_FREQ = 2;

    private final AgentQueryLogRepository queryLogRepository;
    private final ConceptFeedbackRepository feedbackRepository;
    private final EmbeddingHttpClient embeddingClient = new EmbeddingHttpClient();

    @Transactional(readOnly = true)
    public Map<String, Object> mine(int days) {
        LocalDateTime since = LocalDateTime.now().minusDays(days);
        List<AgentQueryLog> logs = queryLogRepository.findByCreatedAtBetween(since, LocalDateTime.now());

        List<AgentQueryLog> noConcept = new ArrayList<>();
        List<AgentQueryLog> sqlFail = new ArrayList<>();
        List<AgentQueryLog> permDenied = new ArrayList<>();
        for (AgentQueryLog l : logs) {
            if (l.isPermissionDenied()) {
                permDenied.add(l);
                continue;
            }
            if (l.getConceptMatchCount() == 0) {
                noConcept.add(l);
            }
            if (l.isSqlExecuted() && !l.isSqlSuccess()) {
                sqlFail.add(l);
            }
        }

        // 用户标记的坏答案：数量少但可信度最高，优先看
        Set<String> flaggedKeys = new HashSet<>();
        List<ConceptFeedback> feedbacks = feedbackRepository.findAllByOrderByCreatedAtDesc().stream()
                .filter(f -> f.getCreatedAt() != null && f.getCreatedAt().isAfter(since))
                .toList();
        for (ConceptFeedback f : feedbacks) {
            if (!"ignored".equals(f.getStatus())) {
                flaggedKeys.add(f.getSessionId() + "|" + f.getMessageId());
            }
        }
        List<AgentQueryLog> flagged = logs.stream()
                .filter(l -> flaggedKeys.contains(l.getSessionId() + "|" + l.getMessageId()))
                .toList();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("windowDays", days);
        result.put("totalQuestions", logs.size());
        Map<String, Object> buckets = new LinkedHashMap<>();
        buckets.put("noConcept", noConcept.size());
        buckets.put("sqlFail", sqlFail.size());
        buckets.put("permissionDenied", permDenied.size());
        buckets.put("userFlagged", flagged.size());
        result.put("buckets", buckets);

        List<Map<String, Object>> clusters = new ArrayList<>();
        clusters.addAll(mineCluster("no-concept", "考虑新增概念或语义包（先挂到回归问题集验证）", noConcept));
        clusters.addAll(mineCluster("user-flagged", "人工排查坏答案：确认是缺概念、缺绑定还是口径错误", flagged));
        clusters.addAll(mineCluster("sql-fail", "检查相关概念的绑定与数据：SQL 执行失败", sqlFail));
        clusters.addAll(mineCluster("permission-denied", "配置角色-概念域授权（概念权限管理）", permDenied));
        clusters.sort(Comparator.comparingLong((Map<String, Object> c) -> ((Number) c.get("count")).longValue()).reversed());
        result.put("clusters", clusters.subList(0, Math.min(clusters.size(), MAX_CLUSTERS)));
        return result;
    }

    /** 对一个桶内的问题做关键词聚簇；相同问题文本去重，聚簇度量"多少种问题"而非"问了多少次" */
    private List<Map<String, Object>> mineCluster(String bucket, String action, List<AgentQueryLog> logs) {
        if (logs.isEmpty()) return List.of();

        Map<String, AgentQueryLog> uniqueQuestions = new LinkedHashMap<>();
        for (AgentQueryLog l : logs) {
            String q = l.getUserQuery() == null ? "" : l.getUserQuery().trim();
            if (!q.isEmpty()) uniqueQuestions.putIfAbsent(q, l);
        }
        if (uniqueQuestions.isEmpty()) return List.of();

        List<String> texts = new ArrayList<>(uniqueQuestions.keySet());
        List<List<String>> segmented = embeddingClient.segment(texts, SEGMENT_TOP_K);
        if (segmented == null) {
            log.warn("[gaps] 分词服务不可用，{} 桶聚簇暂缺", bucket);
            return List.of();
        }

        // term → 包含该词的独立问题集合
        Map<String, Set<String>> termDocs = new HashMap<>();
        for (int i = 0; i < texts.size() && i < segmented.size(); i++) {
            for (String term : segmented.get(i)) {
                if (term != null && !term.isBlank()) {
                    termDocs.computeIfAbsent(term, k -> new HashSet<>()).add(texts.get(i));
                }
            }
        }

        List<Map<String, Object>> clusters = new ArrayList<>();
        termDocs.entrySet().stream()
                .filter(e -> e.getValue().size() >= MIN_TERM_DOC_FREQ)
                .sorted(Map.Entry.<String, Set<String>>comparingByValue(Comparator.comparingInt(Set::size)).reversed())
                .limit(MAX_CLUSTERS)
                .forEach(e -> {
                    Map<String, Object> cluster = new LinkedHashMap<>();
                    cluster.put("bucket", bucket);
                    cluster.put("action", action);
                    cluster.put("term", e.getKey());
                    cluster.put("count", e.getValue().size());
                    List<Map<String, Object>> samples = e.getValue().stream()
                            .sorted((a, b) -> Long.compare(uniqueQuestions.get(b).getId(), uniqueQuestions.get(a).getId()))
                            .limit(MAX_SAMPLES_PER_TERM)
                            .map(q -> Map.<String, Object>of("question", q,
                                    "at", String.valueOf(uniqueQuestions.get(q).getCreatedAt())))
                            .collect(Collectors.toList());
                    cluster.put("samples", samples);
                    clusters.add(cluster);
                });
        return clusters;
    }
}
