package com.luban.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.AgentConfig;
import com.luban.entity.Concept;
import com.luban.entity.ConceptFeedback;
import com.luban.entity.ConceptJoinMapping;
import com.luban.entity.ConceptMapping;
import com.luban.entity.ConceptRelation;
import com.luban.entity.PipelineStage;
import com.luban.entity.PipelineTrace;
import com.luban.entity.ToolConcept;
import com.luban.repository.ConceptFeedbackRepository;
import com.luban.repository.ConceptJoinMappingRepository;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptRelationRepository;
import com.luban.repository.ConceptRepository;
import com.luban.repository.PipelineStageRepository;
import com.luban.repository.PipelineTraceRepository;
import com.luban.repository.ToolConceptRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

@Slf4j
@Service
public class ConceptFeedbackService {

    private static final Duration LLM_TIMEOUT = Duration.ofSeconds(60);

    private final ConceptFeedbackRepository feedbackRepository;
    private final ConceptRepository conceptRepository;
    private final ConceptMappingRepository conceptMappingRepository;
    private final ConceptJoinMappingRepository conceptJoinMappingRepository;
    private final ConceptRelationRepository conceptRelationRepository;
    private final ToolConceptRepository toolConceptRepository;
    private final PipelineTraceRepository pipelineTraceRepository;
    private final PipelineStageRepository pipelineStageRepository;
    private final AgentConfigService agentConfigService;
    private final OntologyService ontologyService;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newHttpClient();

    public ConceptFeedbackService(ConceptFeedbackRepository feedbackRepository,
                                  ConceptRepository conceptRepository,
                                  ConceptMappingRepository conceptMappingRepository,
                                  ConceptJoinMappingRepository conceptJoinMappingRepository,
                                  ConceptRelationRepository conceptRelationRepository,
                                  ToolConceptRepository toolConceptRepository,
                                  PipelineTraceRepository pipelineTraceRepository,
                                  PipelineStageRepository pipelineStageRepository,
                                  AgentConfigService agentConfigService,
                                  OntologyService ontologyService) {
        this.feedbackRepository = feedbackRepository;
        this.conceptRepository = conceptRepository;
        this.conceptMappingRepository = conceptMappingRepository;
        this.conceptJoinMappingRepository = conceptJoinMappingRepository;
        this.conceptRelationRepository = conceptRelationRepository;
        this.toolConceptRepository = toolConceptRepository;
        this.pipelineTraceRepository = pipelineTraceRepository;
        this.pipelineStageRepository = pipelineStageRepository;
        this.agentConfigService = agentConfigService;
        this.ontologyService = ontologyService;
    }

    @Transactional(readOnly = true)
    public List<ConceptFeedback> listBySession(String sessionId) {
        return feedbackRepository.findBySessionId(sessionId);
    }

    @Transactional(readOnly = true)
    public List<ConceptFeedback> listByStatus(String status) {
        return feedbackRepository.findByStatus(status);
    }

    @Transactional(readOnly = true)
    public List<ConceptFeedback> listAll() {
        return feedbackRepository.findAll();
    }

