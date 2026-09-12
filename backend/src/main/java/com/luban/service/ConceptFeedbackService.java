package com.luban.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.constant.OntologyOperationType;
import com.luban.entity.AgentConfig;
import com.luban.entity.ChatMessage;
import com.luban.entity.Concept;
import com.luban.entity.ConceptFeedback;
import com.luban.entity.ConceptJoinMapping;
import com.luban.entity.ConceptMapping;
import com.luban.entity.ConceptRelation;
import com.luban.entity.Datasource;
import com.luban.entity.OntologyChangeLog;
import com.luban.entity.OntologyGroup;
import com.luban.entity.ConceptToolBinding;
import com.luban.repository.ChatMessageRepository;
import com.luban.repository.ConceptFeedbackRepository;
import com.luban.repository.ConceptJoinMappingRepository;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptRelationRepository;
import com.luban.repository.ConceptRepository;
import com.luban.repository.DatasourceRepository;
import com.luban.repository.OntologyGroupRepository;
import com.luban.repository.ConceptToolBindingRepository;
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
import java.util.Set;

@Slf4j
@Service
public class ConceptFeedbackService {

    private static final Duration LLM_TIMEOUT = Duration.ofSeconds(60);

    private final ConceptFeedbackRepository feedbackRepository;
    private final ConceptRepository conceptRepository;
    private final ConceptMappingRepository conceptMappingRepository;
    private final ConceptJoinMappingRepository conceptJoinMappingRepository;
    private final ConceptRelationRepository conceptRelationRepository;
    private final ConceptToolBindingRepository conceptToolBindingRepository;
    private final ChatMessageRepository chatMessageRepository;
    private final AgentConfigService agentConfigService;
    private final OntologyService ontologyService;
    private final OntologyChangeService ontologyChangeService;
    private final OntologyGroupRepository ontologyGroupRepository;
    private final DatasourceRepository datasourceRepository;
    private final LlmChatClient llmChatClient;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public ConceptFeedbackService(ConceptFeedbackRepository feedbackRepository,
                                  ConceptRepository conceptRepository,
                                  ConceptMappingRepository conceptMappingRepository,
                                  ConceptJoinMappingRepository conceptJoinMappingRepository,
                                  ConceptRelationRepository conceptRelationRepository,
                                  ConceptToolBindingRepository conceptToolBindingRepository,
                                  ChatMessageRepository chatMessageRepository,
                                  AgentConfigService agentConfigService,
                                  OntologyService ontologyService,
                                  OntologyChangeService ontologyChangeService,
                                  OntologyGroupRepository ontologyGroupRepository,
                                  DatasourceRepository datasourceRepository,
                                  LlmChatClient llmChatClient) {
        this.feedbackRepository = feedbackRepository;
        this.conceptRepository = conceptRepository;
        this.conceptMappingRepository = conceptMappingRepository;
        this.conceptJoinMappingRepository = conceptJoinMappingRepository;
        this.conceptRelationRepository = conceptRelationRepository;
        this.conceptToolBindingRepository = conceptToolBindingRepository;
        this.chatMessageRepository = chatMessageRepository;
        this.agentConfigService = agentConfigService;
        this.ontologyService = ontologyService;
        this.ontologyChangeService = ontologyChangeService;
        this.ontologyGroupRepository = ontologyGroupRepository;
        this.datasourceRepository = datasourceRepository;
        this.llmChatClient = llmChatClient;
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

    public void delete(Long id) {
        if (!feedbackRepository.existsById(id)) {
            throw new NoSuchElementException("反馈记录不存在: " + id);
        }
        feedbackRepository.deleteById(id);
    }

    @Transactional
    public ConceptFeedback createProblemFeedback(String sessionId, String messageId,
                                                   String userDescription,
                                                   String userQuestion) {
        ConceptFeedback feedback = new ConceptFeedback();
        feedback.setSessionId(sessionId);
        feedback.setMessageId(messageId);
        feedback.setUserDescription(userDescription);
        feedback.setUserFeedback(userDescription);
        feedback.setFeedbackType("problem_feedback");
        feedback.setStatus("pending");

        chatMessageRepository.findByMessageIdAndRole(messageId, "user").ifPresent(userMsg -> {
            String content = userMsg.getContent();
            if (content != null && !content.isBlank()) {
                feedback.setUserQuestion(content);
            }
        });

        if (feedback.getUserQuestion() == null || feedback.getUserQuestion().isBlank()) {
            feedback.setUserQuestion(userQuestion != null ? userQuestion : "");
        }

        chatMessageRepository.findByMessageIdAndRole(messageId, "assistant").ifPresent(assistantMsg -> {
            if (assistantMsg.getContent() != null && !assistantMsg.getContent().isBlank()) {
                feedback.setLlmAnswer(assistantMsg.getContent());
            }
            if (assistantMsg.getReasoning() != null && !assistantMsg.getReasoning().isBlank()) {
                feedback.setReasoning(assistantMsg.getReasoning());
            }
            if (assistantMsg.getNl2sql() != null && !assistantMsg.getNl2sql().isBlank()) {
                try {
                    Map<String, Object> nl2sqlMap = objectMapper.readValue(assistantMsg.getNl2sql(),
                            new TypeReference<Map<String, Object>>() {});
                    Object sql = nl2sqlMap.get("sql");
                    if (sql != null && !sql.toString().isBlank()) {
                        feedback.setGeneratedSql(sql.toString());
                    }
                } catch (Exception e) {
                    log.warn("Failed to parse nl2sql from ChatMessage: {}", e.getMessage());
                }
            }
            if (assistantMsg.getConceptTrace() != null && !assistantMsg.getConceptTrace().isBlank()) {
                String resolved = extractResolvedConcepts(assistantMsg.getConceptTrace());
                if (resolved != null) {
                    feedback.setResolvedConcepts(resolved);
                }
            }
        });

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

        String pipelineContext = buildPipelineContext(feedback);

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

    private static final Pattern RESOLVED_CONCEPT_ID = Pattern.compile("\"conceptId\"\\s*:\\s*(\\d+)");

    /**
     * 反馈统计过滤。此前 stats/dashboard 的 conceptId/industryId 参数完全没被使用
     * （接口契约欺骗调用方），这里统一实现：
     * - conceptId：命中 correctConceptId 或 resolvedConcepts 中出现过的概念；
     * - industryId：命中的概念属于该行业下的任一域。
     */
    private List<ConceptFeedback> filterFeedback(Long conceptId, Long industryId) {
        List<ConceptFeedback> allFeedback = feedbackRepository.findAll();
        if (conceptId == null && industryId == null) return allFeedback;

        Set<Long> industryConceptIds = null;
        if (industryId != null) {
            Set<Long> industryGroupIds = ontologyGroupRepository.findAll().stream()
                    .filter(g -> industryId.equals(g.getIndustryId()))
                    .map(OntologyGroup::getId)
                    .collect(Collectors.toSet());
            industryConceptIds = conceptRepository.findAll().stream()
                    .filter(c -> c.getGroupId() != null && industryGroupIds.contains(c.getGroupId()))
                    .map(Concept::getId)
                    .collect(Collectors.toSet());
        }
        Set<Long> industryConceptIdsFinal = industryConceptIds;

        return allFeedback.stream()
                .filter(fb -> conceptId == null
                        || conceptId.equals(fb.getCorrectConceptId())
                        || resolvedConceptIds(fb).contains(conceptId))
                .filter(fb -> industryConceptIdsFinal == null
                        || intersects(industryConceptIdsFinal, fb))
                .toList();
    }

    private boolean intersects(Set<Long> industryConceptIds, ConceptFeedback fb) {
        if (fb.getCorrectConceptId() != null && industryConceptIds.contains(fb.getCorrectConceptId())) {
            return true;
        }
        Set<Long> resolved = resolvedConceptIds(fb);
        return resolved.stream().anyMatch(industryConceptIds::contains);
    }

    private Set<Long> resolvedConceptIds(ConceptFeedback fb) {
        if (fb.getResolvedConcepts() == null || fb.getResolvedConcepts().isBlank()) return Set.of();
        Set<Long> ids = new HashSet<>();
        Matcher m = RESOLVED_CONCEPT_ID.matcher(fb.getResolvedConcepts());
        while (m.find()) {
            try {
                ids.add(Long.parseLong(m.group(1)));
            } catch (NumberFormatException ignored) {}
        }
        return ids;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> stats(Long conceptId, Long industryId) {
        List<ConceptFeedback> filtered = filterFeedback(conceptId, industryId);
        long totalFeedback = filtered.size();

        Map<Integer, Integer> stageBreakdown = new LinkedHashMap<>();
        for (int i = 1; i <= 6; i++) {
            stageBreakdown.put(i, 0);
        }

        int conceptFeedbackCount = 0;
        for (ConceptFeedback fb : filtered) {
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
        result.put("industryId", industryId);
        result.put("totalFeedback", totalFeedback);
        result.put("stageBreakdown", stageBreakdown);
        return result;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> dashboard(Long industryId) {
        List<ConceptFeedback> allFeedback = filterFeedback(null, industryId);
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
            suggestions = enforceAtomicity(suggestions);

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
        preview.put("errors", List.of());
        preview.put("conflicts", List.of());
        preview.put("dependsOn", List.of());

        String upperType = type.toUpperCase();
        OntologyOperationType opType = OntologyOperationType.from(upperType);
        if (opType == null) {
            preview.put("errors", List.of(Map.of("message", "未知的建议类型: " + type)));
            return preview;
        }

        VirtualState virtualState = buildVirtualState(suggestions, suggestionIndex);
        List<Integer> dependsOn = computeDependsOn(upperType, params, suggestions, suggestionIndex);
        preview.put("dependsOn", dependsOn);

        List<String> validationErrors = validateSuggestionParams(upperType, params, virtualState);
        if (!validationErrors.isEmpty()) {
            List<Map<String, Object>> errors = new ArrayList<>();
            for (String err : validationErrors) {
                errors.add(Map.of("message", err));
            }
            preview.put("errors", errors);
            return preview;
        }

        switch (opType) {
            case ADD_CONCEPT -> {
                @SuppressWarnings("unchecked")
                Map<String, Object> conceptData = (Map<String, Object>) params.get("concept");
                String conceptName = conceptData != null ? (String) conceptData.get("name") : (String) params.get("conceptName");
                if (conceptName != null) {
                    List<Concept> existing = conceptRepository.findByName(conceptName);
                    List<Map<String, Object>> conflicts = new ArrayList<>();
                    if (!existing.isEmpty()) {
                        conflicts.add(Map.of("entity", "Concept", "id", existing.get(0).getId(),
                                "message", "同名概念已存在"));
                    }
                    preview.put("conflicts", conflicts);
                }
            }
            case UPDATE_CONCEPT -> {
                Long conceptId = toLong(params.get("id"));
                if (conceptId != null) {
                    List<Map<String, Object>> affected = new ArrayList<>();
                    for (ConceptMapping m : conceptMappingRepository.findByConceptId(conceptId)) {
                        affected.add(Map.of("entity", "ConceptMapping", "id", m.getId(), "table", m.getTableName()));
                    }
                    preview.put("impact", affected);
                }
            }
            case DELETE_CONCEPT -> {
                Long conceptId = toLong(params.get("conceptId"));
                if (conceptId != null) {
                    List<Map<String, Object>> affected = new ArrayList<>();
                    for (ConceptMapping m : conceptMappingRepository.findByConceptId(conceptId)) {
                        affected.add(Map.of("entity", "ConceptMapping", "id", m.getId()));
                    }
                    for (ConceptRelation r : conceptRelationRepository.findBySourceConceptId(conceptId)) {
                        affected.add(Map.of("entity", "ConceptRelation", "id", r.getId()));
                    }
                    preview.put("impact", affected);
                }
            }
            case ADD_MAPPING, UPDATE_MAPPING, DELETE_MAPPING -> {
                @SuppressWarnings("unchecked")
                Map<String, Object> mappingData = (Map<String, Object>) params.get("mapping");
                String conceptName = mappingData != null ? (String) mappingData.get("conceptName") : (String) params.get("conceptName");
                Long mappingId = mappingData != null ? toLong(mappingData.get("mappingId")) : toLong(params.get("mappingId"));
                List<Map<String, Object>> affected = new ArrayList<>();
                if (mappingId != null) {
                    conceptMappingRepository.findById(mappingId).ifPresent(m ->
                            affected.add(Map.of("entity", "ConceptMapping", "id", m.getId(),
                                    "table", m.getTableName(), "column", m.getColumnName())));
                } else if (conceptName != null) {
                    List<Concept> concepts = conceptRepository.findByName(conceptName);
                    if (!concepts.isEmpty()) {
                        for (ConceptMapping m : conceptMappingRepository.findByConceptId(concepts.get(0).getId())) {
                            affected.add(Map.of("entity", "ConceptMapping", "id", m.getId(),
                                    "table", m.getTableName(), "column", m.getColumnName()));
                        }
                    }
                }
                preview.put("impact", affected);
            }
            case ADD_RELATION -> {
                @SuppressWarnings("unchecked")
                Map<String, Object> relationData = (Map<String, Object>) params.get("relation");
                Long sourceId = relationData != null ? toLong(relationData.get("sourceConceptId")) : toLong(params.get("sourceConceptId"));
                Long targetId = relationData != null ? toLong(relationData.get("targetConceptId")) : toLong(params.get("targetConceptId"));
                String relationType = relationData != null ? (String) relationData.get("relationType") : (String) params.get("relationType");
                if (sourceId != null && relationType != null) {
                    List<ConceptRelation> existing = conceptRelationRepository.findBySourceConceptIdAndRelationType(sourceId, relationType);
                    List<Map<String, Object>> conflicts = new ArrayList<>();
                    for (ConceptRelation r : existing) {
                        if (targetId != null && r.getTargetConceptId().equals(targetId)) {
                            conflicts.add(Map.of("entity", "ConceptRelation", "id", r.getId(),
                                    "message", "已存在相同关系"));
                        }
                    }
                    preview.put("conflicts", conflicts);
                }
            }
            case UPDATE_RELATION, DELETE_RELATION -> {
                Long relationId = toLong(params.get("id"));
                if (relationId == null) relationId = toLong(params.get("relationId"));
                if (relationId != null) {
                    preview.put("impact", List.of(Map.of("entity", "ConceptRelation", "id", relationId)));
                }
            }
            case ADD_JOIN_MAPPING, UPDATE_JOIN_MAPPING, DELETE_JOIN_MAPPING -> {
                @SuppressWarnings("unchecked")
                Map<String, Object> joinData = (Map<String, Object>) params.get("joinMapping");
                String conceptName = joinData != null ? (String) joinData.get("conceptName") : (String) params.get("conceptName");
                Long joinId = joinData != null ? toLong(joinData.get("joinMappingId")) : toLong(params.get("joinMappingId"));
                List<Map<String, Object>> affected = new ArrayList<>();
                if (joinId != null) {
                    conceptJoinMappingRepository.findById(joinId).ifPresent(j ->
                            affected.add(Map.of("entity", "ConceptJoinMapping", "id", j.getId(),
                                    "target", j.getTargetConcept(), "joinCondition", j.getJoinCondition())));
                } else if (conceptName != null) {
                    List<Concept> concepts = conceptRepository.findByName(conceptName);
                    if (!concepts.isEmpty()) {
                        for (ConceptJoinMapping j : conceptJoinMappingRepository.findByConceptId(concepts.get(0).getId())) {
                            affected.add(Map.of("entity", "ConceptJoinMapping", "id", j.getId(),
                                    "target", j.getTargetConcept(), "joinCondition", j.getJoinCondition()));
                        }
                    }
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
    public Map<String, Object> applySuggestion(Long feedbackId, int suggestionIndex, String reviewedBy, Long operatorId) {
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

        String upperType = type.toUpperCase();
        OntologyOperationType opType = OntologyOperationType.from(upperType);
        if (opType == null) {
            result.put("applied", false);
            result.put("message", "未知的建议类型: " + type);
            return result;
        }

        VirtualState virtualState = buildVirtualState(suggestions, suggestionIndex);
        List<String> validationErrors = validateSuggestionParams(upperType, params, virtualState);
        if (!validationErrors.isEmpty()) {
            result.put("applied", false);
            result.put("message", "参数校验失败: " + String.join("; ", validationErrors));
            return result;
        }

        Map<String, Object> data = convertParamsToChangeData(upperType, opType, params);
        String entityType = opType.entityType();
        String afterSnapshot;
        try {
            afterSnapshot = objectMapper.writeValueAsString(data);
        } catch (Exception e) {
            result.put("applied", false);
            result.put("message", "参数序列化失败: " + e.getMessage());
            return result;
        }

        if (operatorId == null) {
            result.put("applied", false);
            result.put("message", "未获取到当前登录用户，请重新登录");
            return result;
        }

        OntologyChangeLog changeLog = ontologyChangeService.recordChange(
                feedback.getSessionId(), upperType, entityType,
                null, null, afterSnapshot,
                operatorId, reviewedBy, "feedback_suggestion",
                (String) suggestion.getOrDefault("description", ""));
        ontologyChangeService.approveChange(changeLog.getId());
        result.put("applied", true);
        result.put("message", opType.description() + "已执行");
        result.put("changeId", changeLog.getChangeId());

        if (Boolean.TRUE.equals(result.get("applied"))) {
            feedback.setStatus("applied");
            feedback.setReviewedBy(reviewedBy);
            feedback.setReviewedAt(LocalDateTime.now());
            feedbackRepository.save(feedback);
            // ADD_CONCEPT 的向量生成/FAISS 入库由 OntologyChangeService.executeAddConcept
            // 统一调度（事务提交后带向量重建），此处不再手工塞无向量的索引条目
        }

        return result;
    }

    @Transactional
    public List<Map<String, Object>> applySuggestionChain(Long feedbackId, String reviewedBy, Long operatorId) {
        ConceptFeedback feedback = feedbackRepository.findById(feedbackId)
                .orElseThrow(() -> new NoSuchElementException("反馈记录不存在: " + feedbackId));

        List<Map<String, Object>> suggestions = parseSuggestions(feedback.getSuggestions());
        if (suggestions == null || suggestions.isEmpty()) {
            throw new IllegalArgumentException("没有可应用的建议");
        }

        List<Map<String, Object>> results = new ArrayList<>();
        for (int i = 0; i < suggestions.size(); i++) {
            Map<String, Object> result = applySuggestion(feedbackId, i, reviewedBy, operatorId);
            results.add(result);
            boolean applied = Boolean.TRUE.equals(result.get("applied"));
            if (!applied) {
                throw new RuntimeException(
                        "第 " + (i + 1) + " 条建议应用失败: " + result.get("message"));
            }
        }
        return results;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> convertParamsToChangeData(String upperType, OntologyOperationType opType,
                                                           Map<String, Object> params) {
        Map<String, Object> data = new LinkedHashMap<>();
        if (opType.nested() && opType.dataKey() != null) {
            Object nested = params.get(opType.dataKey());
            if (nested instanceof Map) {
                data.put(opType.dataKey(), nested);
            } else {
                data.put(opType.dataKey(), params);
            }
        } else {
            data.putAll(params);
        }
        return data;
    }

    private static class VirtualState {
        final java.util.Set<String> conceptNames = new java.util.HashSet<>();
        final java.util.Set<String> groupDisplayNames = new java.util.HashSet<>();
        final java.util.Set<Long> datasourceIds = new java.util.HashSet<>();
        final java.util.Set<String> relationPairs = new java.util.HashSet<>();
    }

    @SuppressWarnings("unchecked")
    private VirtualState buildVirtualState(List<Map<String, Object>> suggestions, int upToIndex) {
        VirtualState vs = new VirtualState();
        for (int i = 0; i < upToIndex && i < suggestions.size(); i++) {
            Map<String, Object> s = suggestions.get(i);
            String typeStr = ((String) s.getOrDefault("type", "")).toUpperCase();
            OntologyOperationType opType = OntologyOperationType.from(typeStr);
            if (opType == null) continue;
            Map<String, Object> params = (Map<String, Object>) s.getOrDefault("params", Map.of());

            switch (opType) {
                case ADD_CONCEPT -> {
                    Map<String, Object> conceptData = (Map<String, Object>) params.get("concept");
                    if (conceptData != null) {
                        String name = (String) conceptData.get("name");
                        if (name != null) vs.conceptNames.add(name);
                        String groupName = (String) conceptData.get("groupName");
                        if (groupName != null) vs.groupDisplayNames.add(groupName);
                    }
                }
                case ADD_MAPPING, UPDATE_MAPPING -> {
                    Map<String, Object> mappingData = (Map<String, Object>) params.get("mapping");
                    if (mappingData == null) mappingData = params;
                    extractDatasourceId(mappingData, vs);
                    String conceptName = (String) mappingData.get("conceptName");
                    if (conceptName != null) vs.conceptNames.add(conceptName);
                }
                case ADD_RELATION -> {
                    Map<String, Object> relationData = (Map<String, Object>) params.get("relation");
                    if (relationData != null) {
                        String source = (String) relationData.get("sourceConceptName");
                        String target = (String) relationData.get("targetConceptName");
                        String relType = (String) relationData.get("relationType");
                        if (source != null) vs.conceptNames.add(source);
                        if (target != null) vs.conceptNames.add(target);
                        if (source != null && target != null && relType != null) {
                            vs.relationPairs.add(source + "-" + relType + "-" + target);
                        }
                    }
                }
                default -> {}
            }
        }
        return vs;
    }

    private void extractDatasourceId(Map<String, Object> data, VirtualState vs) {
        Object dsIdObj = data.get("dataSourceId");
        if (dsIdObj instanceof Number) {
            vs.datasourceIds.add(((Number) dsIdObj).longValue());
        }
    }

    @SuppressWarnings("unchecked")
    private List<Integer> computeDependsOn(String upperType, Map<String, Object> params,
                                           List<Map<String, Object>> suggestions, int currentIndex) {
        OntologyOperationType opType = OntologyOperationType.from(upperType);
        List<Integer> depends = new ArrayList<>();
        if (opType == null) return depends;

        switch (opType) {
            case ADD_MAPPING, UPDATE_MAPPING -> {
                Map<String, Object> mappingData = (Map<String, Object>) params.get("mapping");
                if (mappingData == null) mappingData = params;
                String conceptName = (String) mappingData.get("conceptName");
                if (conceptName != null && conceptRepository.findByName(conceptName).isEmpty()) {
                    for (int j = 0; j < currentIndex; j++) {
                        Map<String, Object> prev = suggestions.get(j);
                        String prevType = ((String) prev.getOrDefault("type", "")).toUpperCase();
                        if (OntologyOperationType.ADD_CONCEPT.name().equals(prevType)) {
                            Map<String, Object> prevParams = (Map<String, Object>) prev.getOrDefault("params", Map.of());
                            Map<String, Object> prevConcept = (Map<String, Object>) prevParams.get("concept");
                            if (prevConcept != null && conceptName.equals(prevConcept.get("name"))) {
                                depends.add(j);
                            }
                        }
                    }
                }
            }
            case ADD_RELATION -> {
                Map<String, Object> relationData = (Map<String, Object>) params.get("relation");
                if (relationData != null) {
                    for (String nameKey : List.of("sourceConceptName", "targetConceptName")) {
                        String conceptName = (String) relationData.get(nameKey);
                        if (conceptName != null && conceptRepository.findByName(conceptName).isEmpty()) {
                            for (int j = 0; j < currentIndex; j++) {
                                Map<String, Object> prev = suggestions.get(j);
                                String prevType = ((String) prev.getOrDefault("type", "")).toUpperCase();
                                if (OntologyOperationType.ADD_CONCEPT.name().equals(prevType)) {
                                    Map<String, Object> prevParams = (Map<String, Object>) prev.getOrDefault("params", Map.of());
                                    Map<String, Object> prevConcept = (Map<String, Object>) prevParams.get("concept");
                                    if (prevConcept != null && conceptName.equals(prevConcept.get("name"))) {
                                        if (!depends.contains(j)) depends.add(j);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            default -> {}
        }
        return depends;
    }

    @SuppressWarnings("unchecked")
    private List<String> validateSuggestionParams(String upperType, Map<String, Object> params,
                                                  VirtualState virtualState) {
        List<String> errors = new ArrayList<>();
        List<OntologyGroup> existingGroups = ontologyGroupRepository.findAll();
        List<Datasource> existingDatasources = datasourceRepository.findAll();

        OntologyOperationType opType = OntologyOperationType.from(upperType);
        if (opType == null) {
            errors.add("未知的操作类型: " + upperType);
            return errors;
        }

        List<String> atomicErrors = validateAtomicParams(opType, params);
        errors.addAll(atomicErrors);

        switch (opType) {
            case ADD_CONCEPT -> {
                Map<String, Object> conceptData = (Map<String, Object>) params.get("concept");
                if (conceptData == null) {
                    errors.add("缺少 concept 数据");
                    break;
                }
                String groupName = (String) conceptData.get("groupName");
                if (groupName != null) {
                    boolean foundInDb = existingGroups.stream()
                            .anyMatch(g -> g.getDisplayName().equals(groupName));
                    boolean foundInVs = virtualState.groupDisplayNames.contains(groupName);
                    if (!foundInDb && !foundInVs) {
                        String validNames = existingGroups.stream()
                                .map(OntologyGroup::getDisplayName)
                                .reduce((a, b) -> a + ", " + b)
                                .orElse("无");
                        errors.add("groupName \"" + groupName + "\" 不存在，已有领域: " + validNames);
                    }
                }
            }
            case ADD_MAPPING, UPDATE_MAPPING -> {
                Map<String, Object> mappingData = (Map<String, Object>) params.get("mapping");
                if (mappingData == null) {
                    mappingData = params;
                }
                validateMappingDataSource(mappingData, existingDatasources, virtualState, errors);
            }
            case ADD_RELATION -> {
                Map<String, Object> relationData = (Map<String, Object>) params.get("relation");
                if (relationData == null) {
                    break;
                }
                String sourceName = (String) relationData.get("sourceConceptName");
                String targetName = (String) relationData.get("targetConceptName");
                if (sourceName != null
                        && conceptRepository.findByName(sourceName).isEmpty()
                        && !virtualState.conceptNames.contains(sourceName)) {
                    errors.add("源概念不存在: " + sourceName);
                }
                if (targetName != null
                        && conceptRepository.findByName(targetName).isEmpty()
                        && !virtualState.conceptNames.contains(targetName)) {
                    errors.add("目标概念不存在: " + targetName);
                }
                String relationType = (String) relationData.get("relationType");
                if (relationType != null) {
                    try {
                        OntologyOperationType.BuiltinRelation.valueOf(relationType);
                    } catch (IllegalArgumentException e) {
                        String validTypes = java.util.Arrays.stream(OntologyOperationType.BuiltinRelation.values())
                                .map(Enum::name)
                                .reduce((a, b) -> a + ", " + b)
                                .orElse("");
                        errors.add("关系类型 \"" + relationType + "\" 不是内置关系类型，可选: " + validTypes);
                    }
                }
            }
        }
        return errors;
    }

    private List<String> validateAtomicParams(OntologyOperationType opType, Map<String, Object> params) {
        List<String> errors = new ArrayList<>();
        if (!opType.nested() || opType.dataKey() == null) {
            return errors;
        }
        String allowedKey = opType.dataKey();
        Set<String> extraKeys = new java.util.LinkedHashSet<>();
        for (String key : params.keySet()) {
            if (!allowedKey.equals(key)) {
                extraKeys.add(key);
            }
        }
        if (!extraKeys.isEmpty()) {
            errors.add("违反原子性: " + opType.name() + " 的 params 只允许包含 \"" + allowedKey + "\"，"
                    + "但包含了非法字段 " + extraKeys + "。"
                    + "请将每个操作拆分为独立建议（如 add_concept 只含 concept，add_mapping 单独一条）");
        }
        return errors;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> enforceAtomicity(List<Map<String, Object>> suggestions) {
        if (suggestions == null || suggestions.isEmpty()) return suggestions;

        List<Map<String, Object>> result = new ArrayList<>();
        boolean anySplit = false;

        for (Map<String, Object> suggestion : suggestions) {
            String type = (String) suggestion.get("type");
            if (type == null) {
                result.add(suggestion);
                continue;
            }
            String upperType = type.toUpperCase();
            OntologyOperationType opType = OntologyOperationType.from(upperType);
            if (opType == null || !opType.nested() || opType.dataKey() == null) {
                result.add(suggestion);
                continue;
            }

            Map<String, Object> params = (Map<String, Object>) suggestion.get("params");
            if (params == null) {
                result.add(suggestion);
                continue;
            }

            String allowedKey = opType.dataKey();
            Set<String> extraKeys = new java.util.LinkedHashSet<>();
            for (String key : params.keySet()) {
                if (!allowedKey.equals(key)) {
                    extraKeys.add(key);
                }
            }

            if (extraKeys.isEmpty()) {
                result.add(suggestion);
                continue;
            }

            anySplit = true;
            log.warn("拆分合并建议: type={}, 非法字段={}", type, extraKeys);

            Map<String, Object> primaryParams = new LinkedHashMap<>();
            primaryParams.put(allowedKey, params.get(allowedKey));
            Map<String, Object> primary = new LinkedHashMap<>(suggestion);
            primary.put("params", primaryParams);
            result.add(primary);

            for (String extraKey : extraKeys) {
                Object extraValue = params.get(extraKey);
                if (!(extraValue instanceof Map)) {
                    log.warn("跳过非法字段 {}: 值不是对象", extraKey);
                    continue;
                }
                OntologyOperationType extraOpType = resolveOperationTypeByDataKey(extraKey);
                if (extraOpType == null) {
                    log.warn("跳过非法字段 {}: 无法映射到操作类型", extraKey);
                    continue;
                }
                Map<String, Object> extraParams = new LinkedHashMap<>();
                extraParams.put(extraKey, extraValue);
                Map<String, Object> extraSuggestion = new LinkedHashMap<>();
                extraSuggestion.put("type", extraOpType.name().toLowerCase());
                extraSuggestion.put("description", "自动拆分自 " + type + " 的 " + extraKey);
                extraSuggestion.put("params", extraParams);
                result.add(extraSuggestion);
            }
        }

        if (anySplit) {
            log.info("原子性拆分完成: {} 条建议 → {} 条", suggestions.size(), result.size());
        }
        return result;
    }

    private OntologyOperationType resolveOperationTypeByDataKey(String dataKey) {
        for (OntologyOperationType t : OntologyOperationType.values()) {
            if (t.nested() && dataKey.equals(t.dataKey())) {
                if (t.name().startsWith("ADD_")) return t;
            }
        }
        return null;
    }

    private void validateMappingDataSource(Map<String, Object> mappingData,
                                           List<Datasource> existingDatasources,
                                           VirtualState virtualState,
                                           List<String> errors) {
        Object dsIdObj = mappingData.get("dataSourceId");
        if (dsIdObj instanceof Number) {
            long dsId = ((Number) dsIdObj).longValue();
            boolean foundInDb = existingDatasources.stream()
                    .anyMatch(ds -> ds.getId().equals(dsId));
            boolean foundInVs = virtualState.datasourceIds.contains(dsId);
            if (!foundInDb && !foundInVs) {
                String validIds = existingDatasources.stream()
                        .map(ds -> ds.getId() + "(" + ds.getName() + ")")
                        .reduce((a, b) -> a + ", " + b)
                        .orElse("无");
                errors.add("dataSourceId " + dsId + " 不存在，已有数据源: " + validIds);
            }
        } else if (dsIdObj == null) {
            if (!existingDatasources.isEmpty()) {
                String validIds = existingDatasources.stream()
                        .map(ds -> ds.getId() + "(" + ds.getName() + ")")
                        .reduce((a, b) -> a + ", " + b)
                        .orElse("无");
                errors.add("dataSourceId 为空，已有数据源: " + validIds);
            }
        }
    }

    private String buildAnalysisPrompt(ConceptFeedback feedback) {
        StringBuilder sb = new StringBuilder();
        sb.append("你是本体调整助手，请根据用户反馈和LLM阶段定位结果，给出可执行的本体调整建议。\n\n");
        sb.append("## 用户问题\n").append(feedback.getUserQuestion()).append("\n\n");
        sb.append("## 用户反馈\n").append(feedback.getUserFeedback()).append("\n\n");

        if (feedback.getLlmAnalysis() != null && !feedback.getLlmAnalysis().isEmpty()) {
            sb.append("## LLM 阶段定位结果\n");
            sb.append(feedback.getLlmAnalysis()).append("\n\n");
        }

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

        sb.append("## 当前行业上下文\n\n");
        sb.append("### 已有领域（groupName 必须从以下选择，不要自创）\n");
        List<OntologyGroup> groups = ontologyGroupRepository.findAll();
        if (groups.isEmpty()) {
            sb.append("（无已有领域，add_concept 时 groupName 设为 null）\n");
        } else {
            for (OntologyGroup g : groups) {
                sb.append("- displayName: \"").append(g.getDisplayName()).append("\", id: ").append(g.getId())
                  .append(", industryId: ").append(g.getIndustryId()).append("\n");
            }
        }
        sb.append("\n");

        sb.append("### 已有数据源（dataSourceId 必须从以下选择）\n");
        List<Datasource> datasources = datasourceRepository.findAll();
        if (datasources.isEmpty()) {
            sb.append("（无数据源，mapping 中 dataSourceId 设为 null）\n");
        } else {
            for (Datasource ds : datasources) {
                sb.append("- name: \"").append(ds.getName()).append("\", id: ").append(ds.getId()).append("\n");
            }
        }
        sb.append("\n");

        sb.append("## 输出格式\n");
        sb.append("请以 JSON 数组格式输出建议，每个建议包含 type、description、params。\n");
        sb.append("type 使用小写蛇形命名，params 必须包含执行该操作所需的全部参数，缺一不可。\n\n");
        sb.append("### 支持的建议类型及必需参数\n\n");
        sb.append(OntologyOperationType.toFeedbackPromptFormat());
        sb.append("### 内置关系类型\n\n");
        sb.append(OntologyOperationType.BuiltinRelation.toPromptList());
        sb.append("### 关键规则\n\n");
        sb.append("- **每条建议必须是单一原子操作，禁止合并多个操作到一条建议中**\n");
        sb.append("  - add_concept 的 params 只能包含 concept，不能同时包含 mapping 或 relation\n");
        sb.append("  - 需要添加映射时，单独输出一条 add_mapping 建议\n");
        sb.append("  - 需要添加关系时，单独输出一条 add_relation 建议\n");
        sb.append("- 如果定位结果指出概念缺失，应依次输出：add_concept → add_mapping → add_relation（如需要）\n");
        sb.append("- conceptId/mappingId/joinId 必须是数字ID，不能是概念名称\n");
        sb.append("- groupName 必须从上方已有领域列表中选择，不要自创新领域名\n");
        sb.append("- dataSourceId 必须从上方已有数据源列表中选择，不要自创\n");
        sb.append("- 如果无法确定某个ID，设为 null 并在 description 中说明需要人工补充\n");
        sb.append("- 每条建议必须可直接执行，不要输出只有 conceptName 的不完整参数\n");
        sb.append("- mappingType 为 computed 时，必须提供 computedExpr 字段\n\n");
        sb.append("```json\n");
        sb.append("[\n");
        sb.append("  {\n");
        sb.append("    \"type\": \"add_concept\",\n");
        sb.append("    \"description\": \"添加'区域'概念\",\n");

        if (!groups.isEmpty()) {
            OntologyGroup firstGroup = groups.get(0);
            sb.append("    \"params\": { \"concept\": { \"name\": \"区域\", \"description\": \"企业行政区域\", \"industryId\": ")
              .append(firstGroup.getIndustryId()).append(", \"groupName\": \"").append(firstGroup.getDisplayName()).append("\" } }\n");
        } else {
            sb.append("    \"params\": { \"concept\": { \"name\": \"区域\", \"description\": \"企业行政区域\", \"industryId\": null, \"groupName\": null } }\n");
        }

        sb.append("  },\n");
        sb.append("  {\n");
        sb.append("    \"type\": \"add_mapping\",\n");
        sb.append("    \"description\": \"为'区域'概念添加映射到CSKS.KHVPR\",\n");

        if (!datasources.isEmpty()) {
            sb.append("    \"params\": { \"mapping\": { \"conceptName\": \"区域\", \"tableName\": \"CSKS\", \"columnName\": \"KHVPR\", \"mappingType\": \"direct\", \"dataSourceId\": ")
              .append(datasources.get(0).getId()).append(" } }\n");
        } else {
            sb.append("    \"params\": { \"mapping\": { \"conceptName\": \"区域\", \"tableName\": \"CSKS\", \"columnName\": \"KHVPR\", \"mappingType\": \"direct\", \"dataSourceId\": null } }\n");
        }

        sb.append("  }\n");
        sb.append("]\n");
        sb.append("```\n");
        sb.append("如果不需要调整，返回空数组 []。\n");

        return sb.toString();
    }

    private String callLlm(AgentConfig config, String prompt) {
        List<Map<String, Object>> messages = List.of(
                Map.of("role", "system", "content", "你是问数系统的问题定位专家，只输出 JSON 格式的分析结果。"),
                Map.of("role", "user", "content", prompt));
        return llmChatClient.chat(config, messages,
                new LlmChatClient.Options(0.3, 2048, false, LLM_TIMEOUT));
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

    @SuppressWarnings("unchecked")
    private String extractResolvedConcepts(String conceptTraceJson) {
        try {
            List<Map<String, Object>> traceList = objectMapper.readValue(conceptTraceJson,
                    new TypeReference<List<Map<String, Object>>>() {});

            List<Map<String, Object>> faissConcepts = new ArrayList<>();
            List<Map<String, Object>> ontologyConcepts = new ArrayList<>();
            List<Map<String, Object>> usedConcepts = new ArrayList<>();

            for (Map<String, Object> item : traceList) {
                String type = (String) item.get("type");

                if ("pipeline".equals(type)) {
                    Map<String, Object> pipeline = (Map<String, Object>) item.get("pipeline");
                    if (pipeline != null) {
                        Map<String, Object> faiss = (Map<String, Object>) pipeline.get("faiss");
                        if (faiss != null) {
                            List<Map<String, Object>> concepts = (List<Map<String, Object>>) faiss.get("concepts");
                            if (concepts != null) faissConcepts.addAll(concepts);
                        }
                        Map<String, Object> ontology = (Map<String, Object>) pipeline.get("ontology");
                        if (ontology != null) {
                            List<Map<String, Object>> concepts = (List<Map<String, Object>>) ontology.get("concepts");
                            if (concepts != null) ontologyConcepts.addAll(concepts);
                        }
                        Map<String, Object> submitted = (Map<String, Object>) pipeline.get("submitted");
                        if (submitted != null) {
                            List<Map<String, Object>> concepts = (List<Map<String, Object>>) submitted.get("concepts");
                            if (concepts != null) {
                                for (Map<String, Object> c : concepts) {
                                    if (c.get("conceptName") != null) {
                                        ontologyConcepts.add(c);
                                    }
                                }
                            }
                        }
                    }
                } else if ("used_concepts".equals(type)) {
                    List<Map<String, Object>> concepts = (List<Map<String, Object>>) item.get("concepts");
                    if (concepts != null) usedConcepts.addAll(concepts);
                } else if (item.get("conceptName") != null) {
                    Object depth = item.get("depth");
                    if (depth instanceof Number && ((Number) depth).intValue() > 0) {
                        ontologyConcepts.add(item);
                    } else {
                        faissConcepts.add(item);
                    }
                }
            }

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("faiss", faissConcepts);
            result.put("ontology", ontologyConcepts);
            result.put("used", usedConcepts);
            return objectMapper.writeValueAsString(result);
        } catch (Exception e) {
            log.warn("Failed to extract resolved concepts from conceptTrace: {}", e.getMessage());
            return conceptTraceJson;
        }
    }

    private String buildPipelineContext(ConceptFeedback feedback) {
        StringBuilder sb = new StringBuilder();

        sb.append("### 阶段 1：问题理解\n");
        sb.append("用户原始问题: ").append(feedback.getUserQuestion() != null ? feedback.getUserQuestion() : "无").append("\n");
        sb.append("说明: 系统将用户自然语言问题传递给 LLM 进行理解。如果用户问题含糊或包含系统不认识的业务术语，问题从这里开始。\n\n");

        sb.append("### 阶段 2：概念匹配\n");
        if (feedback.getResolvedConcepts() != null && !feedback.getResolvedConcepts().isBlank()) {
            sb.append("匹配到的概念:\n").append(feedback.getResolvedConcepts()).append("\n\n");
        } else {
            sb.append("匹配到的概念: 无\n\n");
        }
        sb.append("说明: 系统通过向量检索(FAISS)和本体扩展将用户问题中的业务术语映射到预定义概念。这是最关键的阶段——如果用户提到的术语（如\"华东区\"）在本体中没有对应概念，后续所有阶段都会出错。常见问题：\n");
        sb.append("- 概念缺失：用户提到的业务术语在本体中不存在\n");
        sb.append("- 概念误匹配：向量检索返回了语义相近但含义不同的概念\n");
        sb.append("- 映射错误：概念存在但映射到了错误的表/列\n\n");

        sb.append("### 阶段 3：思维链推理\n");
        if (feedback.getReasoning() != null && !feedback.getReasoning().isBlank()) {
            String reasoning = feedback.getReasoning();
            if (reasoning.length() > 3000) {
                reasoning = reasoning.substring(0, 3000) + "\n...（推理过程过长，已截断）";
            }
            sb.append("LLM 推理过程:\n").append(reasoning).append("\n\n");
        } else {
            sb.append("LLM 推理过程: 无\n\n");
        }
        sb.append("说明: LLM 基于匹配到的概念和表结构进行推理，决定如何构造查询。如果阶段2的概念有误，推理必然基于错误前提。\n\n");

        sb.append("### 阶段 4：SQL 生成\n");
        if (feedback.getGeneratedSql() != null && !feedback.getGeneratedSql().isBlank()) {
            sb.append("生成的 SQL:\n").append(feedback.getGeneratedSql()).append("\n\n");
        } else {
            sb.append("生成的 SQL: 无\n\n");
        }
        sb.append("说明: 基于推理结果生成 SQL。SQL 错误通常是阶段2概念问题的后果——概念缺失导致 LLM 猜测字段，映射错误导致 JOIN 或 WHERE 条件错误。也可能是 LLM 推理本身的错误。\n\n");

        sb.append("### 阶段 5：查询执行\n");
        sb.append("说明: 执行生成的 SQL 并返回结果。如果 SQL 有语法错误会在此阶段失败；如果 SQL 逻辑错误（如 JOIN 条件错误、WHERE 条件不匹配实际数据），会返回空结果或错误数据。\n\n");

        sb.append("### 阶段 6：最终回答\n");
        if (feedback.getLlmAnswer() != null && !feedback.getLlmAnswer().isBlank()) {
            String answer = feedback.getLlmAnswer();
            if (answer.length() > 1000) {
                answer = answer.substring(0, 1000) + "...（回答过长，已截断）";
            }
            sb.append("LLM 最终回答:\n").append(answer).append("\n\n");
        } else {
            sb.append("LLM 最终回答: 无\n\n");
        }
        sb.append("说明: LLM 将查询结果转化为自然语言回答。如果查询返回空结果，LLM 可能错误地告知用户\"数据不存在\"或\"需要补充配置\"，而实际原因是阶段2概念缺失或阶段4 SQL 错误。\n\n");

        return sb.toString();
    }

    private String buildLocatePrompt(ConceptFeedback feedback, String pipelineContext) {
        StringBuilder sb = new StringBuilder();

        sb.append("你是问数系统的问题定位专家。用户对一次问数结果提出了反馈，你需要定位问题根因并给出本体调整建议。\n\n");

        sb.append("## 核心原则\n\n");
        sb.append("1. **追溯根因，不只看表象**：SQL 错误通常是概念匹配问题的后果。如果 SQL 中使用了错误的字段或 JOIN，先问：为什么 LLM 选了这个字段？是不是因为用户提到的业务概念在本体中缺失或映射错误？\n\n");
        sb.append("2. **概念匹配是最大根因**：用户问题中的业务术语（如\"华东区\"\"净利润\"\"同比\"）必须在本体中有对应概念。如果缺失，LLM 只能猜测，导致后续全链路错误。\n\n");
        sb.append("3. **区分配置问题与数据问题**：\n");
        sb.append("   - 配置问题（可修复）：概念缺失、映射错误、JOIN 缺失、关系缺失\n");
        sb.append("   - 数据问题（非配置）：数据库中确实没有对应数据、数据质量差\n\n");

        sb.append("## 分析步骤\n\n");
        sb.append("1. 从用户问题中提取所有业务术语，检查阶段2是否都匹配到了正确概念\n");
        sb.append("2. 如果有术语未匹配或误匹配 → 阶段2是根因，标记为 primaryStage\n");
        sb.append("3. 如果概念匹配正确但 SQL 仍有错 → 检查推理过程(阶段3)和SQL生成(阶段4)\n");
        sb.append("4. 如果 SQL 正确但结果为空 → 可能是数据问题(阶段5)，也可能是 WHERE 条件中的值不匹配实际数据(阶段4)\n");
        sb.append("5. 如果最终回答误导用户 → 阶段6有错，但根因通常在更早的阶段\n\n");

        sb.append("## 管道各阶段数据\n\n");
        sb.append(pipelineContext);

        sb.append("\n## 用户反馈\n\n");
        sb.append(feedback.getUserDescription() != null ? feedback.getUserDescription() : feedback.getUserFeedback());
        sb.append("\n\n");

        sb.append("## 输出格式\n\n");
        sb.append("以 JSON 输出：\n");
        sb.append("```json\n");
        sb.append("{\n");
        sb.append("  \"stages\": {\n");
        sb.append("    \"2\": {\n");
        sb.append("      \"hasIssue\": true,\n");
        sb.append("      \"reason\": \"用户提到'华东区'，但本体中无'区域'概念，导致LLM无法正确关联区域维度\",\n");
        sb.append("      \"suggestion\": \"添加'区域'概念，映射到CSKS.KHVPR，建立与'营收'的下钻关系\"\n");
        sb.append("    },\n");
        sb.append("    \"4\": {\n");
        sb.append("      \"hasIssue\": true,\n");
        sb.append("      \"reason\": \"因阶段2概念缺失，LLM猜测WERKS字段筛选华东区，但WERKS是编码不是名称\",\n");
        sb.append("      \"suggestion\": null\n");
        sb.append("    }\n");
        sb.append("  },\n");
        sb.append("  \"primaryStage\": 2,\n");
        sb.append("  \"summary\": \"本体缺少'区域'概念，导致华东区无法正确匹配，SQL使用了错误字段\",\n");
        sb.append("  \"ontologySuggestions\": [\n");
        sb.append("    {\"action\": \"add_concept\", \"name\": \"区域\", \"description\": \"企业按地理划分的行政区域\", \"mapping\": \"CSKS.KHVPR\", \"relation\": \"与营收建立下钻关系\"}\n");
        sb.append("  ]\n");
        sb.append("}\n");
        sb.append("```\n\n");
        sb.append("规则：\n");
        sb.append("- 只列出有问题的阶段，无问题的省略\n");
        sb.append("- primaryStage 必须是最早出错的阶段（根因），不是后果阶段\n");
        sb.append("- 如果阶段2有问题，它几乎总是 primaryStage\n");
        sb.append("- suggestion 字段：只有该阶段的问题可以通过本体调整修复时才填写，否则填 null\n");
        sb.append("- ontologySuggestions：列出具体的本体调整建议（添加概念/修改映射/添加关系），只有阶段2的问题才需要\n");

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