    @Transactional(readOnly = true)
    public ConceptFeedback getById(Long id) {
        return feedbackRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("反馈记录不存在: " + id));
    }

    @Transactional
    public ConceptFeedback ignore(Long id, String reviewedBy, String reviewComment) {
        ConceptFeedback feedback = feedbackRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("反馈记录不存在: " + id));
        feedback.setStatus("ignored");
        feedback.setReviewedBy(reviewedBy);
        feedback.setReviewComment(reviewComment);
        feedback.setReviewedAt(LocalDateTime.now());
        return feedbackRepository.save(feedback);
    }

    @Transactional
    public ConceptFeedback createProblemFeedback(String sessionId, String messageId,
                                                   String pipelineId, String userDescription) {
        ConceptFeedback feedback = new ConceptFeedback();
        feedback.setSessionId(sessionId);
        feedback.setMessageId(messageId);
        feedback.setPipelineId(pipelineId);
        feedback.setUserDescription(userDescription);
        feedback.setUserFeedback(userDescription);
        feedback.setFeedbackType("problem_feedback");
        feedback.setStatus("pending");

        if (pipelineId != null) {
            pipelineTraceRepository.findByPipelineId(pipelineId).ifPresent(trace -> {
                feedback.setUserQuestion(trace.getUserQuestion());
            });
        }

        return feedbackRepository.save(feedback);
    }

    @Transactional
    public ConceptFeedback confirm(Long id, boolean confirmed) {
        ConceptFeedback feedback = feedbackRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("反馈记录不存在: " + id));
        if (confirmed) {
            feedback.setStatus("confirmed");
        } else {
            feedback.setStatus("ignored");
            feedback.setReviewedAt(LocalDateTime.now());
        }
        return feedbackRepository.save(feedback);
    }

    @Transactional
    public Map<String, Object> locate(Long feedbackId) {
        ConceptFeedback feedback = feedbackRepository.findById(feedbackId)
                .orElseThrow(() -> new NoSuchElementException("反馈记录不存在: " + feedbackId));

        if (feedback.getLlmAnalysis() != null && !feedback.getLlmAnalysis().isBlank()) {
            try {
                Map<String, Object> cached = objectMapper.readValue(feedback.getLlmAnalysis(),
                        new TypeReference<Map<String, Object>>() {});
                cached.put("cached", true);
                return cached;
            } catch (Exception e) {
                log.warn("Failed to parse cached llm_analysis, re-analyzing: {}", e.getMessage());
            }
        }

        String pipelineContext = buildPipelineContext(feedback.getPipelineId());

        try {
            AgentConfig config = agentConfigService.getDefault();
            String prompt = buildLocatePrompt(feedback, pipelineContext);
            String llmResponse = callLlm(config, prompt);

            Map<String, Object> analysis = parseLocateResult(llmResponse);
            analysis.put("cached", false);

            feedback.setLlmAnalysis(objectMapper.writeValueAsString(analysis));
            feedbackRepository.save(feedback);

            return analysis;
        } catch (Exception e) {
            log.error("LLM 阶段定位失败: {}", e.getMessage());
            throw new RuntimeException("LLM 阶段定位失败: " + e.getMessage());
        }
    }

    @Transactional
    public Map<String, Object> batchAnalyze(List<Long> feedbackIds) {
        List<ConceptFeedback> feedbacks = feedbackRepository.findAllById(feedbackIds);
        if (feedbacks.isEmpty()) {
            return Map.of("summary", "无反馈记录", "patterns", List.of(), "suggestions", List.of());
        }

        StringBuilder promptBuilder = new StringBuilder();
        promptBuilder.append("你是本体调整助手，请分析以下多条反馈，找出共性问题和模式。\n\n");
        promptBuilder.append("## 反馈列表\n");

        for (int i = 0; i < feedbacks.size(); i++) {
            ConceptFeedback fb = feedbacks.get(i);
            promptBuilder.append("### 反馈 ").append(i + 1).append("\n");
            promptBuilder.append("- 用户描述: ").append(fb.getUserDescription() != null ? fb.getUserDescription() : fb.getUserFeedback()).append("\n");
            if (fb.getLlmAnalysis() != null) {
                promptBuilder.append("- LLM定位: ").append(fb.getLlmAnalysis()).append("\n");
            }
            promptBuilder.append("- 涉及概念: ").append(fb.getResolvedConcepts() != null ? fb.getResolvedConcepts() : "无").append("\n\n");
        }

        promptBuilder.append("## 输出格式\n");
        promptBuilder.append("请输出JSON：\n");
        promptBuilder.append("```json\n");
        promptBuilder.append("{\n");
        promptBuilder.append("  \"summary\": \"共性模式总结\",\n");
        promptBuilder.append("  \"patterns\": [{ \"type\": \"...\", \"conceptId\": 0, \"conceptName\": \"...\", \"count\": 0, \"commonIssue\": \"...\" }],\n");
        promptBuilder.append("  \"suggestions\": [{ \"type\": \"...\", \"params\": {}, \"reasoning\": \"...\" }]\n");
        promptBuilder.append("}\n");
        promptBuilder.append("```\n");

        try {
            AgentConfig config = agentConfigService.getDefault();
            String llmResponse = callLlm(config, promptBuilder.toString());
            return parseBatchResult(llmResponse);
        } catch (Exception e) {
            log.error("批量分析失败: {}", e.getMessage());
            throw new RuntimeException("批量分析失败: " + e.getMessage());
        }
    }

    @Transactional(readOnly = true)
    public Map<String, Object> stats(Long conceptId, Long industryId) {
        List<ConceptFeedback> allFeedback = feedbackRepository.findAll();
        long totalFeedback = allFeedback.size();

        Map<Integer, Integer> stageBreakdown = new LinkedHashMap<>();
        for (int i = 1; i <= 6; i++) {
            stageBreakdown.put(i, 0);
        }

        int conceptFeedbackCount = 0;
        for (ConceptFeedback fb : allFeedback) {
            if (fb.getLlmAnalysis() != null && !fb.getLlmAnalysis().isBlank()) {
                try {
                    Map<String, Object> analysis = objectMapper.readValue(fb.getLlmAnalysis(),
                            new TypeReference<Map<String, Object>>() {});
                    @SuppressWarnings("unchecked")
                    Map<String, Object> stages = (Map<String, Object>) analysis.get("stages");
                    if (stages != null) {
                        for (Map.Entry<String, Object> entry : stages.entrySet()) {
                            try {
                                int stage = Integer.parseInt(entry.getKey());
                                stageBreakdown.merge(stage, 1, Integer::sum);
                            } catch (NumberFormatException ignored) {}
                        }
                    }
                } catch (Exception ignored) {}
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("conceptId", conceptId);
        result.put("totalFeedback", totalFeedback);
        result.put("stageBreakdown", stageBreakdown);
        return result;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> dashboard(Long industryId) {
        List<ConceptFeedback> allFeedback = feedbackRepository.findAll();
        long totalFeedback = allFeedback.size();
        long pendingCount = allFeedback.stream().filter(f -> "pending".equals(f.getStatus())).count();

        LocalDateTime oneWeekAgo = LocalDateTime.now().minusWeeks(1);
        long thisWeek = allFeedback.stream()
                .filter(f -> f.getCreatedAt() != null && f.getCreatedAt().isAfter(oneWeekAgo))
                .count();

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("totalFeedback", totalFeedback);
        summary.put("pendingCount", pendingCount);
        summary.put("thisWeek", thisWeek);

        Map<String, Object> stageHealth = new LinkedHashMap<>();
        String[] stageNames = {"问题理解", "概念匹配", "思维链", "SQL 生成", "查询执行", "最终回答"};
        for (int i = 1; i <= 6; i++) {
            Map<String, Object> stageInfo = new LinkedHashMap<>();
            stageInfo.put("stage", stageNames[i - 1]);
            stageInfo.put("total", 0);
            stageInfo.put("health", totalFeedback > 0 ? "100%" : "N/A");
            stageHealth.put(String.valueOf(i), stageInfo);
        }

        for (ConceptFeedback fb : allFeedback) {
            if (fb.getLlmAnalysis() != null && !fb.getLlmAnalysis().isBlank()) {
                try {
                    Map<String, Object> analysis = objectMapper.readValue(fb.getLlmAnalysis(),
                            new TypeReference<Map<String, Object>>() {});
                    @SuppressWarnings("unchecked")
                    Map<String, Object> stages = (Map<String, Object>) analysis.get("stages");
                    if (stages != null) {
                        for (Map.Entry<String, Object> entry : stages.entrySet()) {
                            try {
                                int stage = Integer.parseInt(entry.getKey());
                                @SuppressWarnings("unchecked")
                                Map<String, Object> stageInfo = (Map<String, Object>) stageHealth.get(String.valueOf(stage));
                                if (stageInfo != null) {
                                    int current = (int) stageInfo.get("total");
                                    stageInfo.put("total", current + 1);
                                    double health = totalFeedback > 0 ? (1.0 - (double)(current + 1) / totalFeedback) * 100 : 100;
                                    stageInfo.put("health", String.format("%.0f%%", health));
                                }
                            } catch (NumberFormatException ignored) {}
                        }
                    }
                } catch (Exception ignored) {}
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("summary", summary);
        result.put("stageHealth", stageHealth);
        return result;
    }

    /**
     * 调用 LLM 分析反馈，返回本体调整建议列表。
     */
    @Transactional
    public List<Map<String, Object>> analyzeByLlm(Long feedbackId) {
        ConceptFeedback feedback = feedbackRepository.findById(feedbackId)
                .orElseThrow(() -> new NoSuchElementException("反馈记录不存在: " + feedbackId));

        feedback.setStatus("analyzing");
        feedbackRepository.save(feedback);

        try {
            AgentConfig config = agentConfigService.getDefault();
            String prompt = buildAnalysisPrompt(feedback);
            String llmResponse = callLlm(config, prompt);

            List<Map<String, Object>> suggestions = parseSuggestions(llmResponse);

            feedback.setSuggestions(objectMapper.writeValueAsString(suggestions));
            feedback.setStatus("pending");
            feedbackRepository.save(feedback);

            return suggestions;
        } catch (Exception e) {
            log.error("LLM 分析反馈失败: {}", e.getMessage());
            feedback.setStatus("pending");
            feedbackRepository.save(feedback);
            throw new RuntimeException("LLM 分析失败: " + e.getMessage());
        }
    }

    /**
     * 预览建议变更的影响范围。
     */
    @Transactional(readOnly = true)
    public Map<String, Object> previewSuggestion(Long feedbackId, int suggestionIndex) {
        ConceptFeedback feedback = feedbackRepository.findById(feedbackId)
                .orElseThrow(() -> new NoSuchElementException("反馈记录不存在: " + feedbackId));

        List<Map<String, Object>> suggestions = parseSuggestions(feedback.getSuggestions());
        if (suggestions == null || suggestionIndex >= suggestions.size()) {
            throw new IllegalArgumentException("建议索引无效: " + suggestionIndex);
        }

        Map<String, Object> suggestion = suggestions.get(suggestionIndex);
        String type = (String) suggestion.get("type");
        @SuppressWarnings("unchecked")
        Map<String, Object> params = (Map<String, Object>) suggestion.get("params");

        Map<String, Object> preview = new LinkedHashMap<>();
        preview.put("type", type);
        preview.put("params", params);
        preview.put("impact", List.of());
        preview.put("conflicts", List.of());

        switch (type) {
            case "rename_concept" -> {
                Long conceptId = toLong(params.get("conceptId"));
                List<Map<String, Object>> affected = new ArrayList<>();
                for (ConceptMapping m : conceptMappingRepository.findByConceptId(conceptId)) {
                    affected.add(Map.of("entity", "ConceptMapping", "id", m.getId(), "table", m.getTableName()));
                }
                for (ConceptJoinMapping j : conceptJoinMappingRepository.findByConceptId(conceptId)) {
                    affected.add(Map.of("entity", "ConceptJoinMapping", "id", j.getId(), "target", j.getTargetConcept()));
                }
                for (ConceptRelation r : conceptRelationRepository.findBySourceConceptId(conceptId)) {
                    affected.add(Map.of("entity", "ConceptRelation", "id", r.getId(), "relationType", r.getRelationType()));
                }
                for (ToolConcept t : toolConceptRepository.findByConceptId(conceptId)) {
                    affected.add(Map.of("entity", "ToolConcept", "id", t.getId(), "relation", t.getRelation()));
                }
                preview.put("impact", affected);
            }
            case "update_mapping" -> {
                Long conceptId = toLong(params.get("conceptId"));
                List<ConceptMapping> mappings = conceptMappingRepository.findByConceptId(conceptId);
                List<Map<String, Object>> affected = new ArrayList<>();
                for (ConceptMapping m : mappings) {
                    affected.add(Map.of("entity", "ConceptMapping", "id", m.getId(),
                            "table", m.getTableName(), "column", m.getColumnName()));
                }
                preview.put("impact", affected);
            }
            case "add_relation" -> {
                Long sourceId = toLong(params.get("sourceConceptId"));
                Long targetId = toLong(params.get("targetConceptId"));
                List<ConceptRelation> existing = conceptRelationRepository
                        .findBySourceConceptIdAndRelationType(sourceId, (String) params.get("relationType"));
                List<Map<String, Object>> conflicts = new ArrayList<>();
                for (ConceptRelation r : existing) {
                    if (r.getTargetConceptId().equals(targetId)) {
                        conflicts.add(Map.of("entity", "ConceptRelation", "id", r.getId(),
                                "message", "已存在相同关系"));
                    }
                }
                preview.put("conflicts", conflicts);
            }
            case "update_join" -> {
                Long conceptId = toLong(params.get("conceptId"));
                List<ConceptJoinMapping> joins = conceptJoinMappingRepository.findByConceptId(conceptId);
                List<Map<String, Object>> affected = new ArrayList<>();
                for (ConceptJoinMapping j : joins) {
                    affected.add(Map.of("entity", "ConceptJoinMapping", "id", j.getId(),
                            "target", j.getTargetConcept(), "joinCondition", j.getJoinCondition()));
                }
                preview.put("impact", affected);
            }
        }
        return preview;
    }

    /**
     * 执行建议变更，修改本体并重新加载。
     */
    @Transactional
    public Map<String, Object> applySuggestion(Long feedbackId, int suggestionIndex, String reviewedBy) {
        ConceptFeedback feedback = feedbackRepository.findById(feedbackId)
                .orElseThrow(() -> new NoSuchElementException("反馈记录不存在: " + feedbackId));

        List<Map<String, Object>> suggestions = parseSuggestions(feedback.getSuggestions());
        if (suggestions == null || suggestionIndex >= suggestions.size()) {
            throw new IllegalArgumentException("建议索引无效: " + suggestionIndex);
        }

        Map<String, Object> suggestion = suggestions.get(suggestionIndex);
        String type = (String) suggestion.get("type");
        @SuppressWarnings("unchecked")
        Map<String, Object> params = (Map<String, Object>) suggestion.get("params");

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("type", type);
        result.put("applied", true);

        switch (type) {
            case "rename_concept" -> {
                Long conceptId = toLong(params.get("conceptId"));
                String newName = (String) params.get("newName");
                Concept concept = conceptRepository.findById(conceptId)
                        .orElseThrow(() -> new IllegalArgumentException("概念不存在: " + conceptId));
                concept.setName(newName);
                conceptRepository.save(concept);
                result.put("message", "概念已重命名为: " + newName);
            }
            case "update_mapping" -> {
                Long mappingId = toLong(params.get("mappingId"));
                ConceptMapping mapping = conceptMappingRepository.findById(mappingId)
                        .orElseThrow(() -> new IllegalArgumentException("映射不存在: " + mappingId));
                if (params.containsKey("tableName")) {
                    mapping.setTableName((String) params.get("tableName"));
                }
                if (params.containsKey("columnName")) {
                    mapping.setColumnName((String) params.get("columnName"));
                }
                conceptMappingRepository.save(mapping);
                result.put("message", "映射已更新");
            }
            case "add_relation" -> {
                Long sourceId = toLong(params.get("sourceConceptId"));
                Long targetId = toLong(params.get("targetConceptId"));
                ConceptRelation relation = new ConceptRelation();
                relation.setSourceConceptId(sourceId);
                relation.setTargetConceptId(targetId);
                relation.setRelationType((String) params.get("relationType"));
                conceptRelationRepository.save(relation);
                result.put("message", "关系已添加");
            }
            case "update_join" -> {
                Long joinId = toLong(params.get("joinId"));
                ConceptJoinMapping join = conceptJoinMappingRepository.findById(joinId)
                        .orElseThrow(() -> new IllegalArgumentException("JOIN 映射不存在: " + joinId));
                if (params.containsKey("joinCondition")) {
                    join.setJoinCondition((String) params.get("joinCondition"));
                }
                conceptJoinMappingRepository.save(join);
                result.put("message", "JOIN 条件已更新");
            }
            default -> {
                result.put("applied", false);
                result.put("message", "未知的建议类型: " + type);
            }
        }

        if (Boolean.TRUE.equals(result.get("applied"))) {
            feedback.setStatus("applied");
            feedback.setReviewedBy(reviewedBy);
            feedback.setReviewedAt(LocalDateTime.now());
            feedbackRepository.save(feedback);
            ontologyService.reload();
        }

        return result;
    }

    private String buildAnalysisPrompt(ConceptFeedback feedback) {
        StringBuilder sb = new StringBuilder();
        sb.append("你是本体调整助手，请根据用户反馈分析本体（概念、映射、关系）存在的问题，并给出调整建议。\n\n");
        sb.append("## 用户问题\n").append(feedback.getUserQuestion()).append("\n\n");
        sb.append("## 用户反馈\n").append(feedback.getUserFeedback()).append("\n\n");

        if (feedback.getResolvedConcepts() != null && !feedback.getResolvedConcepts().isEmpty()) {
            sb.append("## 解析的概念\n").append(feedback.getResolvedConcepts()).append("\n\n");
        }
        if (feedback.getReasoning() != null && !feedback.getReasoning().isEmpty()) {
            sb.append("## 思维链\n").append(feedback.getReasoning()).append("\n\n");
        }
        if (feedback.getGeneratedSql() != null && !feedback.getGeneratedSql().isEmpty()) {
            sb.append("## 生成的 SQL\n```sql\n").append(feedback.getGeneratedSql()).append("\n```\n\n");
        }
        if (feedback.getQueryResult() != null && !feedback.getQueryResult().isEmpty()) {
            sb.append("## 查询结果\n").append(feedback.getQueryResult()).append("\n\n");
        }

        sb.append("## 输出格式\n");
        sb.append("请以 JSON 数组格式输出建议，每个建议包含 type、description、params：\n");
        sb.append("```json\n");
        sb.append("[\n");
        sb.append("  {\n");
        sb.append("    \"type\": \"rename_concept|update_mapping|add_relation|update_join\",\n");
        sb.append("    \"description\": \"建议说明\",\n");
        sb.append("    \"params\": { \"conceptId\": 1, \"newName\": \"新名称\" }\n");
        sb.append("  }\n");
        sb.append("]\n");
        sb.append("```\n");
        sb.append("如果不需要调整，返回空数组 []。\n");

        return sb.toString();
    }

    private String callLlm(AgentConfig config, String prompt) {
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", config.getModelName());
            body.put("messages", List.of(
                    Map.of("role", "system", "content", "你是本体调整助手，只输出 JSON 格式的建议。"),
                    Map.of("role", "user", "content", prompt)
            ));
            body.put("temperature", 0.3);
            body.put("max_tokens", 2048);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(agentConfigService.normalizeChatUrl(config.getModelEndpoint())))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + agentConfigService.decrypt(config.getSecretKeyEnc()))
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                    .timeout(LLM_TIMEOUT)
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 200) {
                Map<String, Object> responseBody = objectMapper.readValue(response.body(),
                        new TypeReference<Map<String, Object>>() {});
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> choices = (List<Map<String, Object>>) responseBody.get("choices");
                if (choices != null && !choices.isEmpty()) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
                    return (String) message.get("content");
                }
            }
            log.error("LLM API error: status={}, url={}, model={}, body={}",
                    response.statusCode(), config.getModelEndpoint(), config.getModelName(), response.body());
            throw new RuntimeException("LLM API 返回状态码: " + response.statusCode());
        } catch (Exception e) {
            log.error("LLM call failed", e);
            throw new RuntimeException("LLM 调用失败: " + e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> parseSuggestions(String raw) {
        if (raw == null || raw.isBlank()) return List.of();
        try {
            String json = raw.trim();
            int start = json.indexOf('[');
            int end = json.lastIndexOf(']');
            if (start >= 0 && end > start) {
                json = json.substring(start, end + 1);
            }
            return objectMapper.readValue(json, new TypeReference<List<Map<String, Object>>>() {});
        } catch (Exception e) {
            log.warn("Failed to parse suggestions: {}", e.getMessage());
            return List.of();
        }
    }

    private Long toLong(Object value) {
        if (value instanceof Number) return ((Number) value).longValue();
        if (value instanceof String) return Long.parseLong((String) value);
        return null;
    }

    private String buildPipelineContext(String pipelineId) {
        if (pipelineId == null) return "管道数据不可用（pipelineId 为空）";

        return pipelineTraceRepository.findByPipelineId(pipelineId)
                .map(trace -> {
                    StringBuilder sb = new StringBuilder();
                    sb.append("用户问题: ").append(trace.getUserQuestion()).append("\n\n");

                    List<PipelineStage> stages = pipelineStageRepository.findByPipelineIdOrderByStageAsc(pipelineId);
                    String[] stageNames = {"问题理解", "概念匹配", "思维链", "SQL 生成", "查询执行", "最终回答"};

                    for (PipelineStage stage : stages) {
                        int idx = stage.getStage();
                        String name = idx >= 1 && idx <= 6 ? stageNames[idx - 1] : stage.getName();
                        sb.append("### ").append(idx).append(" ").append(name).append("\n");
                        if (stage.getInputJson() != null) sb.append("输入: ").append(stage.getInputJson()).append("\n");
                        if (stage.getOutputJson() != null) sb.append("输出: ").append(stage.getOutputJson()).append("\n");
                        sb.append("\n");
                    }

                    return sb.toString();
                })
                .orElse("管道数据不可用（pipelineId=" + pipelineId + " 未找到）");
    }

    private String buildLocatePrompt(ConceptFeedback feedback, String pipelineContext) {
        StringBuilder sb = new StringBuilder();
        sb.append("你是问题定位助手。用户对一次问数结果提出了反馈。请分析用户描述，对照管道各阶段的输入输出，判断问题出在哪些阶段。\n\n");
        sb.append("## 管道各阶段\n");
        sb.append(pipelineContext);
        sb.append("\n## 用户描述\n");
        sb.append(feedback.getUserDescription() != null ? feedback.getUserDescription() : feedback.getUserFeedback());
        sb.append("\n\n## 输出格式\n");
        sb.append("以 JSON 输出，只列出有问题的阶段（无问题的省略）：\n");
        sb.append("```json\n");
        sb.append("{\n");
        sb.append("  \"stages\": {\n");
        sb.append("    \"2\": { \"hasIssue\": true, \"reason\": \"概念匹配错误，应匹配营收\" },\n");
        sb.append("    \"5\": { \"hasIssue\": true, \"reason\": \"安徽数据可能异常\" }\n");
        sb.append("  },\n");
        sb.append("  \"primaryStage\": 2,\n");
        sb.append("  \"summary\": \"一句话总结\"\n");
        sb.append("}\n");
        sb.append("```\n");
        return sb.toString();
    }

    private Map<String, Object> parseLocateResult(String llmResponse) {
        try {
            String json = llmResponse.trim();
            int start = json.indexOf('{');
            int end = json.lastIndexOf('}');
            if (start >= 0 && end > start) {
                json = json.substring(start, end + 1);
            }
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            log.warn("Failed to parse locate result: {}", e.getMessage());
            Map<String, Object> fallback = new LinkedHashMap<>();
            fallback.put("stages", Map.of());
            fallback.put("primaryStage", null);
            fallback.put("summary", "LLM 定位结果解析失败，请人工判断");
            return fallback;
        }
    }

    private Map<String, Object> parseBatchResult(String llmResponse) {
        try {
            String json = llmResponse.trim();
            int start = json.indexOf('{');
            int end = json.lastIndexOf('}');
            if (start >= 0 && end > start) {
                json = json.substring(start, end + 1);
            }
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            log.warn("Failed to parse batch result: {}", e.getMessage());
            return Map.of("summary", "分析结果解析失败", "patterns", List.of(), "suggestions", List.of());
        }
    }
}