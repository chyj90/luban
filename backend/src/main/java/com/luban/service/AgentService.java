package com.luban.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.AgentConfig;
import com.luban.entity.AgentQueryLog;
import com.luban.entity.ChatMessage;
import com.luban.entity.ChatRootCause;
import com.luban.entity.Concept;
import com.luban.entity.ConceptJoinMapping;
import com.luban.entity.ConceptMapping;
import com.luban.entity.ConceptRelation;
import com.luban.entity.ToolDefinition;
import com.luban.entity.ToolGroup;
import com.luban.executor.HttpExecutor;
import com.luban.executor.McpExecutor;
import com.luban.repository.AgentConfigRepository;
import com.luban.repository.AlgorithmExecutionLogRepository;
import com.luban.repository.ChatMessageRepository;
import com.luban.repository.ChatRootCauseRepository;
import com.luban.repository.ConceptJoinMappingRepository;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptRelationRepository;
import com.luban.repository.ConceptRepository;
import com.luban.constant.OntologyOperationType;
import com.luban.constant.ToolType;
import com.luban.entity.OntologyChangeLog;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.repository.ToolGroupRepository;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.LoggerFactory;
import org.bsc.langgraph4j.CompiledGraph;
import org.bsc.langgraph4j.StateGraph;
import org.bsc.langgraph4j.action.AsyncEdgeAction;
import org.bsc.langgraph4j.action.AsyncNodeAction;
import org.bsc.langgraph4j.state.AgentState;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

@Slf4j
@Service
public class AgentService {

    private final AgentConfigRepository agentConfigRepository;
    private final AgentConfigService agentConfigService;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final ToolGroupRepository toolGroupRepository;
    private final HttpExecutor httpExecutor;
    private final McpExecutor mcpExecutor;
    private final ConceptMappingRepository conceptMappingRepository;
    private final ConceptJoinMappingRepository conceptJoinMappingRepository;
    private final ConceptRelationRepository conceptRelationRepository;
    private final ConceptRepository conceptRepository;
    private final RoleConceptPermissionService roleConceptPermissionService;
    private final DatasourceService datasourceService;
    private final AgentMetricsService agentMetricsService;
    private final ChatMessageRepository chatMessageRepository;
    private final ChatRootCauseRepository chatRootCauseRepository;
    private final CodeExecutorService codeExecutorService;
    private final OntologyChangeService ontologyChangeService;
    private final AlgorithmExecutionLogRepository algorithmExecutionLogRepository;
    private final com.luban.service.algorithm.JsonSchemaValidator jsonSchemaValidator;
    private final ContextBuilder contextBuilder;
    private final SqlExecutionService sqlExecutionService;
    private final IndustryService industryService;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final org.slf4j.Logger agentDebug = LoggerFactory.getLogger("agent-debug");
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private final ConcurrentHashMap<String, List<Map<String, Object>> > conversationHistories = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompiledGraph<AgentState>> compiledGraphs = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Deque<Long>> rateLimitBuckets = new ConcurrentHashMap<>();
    private final AtomicInteger totalCallCount = new AtomicInteger(0);
    private final Semaphore agentConcurrencySemaphore = new Semaphore(AGENT_CONCURRENT_LIMIT, true);

    private final java.util.concurrent.ScheduledExecutorService idleExecutor =
            java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "llm-idle-watchdog");
                t.setDaemon(true);
                return t;
            });

    private static final ThreadLocal<java.util.function.Consumer<String>> PROGRESS_CALLBACK = new ThreadLocal<>();
    private static final ThreadLocal<java.util.function.Consumer<String>> STREAM_CALLBACK = new ThreadLocal<>();
    private static final ThreadLocal<java.util.function.Consumer<String>> REASONING_CALLBACK = new ThreadLocal<>();
    private static final ThreadLocal<StringBuilder> LLM_REASONING_BUFFER = new ThreadLocal<>();

    private static final int MAX_ITERATIONS = 100;
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(60);
    private static final Duration LLM_IDLE_TIMEOUT = Duration.ofSeconds(60);
    private static final Duration LLM_HARD_TIMEOUT = Duration.ofSeconds(300);
    private static final long AGENT_TOTAL_TIMEOUT_MS = 180_000;
    private static final int AGENT_CONCURRENT_LIMIT = 5;

    private static final int MAX_CONCEPT_EXPAND = 20;
    private static final int MAX_CONCEPT_IDS = 10;
    private static final int MAX_API_TOOLS = 15;
    private static final int NL2SQL_TIMEOUT_SECONDS = 30;
    private static final int NL2SQL_MAX_ROWS = 1000;
    private static final int NL2SQL_MAX_RESULT_BYTES = 10 * 1024 * 1024;
    private static final int NL2SQL_MAX_RETRIES = 2;
    private static final double CONCEPT_INTERSECTION_THRESHOLD = 0.5;
    private static final int MAX_DRILL_ROUNDS = 10;

    @Value("${luban.agent.rate-limit.max-requests}")
    private int rateLimitMaxRequests;

    @Value("${luban.agent.rate-limit.window-minutes}")
    private int rateLimitWindowMinutes;

    public AgentService(AgentConfigRepository agentConfigRepository,
                        AgentConfigService agentConfigService,
                        ToolDefinitionRepository toolDefinitionRepository,
                        ToolGroupRepository toolGroupRepository,
                        HttpExecutor httpExecutor,
                        McpExecutor mcpExecutor,
                        ConceptMappingRepository conceptMappingRepository,
                        ConceptJoinMappingRepository conceptJoinMappingRepository,
                        ConceptRelationRepository conceptRelationRepository,
                        ConceptRepository conceptRepository,
                        RoleConceptPermissionService roleConceptPermissionService,
                        DatasourceService datasourceService,
                        AgentMetricsService agentMetricsService,
                        ChatMessageRepository chatMessageRepository,
                        ChatRootCauseRepository chatRootCauseRepository,
                        CodeExecutorService codeExecutorService,
                        OntologyChangeService ontologyChangeService,
                        AlgorithmExecutionLogRepository algorithmExecutionLogRepository,
                        com.luban.service.algorithm.JsonSchemaValidator jsonSchemaValidator,
                        ContextBuilder contextBuilder,
                        SqlExecutionService sqlExecutionService,
                        IndustryService industryService) {
        this.agentConfigRepository = agentConfigRepository;
        this.agentConfigService = agentConfigService;
        this.toolDefinitionRepository = toolDefinitionRepository;
        this.toolGroupRepository = toolGroupRepository;
        this.httpExecutor = httpExecutor;
        this.mcpExecutor = mcpExecutor;
        this.conceptMappingRepository = conceptMappingRepository;
        this.conceptJoinMappingRepository = conceptJoinMappingRepository;
        this.conceptRelationRepository = conceptRelationRepository;
        this.conceptRepository = conceptRepository;
        this.roleConceptPermissionService = roleConceptPermissionService;
        this.datasourceService = datasourceService;
        this.agentMetricsService = agentMetricsService;
        this.chatMessageRepository = chatMessageRepository;
        this.chatRootCauseRepository = chatRootCauseRepository;
        this.codeExecutorService = codeExecutorService;
        this.ontologyChangeService = ontologyChangeService;
        this.algorithmExecutionLogRepository = algorithmExecutionLogRepository;
        this.jsonSchemaValidator = jsonSchemaValidator;
        this.contextBuilder = contextBuilder;
        this.sqlExecutionService = sqlExecutionService;
        this.industryService = industryService;
    }

    public Map<String, Object> chat(String sessionId, String userMessage, Long userId, String userName) {
        return chat(sessionId, userMessage, userId, userName, null, null, null);
    }

    public Map<String, Object> chat(String sessionId, String userMessage, Long userId, String userName,
                                    java.util.function.Consumer<String> onProgress) {
        return chat(sessionId, userMessage, userId, userName, onProgress, null, null);
    }

    public Map<String, Object> chat(String sessionId, String userMessage, Long userId, String userName,
                                    java.util.function.Consumer<String> onProgress,
                                    java.util.function.Consumer<String> onChunk,
                                    java.util.function.Consumer<String> onReasoning) {
        String rateLimitKey = sessionId.substring(0, Math.min(sessionId.length(), 8));
        if (!checkRateLimit(rateLimitKey)) {
            Map<String, Object> limited = new LinkedHashMap<>();
            limited.put("answer", "请求过于频繁，请稍后再试。");
            limited.put("error", true);
            return limited;
        }

        long startTime = System.currentTimeMillis();
        int llmCalls = 0;
        int toolCalls = 0;
        List<Map<String, Object>> history = conversationHistories.computeIfAbsent(sessionId, k -> new ArrayList<>());
        log.info("CHAT START: sessionId={}, historySize={}", sessionId, history.size());
        if (history.isEmpty()) {
            List<Map<String, Object>> dbHistory = loadHistoryFromDb(sessionId);
            if (dbHistory != null && !dbHistory.isEmpty()) {
                history.addAll(dbHistory);
                log.info("Loaded {} messages from DB for session={}", dbHistory.size(), sessionId);
            }
        }
        history.add(Map.of("role", "user", "content", userMessage));

        AgentConfig config = agentConfigRepository.findByIsDefaultTrue()
                .orElseThrow(() -> new RuntimeException("未配置默认 Agent"));

        boolean acquired = false;
        try {
            acquired = agentConcurrencySemaphore.tryAcquire(30, java.util.concurrent.TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        if (!acquired) {
            Map<String, Object> busy = new LinkedHashMap<>();
            busy.put("answer", "系统繁忙，当前并发请求过多，请稍后再试。");
            busy.put("error", true);
            return busy;
        }

        try {
            CompiledGraph<AgentState> graph = compileReActGraph(config);
            compiledGraphs.put(sessionId, graph);

            Map<String, Object> initialState = new LinkedHashMap<>();
            initialState.put("session_id", sessionId);
            initialState.put("messages", history);
            initialState.put("iteration", 0);
            initialState.put("agent_config_id", config.getId());
            initialState.put("tier", 1);
            initialState.put("llm_call_count", 0);
            initialState.put("tool_call_count", 0);
            initialState.put("user_id", userId);
            initialState.put("user_name", userName != null ? userName : "unknown");

            Optional<AgentState> result;
            try {
                PROGRESS_CALLBACK.set(onProgress);
                STREAM_CALLBACK.set(onChunk);
                REASONING_CALLBACK.set(onReasoning);
                result = graph.invoke(initialState);
            } finally {
                PROGRESS_CALLBACK.remove();
                STREAM_CALLBACK.remove();
                REASONING_CALLBACK.remove();
            }

            Map<String, Object> finalData = result.map(AgentState::data).orElse(Map.of());
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> stateMessages = (List<Map<String, Object>>) finalData.get("messages");
            log.info("CHAT POST-GRAPH: historySize={}, stateMessagesSize={}, sameRef={}",
                    history.size(),
                    stateMessages != null ? stateMessages.size() : 0,
                    stateMessages == history);
            if (stateMessages != null && stateMessages != history) {
                history.clear();
                history.addAll(stateMessages);
            }
            llmCalls = (int) finalData.getOrDefault("llm_call_count", 0);
            toolCalls = (int) finalData.getOrDefault("tool_call_count", 0);

            // 提取实际使用的概念（LLM 在 nl2sql/final_answer 中返回的 concept_ids）
            List<Map<String, Object>> usedConcepts = new ArrayList<>();
            List<Map<String, Object>> usedConceptTrace = null;
            Map<String, Object> nl2sqlData = (Map<String, Object>) finalData.get("nl2sql");
            if (nl2sqlData != null) {
                List<?> rawIds = (List<?>) nl2sqlData.get("conceptIds");
                if (rawIds != null && !rawIds.isEmpty()) {
                    for (Object rawId : rawIds) {
                        Long cid = rawId instanceof Number ? ((Number) rawId).longValue() : null;
                        if (cid != null) {
                            conceptRepository.findById(cid).ifPresent(c -> {
                                usedConcepts.add(Map.of("conceptId", c.getId(), "conceptName", c.getName()));
                            });
                        }
                    }
                }
            }
            // 如果 nl2sql 没有 concept_ids，尝试从 final_answer 的 recognized_concept_ids 获取
            if (usedConcepts.isEmpty()) {
                List<?> recognizedIds = (List<?>) finalData.get("recognized_concept_ids");
                if (recognizedIds != null && !recognizedIds.isEmpty()) {
                    for (Object rawId : recognizedIds) {
                        Long cid = rawId instanceof Number ? ((Number) rawId).longValue() : null;
                        if (cid != null) {
                            conceptRepository.findById(cid).ifPresent(c -> {
                                usedConcepts.add(Map.of("conceptId", c.getId(), "conceptName", c.getName()));
                            });
                        }
                    }
                }
            }
            if (!usedConcepts.isEmpty()) {
                List<Map<String, Object>> conceptTrace = new ArrayList<>(
                        (List<Map<String, Object>>) finalData.getOrDefault("concept_trace", List.of()));
                conceptTrace.add(Map.of("type", "used_concepts", "concepts", usedConcepts));
                usedConceptTrace = conceptTrace;
            }

            Map<String, Object> finalAnswer = new LinkedHashMap<>();
            if (!finalData.containsKey("final_answer")) {
                log.warn("Agent finished without final_answer (session={}): next_action={}, iterations={} —— 兜底文案将替代结论",
                        sessionId, finalData.get("next_action"), finalData.getOrDefault("iteration", 0));
            }
            finalAnswer.put("answer", finalData.getOrDefault("final_answer",
                    "分析已结束，但未生成结论摘要（原因已记录日志）。请重试或换个问法。"));
            finalAnswer.put("answerType", finalData.getOrDefault("answer_type", ""));
            finalAnswer.put("rootCause", finalData.getOrDefault("root_cause", ""));
            finalAnswer.put("suggestion", finalData.getOrDefault("suggestion", ""));
            finalAnswer.put("evidence", finalData.getOrDefault("evidence", List.of()));
            finalAnswer.put("iterations", finalData.getOrDefault("iteration", 0));
            finalAnswer.put("history", history);
            finalAnswer.put("conceptTrace", usedConceptTrace != null ? usedConceptTrace : finalData.getOrDefault("concept_trace", List.of()));
            finalAnswer.put("reasoning", addChineseEnglishSpacing((String) finalData.getOrDefault("reasoning", "")));
            finalAnswer.put("llm_reasoning", addChineseEnglishSpacing((String) finalData.getOrDefault("llm_reasoning", "")));
            finalAnswer.put("llm_raw_output", addChineseEnglishSpacing((String) finalData.getOrDefault("llm_raw_output", "")));
            agentDebug.info("[FINAL] finalAnswer: reasoningLen={}, llm_reasoningLen={}, llm_raw_outputLen={}",
                    ((String) finalAnswer.get("reasoning")).length(),
                    ((String) finalAnswer.get("llm_reasoning")).length(),
                    ((String) finalAnswer.get("llm_raw_output")).length());
            finalAnswer.put("nl2sql", finalData.getOrDefault("nl2sql", null));
            Object nl2sqlForLog = finalAnswer.get("nl2sql");
            if (nl2sqlForLog instanceof Map) {
                String sqlForLog = (String) ((Map<?, ?>) nl2sqlForLog).get("sql");
                agentDebug.info("[FINAL] nl2sql in finalAnswer, sqlLen={}, sql=[{}]", sqlForLog != null ? sqlForLog.length() : 0, sqlForLog);
            }
            finalAnswer.put("queryResult", finalData.getOrDefault("query_result", null));
            finalAnswer.put("sqlExecCount", finalData.getOrDefault("sql_exec_count", 0));
            finalAnswer.put("llmCalls", finalData.getOrDefault("llm_call_count", 0));
            finalAnswer.put("messageId", finalData.getOrDefault("message_id", UUID.randomUUID().toString()));
            finalAnswer.put("usedConcepts", usedConcepts);

            long duration = System.currentTimeMillis() - startTime;
            totalCallCount.incrementAndGet();
            log.info("Agent call completed: session={}, duration={}ms, llmCalls={}, toolCalls={}, sqlExecs={}, iterations={}",
                    rateLimitKey, duration, llmCalls, toolCalls, finalData.getOrDefault("sql_exec_count", 0), finalData.getOrDefault("iteration", 0));

            asyncRecordMetrics(sessionId, finalAnswer, userMessage, duration, llmCalls, toolCalls, finalData);

            persistChatHistory(sessionId, userId, userMessage, finalAnswer, finalData);

            return finalAnswer;
        } catch (Exception e) {
            long duration = System.currentTimeMillis() - startTime;
            log.error("Agent execution failed: session={}, duration={}ms, error={}: {}",
                    rateLimitKey, duration, e.getClass().getSimpleName(), e.getMessage(), e);
            Map<String, Object> errorResult = new LinkedHashMap<>();
            errorResult.put("answer", "处理请求时出错: " + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()));
            errorResult.put("error", true);
            return errorResult;
        } finally {
            agentConcurrencySemaphore.release();
        }
    }

    @Transactional
    public void clearSession(String sessionId) {
        conversationHistories.remove(sessionId);
        compiledGraphs.remove(sessionId);
        try {
            chatMessageRepository.deleteBySessionId(sessionId);
            chatRootCauseRepository.deleteBySessionId(sessionId);
        } catch (Exception e) {
            log.warn("Failed to delete chat messages from DB for session={}: {}", sessionId, e.getMessage());
        }
    }

    private void persistChatHistory(String sessionId, Long userId, String userMessage,
                                    Map<String, Object> finalAnswer, Map<String, Object> finalData) {
        try {
            String answer = (String) finalAnswer.getOrDefault("answer",
                    finalData.getOrDefault("final_answer", ""));
            String messageId = (String) finalAnswer.get("messageId");
            String debugFromFinalData = (String) finalData.getOrDefault("final_answer", "");
            agentDebug.info("[PERSIST] answerLen={}, answerPreview={}",
                    answer != null ? answer.length() : 0,
                    answer != null ? answer.substring(0, Math.min(300, answer.length())) : "null");
            agentDebug.info("[PERSIST] finalData.final_answer preview={}",
                    debugFromFinalData != null ? debugFromFinalData.substring(0, Math.min(300, debugFromFinalData.length())) : "null");

            String conceptTraceJson = null;
            Object conceptTrace = finalAnswer.get("conceptTrace");
            if (conceptTrace != null) {
                conceptTraceJson = objectMapper.writeValueAsString(conceptTrace);
            }

            String reasoning = (String) finalAnswer.get("reasoning");
            String llmReasoning = (String) finalAnswer.get("llm_reasoning");
            agentDebug.info("[PERSIST] reasoning from finalAnswer: reasoningLen={}, llmReasoningLen={}",
                    reasoning != null ? reasoning.length() : 0,
                    llmReasoning != null ? llmReasoning.length() : 0);
            if (llmReasoning != null && !llmReasoning.isEmpty()) {
                reasoning = (reasoning != null && !reasoning.isEmpty())
                        ? llmReasoning + "\n\n---\n\n" + reasoning
                        : llmReasoning;
                agentDebug.info("[PERSIST] combined reasoning, finalLen={}", reasoning.length());
            } else {
                agentDebug.info("[PERSIST] llmReasoning empty, using reasoning only, len={}",
                        reasoning != null ? reasoning.length() : 0);
            }

            String thinking = (String) finalAnswer.get("llm_raw_output");

            String nl2sqlJson = null;
            Object nl2sql = finalAnswer.get("nl2sql");
            if (nl2sql != null) {
                nl2sqlJson = objectMapper.writeValueAsString(nl2sql);
            }

            ChatMessage userMsg = ChatMessage.builder()
                    .sessionId(sessionId)
                    .userId(userId)
                    .role("user")
                    .content(userMessage)
                    .messageId(messageId)
                    .build();
            chatMessageRepository.save(userMsg);

            ChatMessage assistantMsg = ChatMessage.builder()
                    .sessionId(sessionId)
                    .userId(userId)
                    .role("assistant")
                    .content(answer)
                    .messageId(messageId)
                    .conceptTrace(conceptTraceJson)
                    .reasoning(reasoning)
                    .thinking(thinking)
                    .nl2sql(nl2sqlJson)
                    .build();
            chatMessageRepository.save(assistantMsg);

            Object rootCause = finalAnswer.get("rootCause");
            Object suggestion = finalAnswer.get("suggestion");
            Object evidence = finalAnswer.get("evidence");
            Object answerType = finalAnswer.get("answerType");
            if ((rootCause != null && !rootCause.toString().isEmpty())
                    || (suggestion != null && !suggestion.toString().isEmpty())
                    || (evidence instanceof List && !((List<?>) evidence).isEmpty())) {
                ChatRootCause cr = ChatRootCause.builder()
                        .messageId(messageId)
                        .sessionId(sessionId)
                        .rootCause(rootCause != null ? rootCause.toString() : null)
                        .suggestion(suggestion != null ? suggestion.toString() : null)
                        .evidence(evidence != null ? objectMapper.writeValueAsString(evidence) : null)
                        .answerType(answerType != null ? answerType.toString() : null)
                        .build();
                chatRootCauseRepository.save(cr);
            }
        } catch (Exception e) {
            log.warn("Failed to persist chat history for session={}: {}", sessionId, e.getMessage());
        }
    }

    public List<Map<String, Object>> loadHistoryFromDb(String sessionId) {
        try {
            List<ChatMessage> messages = chatMessageRepository.findBySessionIdOrderByCreatedAtAsc(sessionId);
            if (messages.isEmpty()) {
                return null;
            }
            List<ChatRootCause> rootCauses = chatRootCauseRepository.findBySessionId(sessionId);
            Map<String, Map<String, Object>> rootCauseMap = new java.util.HashMap<>();
            for (ChatRootCause cr : rootCauses) {
                Map<String, Object> rcm = new java.util.LinkedHashMap<>();
                rcm.put("root_cause", cr.getRootCause());
                rcm.put("suggestion", cr.getSuggestion());
                try {
                    rcm.put("evidence", cr.getEvidence() != null ? objectMapper.readValue(cr.getEvidence(), List.class) : List.of());
                } catch (Exception e) {
                    rcm.put("evidence", List.of());
                }
                rootCauseMap.put(cr.getMessageId(), rcm);
            }

            List<Map<String, Object>> history = new ArrayList<>();
            for (ChatMessage msg : messages) {
                Map<String, Object> item = new java.util.LinkedHashMap<>();
                item.put("role", msg.getRole());
                item.put("content", msg.getContent());
                if ("assistant".equals(msg.getRole())) {
                    Map<String, Object> rcm = rootCauseMap.get(msg.getMessageId());
                    if (rcm != null) {
                        item.put("rootCause", rcm);
                    }
                }
                history.add(item);
            }
            return history;
        } catch (Exception e) {
            log.warn("Failed to load chat history from DB for session={}: {}", sessionId, e.getMessage());
            return null;
        }
    }

    public List<Map<String, Object>> getSessionMessages(String sessionId) {
        List<ChatMessage> messages = chatMessageRepository.findBySessionIdOrderByCreatedAtAsc(sessionId);
        List<ChatRootCause> rootCauses = chatRootCauseRepository.findBySessionId(sessionId);
        Map<String, Map<String, Object>> rcMap = new java.util.HashMap<>();
        for (ChatRootCause cr : rootCauses) {
            Map<String, Object> rcm = new java.util.LinkedHashMap<>();
            rcm.put("root_cause", cr.getRootCause());
            rcm.put("suggestion", cr.getSuggestion());
            try {
                rcm.put("evidence", cr.getEvidence() != null ? objectMapper.readValue(cr.getEvidence(), List.class) : List.of());
            } catch (Exception e) {
                rcm.put("evidence", List.of());
            }
            rcm.put("answerType", cr.getAnswerType());
            rcMap.put(cr.getMessageId(), rcm);
        }

        List<Map<String, Object>> result = new ArrayList<>();
        for (ChatMessage msg : messages) {
            Map<String, Object> item = new java.util.LinkedHashMap<>();
            item.put("id", String.valueOf(msg.getId()));
            item.put("role", msg.getRole());
            item.put("content", msg.getContent());
            item.put("messageId", msg.getMessageId());
            item.put("reasoning", msg.getReasoning());
            item.put("thinking", msg.getThinking());
            item.put("nl2sql", msg.getNl2sql() != null ? safeParseJson(msg.getNl2sql()) : null);
            if (msg.getConceptTrace() != null) {
                    try {
                        item.put("conceptTrace", objectMapper.readValue(msg.getConceptTrace(), List.class));
                    } catch (Exception e) {
                        log.warn("Failed to parse conceptTrace for message={}", msg.getMessageId());
                        item.put("conceptTrace", List.of());
                    }
                }
            item.put("timestamp", msg.getCreatedAt() != null ? msg.getCreatedAt().toString() : null);

            if ("assistant".equals(msg.getRole())) {
                Map<String, Object> rcm = rcMap.get(msg.getMessageId());
                if (rcm != null) {
                    item.put("rootCause", rcm);
                }
            }
            result.add(item);
        }
        return result;
    }

    private void asyncRecordMetrics(String sessionId, Map<String, Object> finalAnswer,
                                     String userQuery, long duration, int llmCalls, int toolCalls,
                                     Map<String, Object> finalData) {
        try {
            AgentQueryLog log = new AgentQueryLog();
            log.setSessionId(sessionId);
            log.setMessageId((String) finalAnswer.get("messageId"));
            log.setUserQuery(userQuery);
            log.setDecisionType((String) finalData.getOrDefault("decision_type", "final_answer"));
            log.setConceptMatchCount((int) finalData.getOrDefault("concept_match_count", 0));
            log.setConceptExpandCount((int) finalData.getOrDefault("concept_expand_count", 0));
            log.setApiToolCount((int) finalData.getOrDefault("api_tool_count", 0));
            log.setTotalLatencyMs(duration);
            log.setLlmLatencyMs((Long) finalData.getOrDefault("llm_latency_ms", 0L));
            log.setExecutionLatencyMs((Long) finalData.getOrDefault("execution_latency_ms", 0L));

            @SuppressWarnings("unchecked")
            List<Long> conceptIds = toLongList((List<?>) finalData.getOrDefault("concept_ids", List.of()));
            if (!conceptIds.isEmpty()) {
                log.setConceptIds(conceptIds.toString());
            }

            Map<String, Object> nl2sql = (Map<String, Object>) finalAnswer.get("nl2sql");
            if (nl2sql != null) {
                log.setSqlGenerated((String) nl2sql.get("sql"));
                log.setSqlExecuted(true);
                Map<String, Object> queryResult = (Map<String, Object>) finalAnswer.get("queryResult");
                if (queryResult != null && Boolean.TRUE.equals(queryResult.get("executed"))) {
                    log.setSqlSuccess(true);
                } else {
                    log.setSqlError(queryResult != null ? (String) queryResult.get("error") : "未知错误");
                }
            }

            agentMetricsService.recordQuery(log);
        } catch (Exception e) {
            log.warn("Failed to record agent metrics: {}", e.getMessage());
        }
    }

    public int getActiveSessionCount() {
        return conversationHistories.size();
    }

    

    private boolean checkRateLimit(String key) {
        long now = System.currentTimeMillis();
        long windowStart = now - Duration.ofMinutes(rateLimitWindowMinutes).toMillis();
        Deque<Long> bucket = rateLimitBuckets.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (bucket) {
            while (!bucket.isEmpty() && bucket.peekFirst() < windowStart) {
                bucket.pollFirst();
            }
            if (bucket.size() >= rateLimitMaxRequests) {
                log.warn("Rate limit exceeded for key={}", key);
                return false;
            }
            bucket.addLast(now);
            return true;
        }
    }

    private CompiledGraph<AgentState> compileReActGraph(AgentConfig config) throws Exception {
        StateGraph<AgentState> graph = new StateGraph<>(AgentState::new);

        graph.addNode("intent_recognition", buildIntentRecognitionNode(config));
        graph.addNode("agent", buildAgentNode(config));
        graph.addNode("tool_executor", buildToolExecutorNode());
        graph.addNode("nl2sql_executor", buildNl2sqlExecutorNode());
        graph.addNode("code_executor", buildCodeExecutorNode());
        graph.addNode("algorithm_executor", buildAlgorithmExecutorNode());
        graph.addNode("ontology_advisor", buildOntologyAdvisorNode());
        graph.addNode("final_answer", buildFinalAnswerNode());

        graph.addEdge("__START__", "intent_recognition");
        graph.addConditionalEdges("intent_recognition", buildIntentRouterEdge(), Map.of(
                "agent", "agent",
                "final_answer", "final_answer"
        ));

        graph.addConditionalEdges("agent", buildRouterEdge(), Map.of(
                "tool_call", "tool_executor",
                "nl2sql", "nl2sql_executor",
                "code_mode", "code_executor",
                "algorithm", "algorithm_executor",
                "ontology_action", "ontology_advisor",
                "final_answer", "final_answer",
                "continue", "agent"
        ));

        graph.addEdge("tool_executor", "agent");
        graph.addEdge("nl2sql_executor", "agent");
        graph.addEdge("code_executor", "agent");
        graph.addEdge("algorithm_executor", "agent");
        graph.addEdge("ontology_advisor", "agent");
        graph.addEdge("final_answer", "__END__");

        CompiledGraph<AgentState> compiled = graph.compile();
        compiled.setMaxIterations(MAX_ITERATIONS);
        return compiled;
    }

    private AsyncEdgeAction<AgentState> buildIntentRouterEdge() {
        return (state) -> {
            String intent = (String) state.data().getOrDefault("intent", "query");
            if ("general".equals(intent)) {
                return CompletableFuture.completedFuture("final_answer");
            }
            return CompletableFuture.completedFuture("agent");
        };
    }

    private AsyncNodeAction<AgentState> buildIntentRecognitionNode(AgentConfig config) {
        return (state) -> {
            Map<String, Object> data = new LinkedHashMap<>(state.data());
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> messages = (List<Map<String, Object>>) data.get("messages");
            String userQuery = extractLatestUserQuery(messages);
            String sessionId = (String) data.get("session_id");
            Long userId = data.get("user_id") instanceof Number ? ((Number) data.get("user_id")).longValue() : null;

            boolean isAdmin = userId != null && roleConceptPermissionService.isSuperAdmin(userId);
            String intent = "query";
            String generalAnswer = null;

            String intentPrompt = "判断以下用户消息的意图，仅输出一个 JSON 对象，不要输出其他内容：\n"
                    + "- 如果用户想查询企业数据、分析指标、下钻根因，输出 {\"intent\": \"query\"}\n"
                    + "- 如果用户想配置本体（创建概念、添加映射、表连接、配置关系等），输出 {\"intent\": \"ontology\"}\n"
                    + "- 如果是寒暄、闲聊、常识问答等与企业数据无关的内容，输出 {\"intent\": \"general\", \"answer\": \"<你的回答>\"}\n\n"
                    + "用户消息：" + userQuery;
            List<Map<String, Object>> intentMessages = new ArrayList<>();
            intentMessages.add(Map.of("role", "system", "content", "你是一个意图分类器。只输出 JSON，不要输出任何其他内容。"));
            intentMessages.add(Map.of("role", "user", "content", intentPrompt));
            java.util.function.Consumer<String> savedCallback = STREAM_CALLBACK.get();
            java.util.function.Consumer<String> savedReasoning = REASONING_CALLBACK.get();
            STREAM_CALLBACK.set(null);
            REASONING_CALLBACK.set(null);
            try {
                String llmResponse = callLlm(config, intentMessages, null, isAdmin);
                try {
                    String cleaned = llmResponse.trim();
                    if (cleaned.startsWith("```")) {
                        cleaned = cleaned.replaceAll("```json\\s*", "").replaceAll("```\\s*", "").trim();
                    }
                    Map<String, Object> parsed = objectMapper.readValue(cleaned, new TypeReference<>() {});
                    intent = (String) parsed.getOrDefault("intent", "query");
                    if ("general".equals(intent)) {
                        generalAnswer = (String) parsed.getOrDefault("answer", "");
                    }
                } catch (Exception e) {
                    log.warn("Intent recognition parse failed, defaulting to query: {}", e.getMessage());
                }
            } finally {
                STREAM_CALLBACK.set(savedCallback);
                REASONING_CALLBACK.set(savedReasoning);
            }

            data.put("intent", intent);
            data.put("iteration", 0);

            if ("general".equals(intent) && generalAnswer != null && !generalAnswer.isBlank()) {
                data.put("next_action", "final_answer");
                data.put("final_answer", generalAnswer);
                data.put("answer_type", "general");
                messages.add(Map.of("role", "assistant", "content", generalAnswer));
                log.info("Intent recognition: general (short-circuit), userQuery={}", userQuery.length() > 50 ? userQuery.substring(0, 50) : userQuery);
            } else {
                sendProgress("正在分析您的需求...");
                log.info("Intent recognition: {}, userQuery={}", intent, userQuery.length() > 50 ? userQuery.substring(0, 50) : userQuery);
            }

            return CompletableFuture.completedFuture(data);
        };
    }

    private AsyncNodeAction<AgentState> buildAgentNode(AgentConfig config) {
        return (state) -> {
            Map<String, Object> data = new LinkedHashMap<>(state.data());
            int iteration = (int) data.getOrDefault("iteration", 0);

            if (iteration >= MAX_ITERATIONS) {
                int sqlExecCount = (int) data.getOrDefault("sql_exec_count", 0);
                data.put("next_action", "final_answer");
                data.put("final_answer", "分析未能在限定轮次内完成（已达 " + MAX_ITERATIONS
                        + " 轮上限），期间已完成 " + sqlExecCount + " 轮数据查询。"
                        + "建议缩小问题范围或换个问法后重试。");
                return CompletableFuture.completedFuture(data);
            }

            long agentStartTime = data.containsKey("_agent_start_time")
                    ? ((Number) data.get("_agent_start_time")).longValue()
                    : System.currentTimeMillis();
            data.putIfAbsent("_agent_start_time", agentStartTime);
            if (System.currentTimeMillis() - agentStartTime > AGENT_TOTAL_TIMEOUT_MS) {
                log.warn("Agent total timeout exceeded: {}ms > {}ms, forcing final_answer",
                        System.currentTimeMillis() - agentStartTime, AGENT_TOTAL_TIMEOUT_MS);
                int done = (int) data.getOrDefault("sql_exec_count", 0);
                data.put("next_action", "final_answer");
                data.put("final_answer", "分析超时（超过 " + (AGENT_TOTAL_TIMEOUT_MS / 1000)
                        + " 秒），期间已完成 " + done + " 轮数据查询，结果见上方。请简化问题后重试。");
                return CompletableFuture.completedFuture(data);
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> messages = (List<Map<String, Object>>) data.get("messages");
            String sessionId = (String) data.get("session_id");
            Long userId = data.get("user_id") instanceof Number ? ((Number) data.get("user_id")).longValue() : null;
            String intent = (String) data.getOrDefault("intent", "query");

            @SuppressWarnings("unchecked")
            List<String> pendingActions = (List<String>) data.get("pending_actions");

            agentDebug.info("[AGENT_ENTER] iter={}, pendingActions={}, forceLlmCall={}",
                    iteration,
                    pendingActions != null ? pendingActions.stream().map(s -> s.length() > 60 ? s.substring(0, 60) + "..." : s).collect(java.util.stream.Collectors.toList()) : "null",
                    data.get("_force_llm_call"));

            Map<String, Object> parsed = null;
            boolean forceLlmCall = Boolean.TRUE.equals(data.remove("_force_llm_call"));
            if (!forceLlmCall && pendingActions != null && !pendingActions.isEmpty()) {
                while (parsed == null && !pendingActions.isEmpty()) {
                    Map<String, Object> candidate = consumePendingAction(data, pendingActions, iteration);
                    if (candidate.get("type") == null) {
                        String raw = (String) candidate.get("_raw");
                        addInvalidJsonFeedback(messages, raw != null ? raw : candidate.toString());
                        log.warn("Agent iteration {}: invalid pending action skipped, no type field", iteration);
                        if (pendingActions.isEmpty()) {
                            data.put("pending_actions", java.util.Collections.emptyList());
                        }
                    } else {
                        parsed = candidate;
                    }
                }
            }
            if (forceLlmCall) {
                data.put("pending_actions", java.util.Collections.emptyList());
                agentDebug.info("[FORCE_LLM] iter={}, discarding {} pending actions: {}",
                        iteration, pendingActions != null ? pendingActions.size() : 0, pendingActions);
                log.info("Agent iteration {}: _force_llm_call, skipping {} pending actions to re-query LLM",
                        iteration, pendingActions != null ? pendingActions.size() : 0);
            }
            if (parsed == null) {
                int sqlExecCount = (int) data.getOrDefault("sql_exec_count", 0);
                if (sqlExecCount >= MAX_DRILL_ROUNDS) {
                    parsed = handleMaxDrillSummary(data, messages, config, sessionId, userId, intent);
                } else if (allConceptsDrilled(data)) {
                    parsed = handleMaxDrillSummary(data, messages, config, sessionId, userId, intent);
                } else {
                    parsed = handleNormalIteration(data, messages, config, sessionId, userId, intent, iteration);
                }
            }

            routeByType(data, messages, parsed, iteration);
            // 所有动作（LLM 轮 + pending 队列消费轮）统一记录签名并检测循环，
            // 触发时强制终止（覆盖 routeByType 设置的 next_action）
            recordActionAndDetectLoop(data, messages, parsed, config, sessionId, userId, intent,
                    extractLatestUserQuery(messages));
            // P1：动作摘要入执行日志（供下一轮 LLM 调用前增量注入，模型不再"失忆"复读）
            @SuppressWarnings("unchecked")
            List<String> executedLog = (List<String>) data.get("executed_actions_log");
            if (executedLog == null) {
                executedLog = new ArrayList<>();
                data.put("executed_actions_log", executedLog);
            }
            executedLog.add("[" + (int) data.getOrDefault("iteration", 0) + "] " + describeAction(parsed));
            return java.util.concurrent.CompletableFuture.completedFuture(data);
        };
    }

    private Map<String, Object> consumePendingAction(Map<String, Object> data,
            List<String> pendingActions, int iteration) {
        String nextJson = pendingActions.remove(0);
        if (pendingActions.isEmpty()) {
            data.put("pending_actions", java.util.Collections.emptyList());
        }
        Map<String, Object> parsed = parseResponse(nextJson);
        parsed.put("_raw", nextJson);
        data.put("iteration", iteration + 1);
        log.info("Agent iteration {}: consumed from queue, type={}, remaining={}",
                iteration, parsed.get("type"), pendingActions.size());
        return parsed;
    }

    private void addInvalidJsonFeedback(List<Map<String, Object>> messages, String jsonContent) {
        messages.add(Map.of("role", "system", "content",
                "你的上一条 JSON 输出格式错误，以下内容没有包含 type 字段，无法识别为有效操作：\n\n"
                + "```json\n" + jsonContent + "\n```\n\n"
                + "请检查并重新生成正确的 JSON 格式。常见错误：value_origins 在 JSON 闭合后被追加，"
                + "请确保所有字段都在同一个 JSON 对象内。"));
    }

    private Map<String, Object> handleMaxDrillSummary(Map<String, Object> data,
            List<Map<String, Object>> messages, AgentConfig config,
            String sessionId, Long userId, String intent) {
        int sqlExecCount = (int) data.getOrDefault("sql_exec_count", 0);
        int llmCallCount = (int) data.getOrDefault("llm_call_count", 0);
        log.info("Agent iteration {}: max drill rounds reached, calling LLM for summary", data.get("iteration"));
        data.put("llm_call_count", llmCallCount + 1);
        messages.add(Map.of("role", "system", "content",
                "【强制指令】已完成 " + sqlExecCount + " 轮下钻分析，现在必须立即输出最终根因分析结论。"
                + "必须输出以下 JSON 格式，不得输出任何其他内容：\n"
                + "{\"type\":\"final_answer\",\"answer_type\":\"root_cause\",\"answer\":\"<Markdown格式的根因分析报告>\","
                + "\"evidence\":[{\"dimension\":\"维度名\",\"finding\":\"发现\",\"anomaly\":true/false}],"
                + "\"root_cause\":\"<一句话根因>\",\"suggestion\":\"<修复建议>\"}\n"
                + "禁止输出纯文本。禁止输出\"所有相关维度已完成下钻分析\"。禁止生成新的 SQL。禁止生成 nl2sql。"));
        String userQuery = extractLatestUserQuery(messages);
        Map<String, Object> unifiedContext = getOrBuildContext(data, sessionId, userQuery, messages, userId, intent);
        boolean isAdmin = userId != null && roleConceptPermissionService.isSuperAdmin(userId);
        populateContextData(data, unifiedContext);
        String llmResponse = callLlm(config, messages, (String) unifiedContext.get("prompt"), isAdmin);
        recordLlmResponse(data, llmResponse);
        data.put("iteration", (int) data.getOrDefault("iteration", 0) + 1);
        return parseResponse(llmResponse);
    }

    private Map<String, Object> handleNormalIteration(Map<String, Object> data,
            List<Map<String, Object>> messages, AgentConfig config,
            String sessionId, Long userId, String intent, int iteration) {
        int sqlExecCount = (int) data.getOrDefault("sql_exec_count", 0);
        int llmCallCount = (int) data.getOrDefault("llm_call_count", 0);

        String userQuery = extractLatestUserQuery(messages);
        if (iteration == 0) {
            sendProgress("正在检索相关概念和数据库表...");
        } else if (sqlExecCount > 0) {
            sendProgress("正在分析第 " + sqlExecCount + " 轮下钻结果...");
        }

        trimMessages(messages);
        injectExecutedActionsSummary(data, messages);

        Map<String, Object> unifiedContext = getOrBuildContext(data, sessionId, userQuery, messages, userId, intent);
        boolean isAdmin = userId != null && roleConceptPermissionService.isSuperAdmin(userId);
        populateContextData(data, unifiedContext);

        data.put("llm_call_count", llmCallCount + 1);
        long tLlm = System.currentTimeMillis();
        String llmResponse = callLlm(config, messages, (String) unifiedContext.get("prompt"), isAdmin);
        recordLlmResponse(data, llmResponse);
        log.info("Agent iteration {}: LLM call completed in {}ms", iteration, System.currentTimeMillis() - tLlm);
        data.put("iteration", iteration + 1);

        List<String> allJsons = extractJsons(llmResponse);
        agentDebug.info("[NORMAL_ITER] extracted {} JSONs, llmResponseLen={}", allJsons.size(), llmResponse.length());
        Map<String, Object> parsed;
        if (allJsons.isEmpty()) {
            if (llmResponse.length() > 20 && !llmResponse.trim().startsWith("{")) {
                log.warn("Agent iteration {}: LLM returned only reasoning/text without JSON action, requesting JSON output", iteration);
                messages.add(Map.of("role", "system", "content",
                        "你的上一轮回复只包含了思考过程，但没有输出任何 JSON 动作。请根据你的思考，输出一个 JSON 动作（nl2sql、final_answer 等），格式如：\n"
                        + "{\"type\": \"nl2sql\", \"reasoning\": \"...\", \"sql\": \"...\", \"concept_ids\": [...]}\n"
                        + "或\n"
                        + "{\"type\": \"final_answer\", \"reasoning\": \"...\", \"answer\": \"...\", \"concept_ids\": [...]}"));
                data.put("next_action", "continue");
                data.put("iteration", iteration + 1);
                return Map.of("type", "_no_json_continue");
            }
            parsed = parseResponse(llmResponse);
            agentDebug.info("[NORMAL_ITER] allJsons EMPTY, parsed type={}", parsed.get("type"));
        } else {
            parsed = parseResponse(allJsons.get(0));
            agentDebug.info("[NORMAL_ITER] firstJson type={}, firstJsonLen={}", parsed.get("type"), allJsons.get(0).length());
            // 如果第一个 action 是 final_answer 且同批还有数据查询动作，跳过它
            if ("final_answer".equals(parsed.get("type")) && hasDataGatheringInBatch(allJsons, 1)) {
                for (int i = 1; i < allJsons.size(); i++) {
                    try {
                        String json = allJsons.get(i).trim();
                        if (json.startsWith("[")) {
                            List<Map<String, Object>> arr = objectMapper.readValue(json,
                                    new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, Object>>>() {});
                            for (Map<String, Object> elem : arr) {
                                if (isDataGatheringType((String) elem.get("type"))) {
                                    parsed = elem;
                                    allJsons.remove(i);
                                    break;
                                }
                            }
                        } else {
                            Map<String, Object> m = objectMapper.readValue(json, Map.class);
                            if (isDataGatheringType((String) m.get("type"))) {
                                parsed = m;
                                allJsons.remove(i);
                                break;
                            }
                        }
                    } catch (Exception ignored) { }
                }
                messages.add(Map.of("role", "system", "content",
                        "不要在数据查询未完成时输出 final_answer。请等待所有查询结果返回后，基于实际数据做出回答。"));
            }
            queueExtraActions(data, messages, allJsons, parsed, iteration, typeSignature(parsed));
        }
        return parsed;
    }

    private Map<String, Object> getOrBuildContext(Map<String, Object> data, String sessionId,
            String userQuery, List<Map<String, Object>> messages, Long userId, String intent) {
        @SuppressWarnings("unchecked")
        Map<String, Object> cached = (Map<String, Object>) data.get("_cached_context");
        if (cached != null) {
            return cached;
        }
        Map<String, Object> context = contextBuilder.build(sessionId, userQuery, messages, userId, intent);
        Map<String, Object> cacheEntry = new LinkedHashMap<>();
        cacheEntry.put("prompt", context.get("prompt"));
        cacheEntry.put("conceptTrace", context.get("conceptTrace"));
        cacheEntry.put("conceptIds", context.get("conceptIds"));
        cacheEntry.put("availableDatasources", context.get("availableDatasources"));
        data.put("_cached_context", cacheEntry);
        return context;
    }

    private void populateContextData(Map<String, Object> data, Map<String, Object> unifiedContext) {
        data.put("concept_trace", unifiedContext.get("conceptTrace"));
        data.put("concept_ids", unifiedContext.get("conceptIds"));
        data.put("availableDatasources", unifiedContext.get("availableDatasources"));
        data.put("_joinMappings", toMapList(unifiedContext.get("joinMappings"),
                jm -> Map.of("conceptId", ((ConceptJoinMapping) jm).getConceptId(),
                        "joinTable", ((ConceptJoinMapping) jm).getJoinTable())));
        data.put("_tableMappings", toMapList(unifiedContext.get("tableMappings"),
                cm -> Map.of("conceptId", ((ConceptMapping) cm).getConceptId(),
                        "tableName", ((ConceptMapping) cm).getTableName(),
                        "columnName", ((ConceptMapping) cm).getColumnName())));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> toMapList(Object entityList,
            java.util.function.Function<Object, Map<String, Object>> converter) {
        if (!(entityList instanceof List<?> list) || list.isEmpty()) return List.of();
        List<Map<String, Object>> result = new ArrayList<>(list.size());
        for (Object entity : list) {
            result.add(converter.apply(entity));
        }
        return result;
    }

    private void recordLlmResponse(Map<String, Object> data, String response) {
        StringBuilder llmReasoning = LLM_REASONING_BUFFER.get();
        agentDebug.info("[LLM_REASONING_BUFFER] GET on thread={}, hasValue={}, len={}",
                Thread.currentThread().getName(),
                llmReasoning != null,
                llmReasoning != null ? llmReasoning.length() : 0);
        if (llmReasoning != null && llmReasoning.length() > 0) {
            String prev = (String) data.getOrDefault("llm_reasoning", "");
            String combined = prev.isEmpty() ? llmReasoning.toString() : prev + "\n\n---\n\n" + llmReasoning;
            // P2：展示层截断——只保留最近 5 段，防止长循环下思考过程无限膨胀
            String[] segments = combined.split("\n\n---\n\n");
            if (segments.length > 5) {
                combined = String.join("\n\n---\n\n", java.util.Arrays.copyOfRange(segments, segments.length - 5, segments.length));
            }
            data.put("llm_reasoning", combined);
            agentDebug.info("[LLM_REASONING_BUFFER] STORED into data.llm_reasoning, prevLen={}, newLen={}, totalLen={}",
                    prev.length(), llmReasoning.length(), ((String) data.get("llm_reasoning")).length());
            LLM_REASONING_BUFFER.remove();
        } else {
            agentDebug.info("[LLM_REASONING_BUFFER] SKIP (null or empty)");
        }
        String prevRaw = (String) data.getOrDefault("llm_raw_output", "");
        data.put("llm_raw_output", prevRaw.isEmpty() ? response : prevRaw + "\n" + response);
        data.put("last_llm_response", response);
    }

    private boolean allConceptsDrilled(Map<String, Object> data) {
        int sqlExecCount = (int) data.getOrDefault("sql_exec_count", 0);
        if (sqlExecCount <= 0) return false;
        @SuppressWarnings("unchecked")
        List<Long> drilled = toLongList((List<?>) data.getOrDefault("drilled_concepts", List.of()));
        @SuppressWarnings("unchecked")
        List<Long> current = toLongList((List<?>) data.getOrDefault("concept_ids", List.of()));
        return !current.isEmpty() && current.stream().allMatch(drilled::contains);
    }

    private static List<Long> toLongList(List<?> list) {
        if (list.isEmpty()) return List.of();
        List<Long> result = new ArrayList<>(list.size());
        for (Object item : list) {
            if (item instanceof Number) {
                result.add(((Number) item).longValue());
            }
        }
        return result;
    }

    /**
     * 统一循环检测（所有动作经此记录签名，含 LLM 轮与 pending 队列消费轮）。
     * 滑动窗口判定见 {@link com.luban.service.agent.ActionLoopDetector}——
     * 修复点：旧实现只比对相邻签名，轮转循环（A→B→A→B）永不触发。
     * 触发后先尝试 LLM 总结，非 final_answer 时用确定性文案兜底终止。
     */
    private void recordActionAndDetectLoop(Map<String, Object> data, List<Map<String, Object>> messages,
            Map<String, Object> parsed, AgentConfig config,
            String sessionId, Long userId, String intent, String userQuery) {
        if ("final_answer".equals(data.get("next_action"))) {
            return; // 已被其他路径终止
        }
        // _no_json_continue 是 LLM 纯推理无动作时的占位标记，不是真正的循环动作，不参与循环检测
        if ("_no_json_continue".equals(parsed.get("type"))) {
            return;
        }
        String currentSig = typeSignature(parsed);
        @SuppressWarnings("unchecked")
        List<String> signatures = (List<String>) data.getOrDefault("action_signatures",
                new java.util.ArrayList<String>());
        boolean loop = com.luban.service.agent.ActionLoopDetector.recordAndDetect(signatures, currentSig);
        data.put("action_signatures", signatures);
        // DEBUG: 记录每次签名的写入和检测结果
        int sqlExecCount = (int) data.getOrDefault("sql_exec_count", 0);
        int iter = (int) data.getOrDefault("iteration", 0);
        agentDebug.info("[LOOP_DETECT] iter={}, sqlExecCount={}, sig={}, totalSigs={}, sigs={}, loop={}",
                iter, sqlExecCount, currentSig, signatures.size(), signatures, loop);
        if (!loop) return;

        var dominant = com.luban.service.agent.ActionLoopDetector.dominantSignature(signatures);
        log.warn("Agent loop detected at iteration {}: dominantSig={} count={}, forcing termination",
                iter, dominant == null ? "?" : dominant.getKey(), dominant == null ? 0 : dominant.getValue());
        data.put("pending_actions", java.util.Collections.emptyList());

        // 先尝试一次 LLM 总结（模型可能给出有价值的根因分析）
        try {
            StringBuilder loopCtx = new StringBuilder();
            loopCtx.append("检测到分析动作反复重复。请停止生成查询类动作，立即输出 final_answer。\n");
            loopCtx.append("【强制】按以下格式输出你的诊断，每一项都必须基于已执行的查询结果，禁止臆测：\n");
            loopCtx.append("1. 已执行的查询及其结果（逐条列出）\n");
            loopCtx.append("2. 从结果中能确定什么\n");
            loopCtx.append("3. 还需要什么数据才能回答用户问题\n");
            loopCtx.append("4. 如果数据不足，说明具体缺什么数据（缺哪个表、缺哪个字段），不是笼统的\"表不可用\"\n");
            loopCtx.append("【禁止】在未执行单表验证的情况下断言\"表不存在\"或\"映射缺失\"。");
            messages.add(Map.of("role", "system", "content", loopCtx.toString()));
            Map<String, Object> summaryContext = contextBuilder.build(sessionId, userQuery, messages, userId, intent);
            boolean isAdmin = userId != null && roleConceptPermissionService.isSuperAdmin(userId);
            String summaryResponse = callLlm(config, messages, (String) summaryContext.get("prompt"), isAdmin);
            recordLlmResponse(data, summaryResponse);
            List<String> summaryJsons = extractJsons(summaryResponse);
            Map<String, Object> finalParsed = !summaryJsons.isEmpty()
                    ? parseResponse(summaryJsons.get(0)) : parseResponse(summaryResponse);
            if ("final_answer".equals(finalParsed.get("type"))
                    && finalParsed.get("answer") != null && !String.valueOf(finalParsed.get("answer")).isBlank()) {
                data.put("final_answer", finalParsed.get("answer"));
            }
        } catch (Exception e) {
            log.warn("Summary call failed: {}", e.getMessage());
        }
        // 确定性兜底：无论总结是否成功，终止原因与统计必须透出
        data.putIfAbsent("final_answer",
                "分析已自动终止：检测到重复分析动作（已完成 " + sqlExecCount + " 轮数据查询）。"
                + "已获得的部分结果见上方；若结论不完整，请缩小问题范围后重试。");
        data.put("next_action", "final_answer");
    }

    /** 判断是否为数据查询类动作（需要等待结果才能作答） */
    private boolean isDataGatheringType(String type) {
        return "nl2sql".equals(type) || "get_enum_values".equals(type)
                || "ontology_action".equals(type) || "tool_call".equals(type);
    }

    /** 检查 batch 中从 startIndex 开始是否有数据查询动作 */
    private boolean hasDataGatheringInBatch(List<String> allJsons, int startIndex) {
        for (int i = startIndex; i < allJsons.size(); i++) {
            String json = allJsons.get(i).trim();
            try {
                if (json.startsWith("[")) {
                    List<Map<String, Object>> arr = objectMapper.readValue(json,
                            new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, Object>>>() {});
                    for (Map<String, Object> elem : arr) {
                        if (isDataGatheringType((String) elem.get("type"))) return true;
                    }
                } else {
                    Map<String, Object> m = objectMapper.readValue(json, Map.class);
                    if (isDataGatheringType((String) m.get("type"))) return true;
                }
            } catch (Exception ignored) { }
        }
        return false;
    }

    private void queueExtraActions(Map<String, Object> data, List<Map<String, Object>> messages,
            List<String> allJsons, Map<String, Object> parsed, int iteration, String currentSig) {
        if (allJsons.size() <= 1) return;
            log.info("Agent iteration {}: LLM output {} JSONs, 1st={}, queuing {} extra",
                    data.get("iteration"), allJsons.size(), parsed.getOrDefault("type", "?"), allJsons.size() - 1);
            List<String> pending = new ArrayList<>();
            List<String> orphanJsons = new ArrayList<>();
            Set<String> seenSigs = new HashSet<>();
            seenSigs.add(currentSig);
            for (int i = 1; i < allJsons.size(); i++) {
                String json = allJsons.get(i).trim();
                try {
                    // 处理 JSON 数组格式：LLM 可能输出 [{...}, {...}] 作为单个元素
                    if (json.startsWith("[")) {
                        List<Map<String, Object>> arr = objectMapper.readValue(json,
                                new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, Object>>>() {});
                        agentDebug.info("[QUEUE] unpacking JSON array at index={}, {} elements", i, arr.size());
                        for (Map<String, Object> elem : arr) {
                            if (elem.get("type") == null) {
                                orphanJsons.add(objectMapper.writeValueAsString(elem));
                                continue;
                            }
                            String sig = typeSignature(elem);
                            if (sig != null && seenSigs.contains(sig)) {
                                agentDebug.info("[QUEUE] skipping duplicate (from array) sig={}", sig);
                            } else {
                                pending.add(objectMapper.writeValueAsString(elem));
                                if (sig != null) seenSigs.add(sig);
                            }
                        }
                        continue;
                    }
                    Map<String, Object> m = objectMapper.readValue(json, Map.class);
                    if (m.get("type") == null) {
                        orphanJsons.add(json);
                        agentDebug.info("[QUEUE] skipping invalid JSON at index={}, no type field, content={}", i,
                                json.length() > 120 ? json.substring(0, 120) : json);
                    } else {
                        String sig = typeSignature(m);
                        if (sig != null && seenSigs.contains(sig)) {
                            agentDebug.info("[QUEUE] skipping duplicate action at index={}, sig={}", i, sig);
                        } else {
                            pending.add(json);
                            if (sig != null) {
                                seenSigs.add(sig);
                            }
                        }
                    }
                } catch (Exception e) {
                    orphanJsons.add(json);
                    agentDebug.info("[QUEUE] skipping unparseable JSON at index={}, error={}", i, e.getMessage());
                }
            }
            if (!orphanJsons.isEmpty()) {
                addInvalidJsonFeedback(messages, String.join("\n", orphanJsons));
                log.warn("Agent iteration {}: {} orphan JSONs detected, adding system message",
                        data.get("iteration"), orphanJsons.size());
            }
            // 如果同批既有数据查询又有 final_answer，跳过 final_answer，等数据回来后再答
            boolean firstIsDataGathering = isDataGatheringType((String) parsed.get("type"));
            boolean hasPendingDataGathering = false;
            boolean hasPendingFinalAnswer = false;
            for (String json : pending) {
                try {
                    Map<String, Object> m = objectMapper.readValue(json, Map.class);
                    String t = (String) m.get("type");
                    if (isDataGatheringType(t)) hasPendingDataGathering = true;
                    if ("final_answer".equals(t)) hasPendingFinalAnswer = true;
                } catch (Exception ignored) { }
            }
            if ((firstIsDataGathering || hasPendingDataGathering) && hasPendingFinalAnswer) {
                pending.removeIf(json -> {
                    try {
                        return "final_answer".equals(objectMapper.readValue(json, Map.class).get("type"));
                    } catch (Exception e) { return false; }
                });
                messages.add(Map.of("role", "system", "content",
                        "不要在数据查询未完成时输出 final_answer。请等待所有查询结果返回后，基于实际数据做出回答。"));
                log.info("Agent iteration {}: removed final_answer from pending queue (data-gathering actions present)",
                        data.get("iteration"));
            }
            // P2：pending 队列上限，防止单轮失控输出大量动作被逐个执行
            final int MAX_PENDING_ACTIONS = 5;
            if (pending.size() > MAX_PENDING_ACTIONS) {
                log.warn("Agent iteration {}: pending actions {} > {}, truncating",
                        data.get("iteration"), pending.size(), MAX_PENDING_ACTIONS);
                pending = new ArrayList<>(pending.subList(0, MAX_PENDING_ACTIONS));
            }
            if (!pending.isEmpty()) {
                data.put("pending_actions", pending);
            }
            agentDebug.info("[QUEUE] queued {} valid actions: sigs={}, dups={}, orphans={}",
                    pending.size(), seenSigs, allJsons.size() - 1 - pending.size() - orphanJsons.size(), orphanJsons.size());
    }

    private CompletableFuture<Map<String, Object>> routeByType(Map<String, Object> data,
            List<Map<String, Object>> messages, Map<String, Object> parsed, int iteration) {
        String type = (String) parsed.get("type");
        log.info("Agent iteration {}: action type={}, preview={}",
                iteration, type, parsed.toString().length() > 200 ? parsed.toString().substring(0, 200) : parsed.toString());

        if ("final_answer".equals(data.get("next_action"))) {
            log.info("Agent iteration {}: next_action already final_answer (set by loop detection), skipping routeByType", iteration);
            return CompletableFuture.completedFuture(data);
        }

        if ("_no_json_continue".equals(type)) {
            log.info("Agent iteration {}: _no_json_continue, already set next_action=continue", iteration);
        } else if ("final_answer".equals(type)) {
            routeFinalAnswer(data, messages, parsed);
        } else if ("tool_call".equals(type)) {
            routeToolCall(data, messages, parsed);
        } else if ("nl2sql".equals(type)) {
            routeNl2sql(data, messages, parsed);
        } else if ("code_mode".equals(type)) {
            routeCodeMode(data, messages, parsed);
        } else if ("algorithm".equals(type)) {
            routeAlgorithm(data, messages, parsed);
        } else if ("ontology_action".equals(type)) {
            routeOntologyAction(data, messages, parsed);
        } else if ("request_context".equals(type)) {
            routeRequestContext(data, messages, parsed, iteration);
        } else if ("get_table_schema".equals(type)) {
            routeGetTableSchema(data, messages, parsed);
        } else if ("get_enum_values".equals(type)) {
            routeGetEnumValues(data, messages, parsed);
        } else if ("parse_error".equals(type)) {
            routeParseError(data, messages, parsed, iteration);
        } else {
            String raw = (String) parsed.get("_raw");
            addInvalidJsonFeedback(messages, raw != null ? raw : parsed.toString());
            log.warn("Agent iteration {}: unknown action type={}, sending feedback to LLM", iteration, type);
        }
        return CompletableFuture.completedFuture(data);
    }

    private void routeFinalAnswer(Map<String, Object> data, List<Map<String, Object>> messages,
            Map<String, Object> parsed) {
        List<?> rawIds = (List<?>) parsed.get("concept_ids");
        List<Long> conceptIds = null;
        if (rawIds != null && !rawIds.isEmpty()) {
            conceptIds = rawIds.stream()
                    .map(id -> id instanceof Number ? ((Number) id).longValue() : null)
                    .filter(id -> id != null).collect(Collectors.toList());
        }

        if (conceptIds != null && !conceptIds.isEmpty()) {
            String missingMsg = validateComputedFromChannels(conceptIds, messages);
            if (missingMsg != null) {
                messages.add(Map.of("role", "system", "content", missingMsg));
                data.put("next_action", "continue");
                return;
            }
        }

        String answer = (String) parsed.get("answer");
        if (answer != null && isGenericMissingConfigAnswer(answer) && conceptIds != null && !conceptIds.isEmpty()) {
            String enhanced = enhanceMissingConfigAnswer(answer, conceptIds, data);
            if (enhanced != null) answer = enhanced;
        }

        String falseClaim = validateTableClaims(answer, data);
        if (falseClaim != null) {
            int claimRetries = (int) data.getOrDefault("_false_claim_retries", 0);
            if (claimRetries >= 2) {
                log.warn("Agent final_answer: false claim retries exceeded, accepting answer as-is");
                data.remove("_false_claim_retries");
            } else {
                log.warn("Agent final_answer contains false claim about table/mapping: {}", falseClaim);
                data.put("_false_claim_retries", claimRetries + 1);
                messages.add(Map.of("role", "system", "content", falseClaim));
                data.put("next_action", "continue");
                return;
            }
        } else {
            data.remove("_false_claim_retries");
        }
        agentDebug.info("[ROUTE_FINAL] answerLen={}, answerPreview={}",
                answer != null ? answer.length() : 0,
                answer != null ? answer.substring(0, Math.min(300, answer.length())) : "null");
        String reasoning = (String) parsed.getOrDefault("reasoning", "");
        String prevReasoning = (String) data.getOrDefault("reasoning", "");
        data.put("next_action", "final_answer");
        data.put("final_answer", answer);
        data.put("reasoning", prevReasoning.isEmpty() ? reasoning : prevReasoning + "\n\n---\n\n" + reasoning);
        data.put("answer_type", parsed.getOrDefault("answer_type", ""));
        data.put("root_cause", parsed.getOrDefault("root_cause", ""));
        data.put("suggestion", parsed.getOrDefault("suggestion", ""));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> llmEvidence = (List<Map<String, Object>>) parsed.getOrDefault("evidence", List.of());
        if (!llmEvidence.isEmpty()) {
            data.put("evidence", llmEvidence);
        } else {
            List<Map<String, Object>> autoEvidence = buildAutoEvidence(data);
            data.put("evidence", autoEvidence);
        }
        if (conceptIds != null) {
            data.put("recognized_concept_ids", conceptIds);
        }
        messages.add(Map.of("role", "assistant", "content", answer));
    }

    private boolean isGenericMissingConfigAnswer(String answer) {
        if (answer == null) return false;
        String lower = answer.toLowerCase();
        return lower.contains("联系管理员补充") || lower.contains("补充相关配置")
                || lower.contains("缺少相关配置") || lower.contains("无法查询该数据");
    }

    private String enhanceMissingConfigAnswer(String originalAnswer, List<Long> conceptIds,
            Map<String, Object> data) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> conceptTrace = (List<Map<String, Object>>)
                data.getOrDefault("concept_trace", List.of());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> tableMappings = (List<Map<String, Object>>)
                data.getOrDefault("_tableMappings", List.of());
        @SuppressWarnings("unchecked")
        List<String> emptyEnumColumns = (List<String>) data.getOrDefault("_enum_empty_columns", List.of());
        @SuppressWarnings("unchecked")
        Map<String, List<String>> enumWhitelist = (Map<String, List<String>>)
                data.getOrDefault("_enum_whitelist", Map.of());

        Map<Long, String> traceNames = new LinkedHashMap<>();
        for (Map<String, Object> ct : conceptTrace) {
            Object cid = ct.get("conceptId");
            Object cname = ct.get("conceptName");
            if (cid instanceof Number && cname instanceof String) {
                traceNames.put(((Number) cid).longValue(), (String) cname);
            }
        }

        StringBuilder sb = new StringBuilder();
        for (Long cid : conceptIds) {
            String name = traceNames.getOrDefault(cid, "概念" + cid);
            List<Map<String, Object>> mappings = tableMappings.stream()
                    .filter(m -> cid.equals(m.get("conceptId")))
                    .collect(Collectors.toList());

            if (mappings.isEmpty()) {
                sb.append("概念「").append(name).append("」（ID ").append(cid)
                        .append("）已存在，但未配置到任何数据表列的映射，无法按该维度筛选数据。\n");
            } else {
                for (Map<String, Object> mapping : mappings) {
                    String tableName = (String) mapping.get("tableName");
                    String columnName = (String) mapping.get("columnName");
                    String key = (tableName != null && columnName != null) ? tableName + "." + columnName : null;

                    sb.append("概念「").append(name).append("」（ID ").append(cid).append("）已映射到 ");
                    sb.append(tableName != null ? tableName : "?");
                    if (columnName != null) sb.append(".").append(columnName);

                    if (key != null && emptyEnumColumns.contains(key)) {
                        sb.append("，但该列**无实际数据**（数据缺失，非配置缺失）。\n");
                    } else if (key != null && enumWhitelist.containsKey(key)) {
                        List<String> values = enumWhitelist.get(key);
                        if (values.isEmpty()) {
                            sb.append("，但该列**无实际数据**（数据缺失，非配置缺失）。\n");
                        } else {
                            sb.append("，该列现有值：").append(values).append("。\n");
                        }
                    } else {
                        sb.append("，尚未通过 get_enum_values 验证该列是否有数据。\n");
                    }
                }
            }
        }

        if (sb.length() == 0) return null;
        return sb.toString();
    }

    /**
     * 校验 final_answer 中关于"表/映射不可用"的声明是否属实。
     * 返回 null 表示无需纠正，返回非 null 字符串表示需要注入的纠正消息。
     */
    @SuppressWarnings("unchecked")
    private String validateTableClaims(String answer, Map<String, Object> data) {
        if (answer == null || answer.isEmpty()) return null;
        List<Map<String, Object>> tableMappings = (List<Map<String, Object>>)
                data.getOrDefault("_tableMappings", List.of());
        List<Map<String, Object>> joinMappings = (List<Map<String, Object>>)
                data.getOrDefault("_joinMappings", List.of());

        Set<String> availableTables = new LinkedHashSet<>();
        for (Map<String, Object> mapping : tableMappings) {
            String tableName = (String) mapping.get("tableName");
            if (tableName != null) availableTables.add(tableName.toLowerCase());
        }
        for (Map<String, Object> join : joinMappings) {
            String joinTable = (String) join.get("joinTable");
            if (joinTable != null) availableTables.add(joinTable.toLowerCase());
        }

        if (availableTables.isEmpty()) return null;

        Pattern tableClaim = Pattern.compile(
                "(?:表|table)\\s*[`'\"]?(\\w+)[`'\"]?\\s*(?:不可用|不存在|未配置|找不到|无法访问|is\\s+not\\s+available|does\\s+not\\s+exist|is\\s+missing)",
                Pattern.CASE_INSENSITIVE);
        Matcher matcher = tableClaim.matcher(answer);
        List<String> falseTables = new ArrayList<>();

        while (matcher.find()) {
            String claimedTable = matcher.group(1);
            if (claimedTable != null && availableTables.contains(claimedTable.toLowerCase())) {
                falseTables.add(claimedTable);
            }
        }

        if (falseTables.isEmpty()) return null;

        return "【系统校验纠正】你的 final_answer 中声称表 " + String.join(", ", falseTables)
                + " 不可用/不存在，但系统已校验：这些表在数据源中确实存在，可正常查询。"
                + " 0 行结果的原因是 WHERE/JOIN 条件不匹配，不是表结构缺失。"
                + " 请修正你的诊断，基于实际查询结果重新输出 final_answer。"
                + " 禁止将 0 行归因为\"表不可用\"或\"配置缺失\"。";
    }

    private String validateComputedFromChannels(List<Long> conceptIds, List<Map<String, Object>> messages) {
        List<ConceptRelation> computedRelations = conceptRelationRepository
                .findBySourceConceptIdInAndRelationTypeIn(conceptIds,
                        List.of("COMPUTED_FROM", "DERIVED_FROM"));
        if (computedRelations.isEmpty()) return null;

        Set<String> requiredColumns = new LinkedHashSet<>();
        Map<Long, String> conceptNames = new HashMap<>();
        Map<Long, List<String>> factorColumns = new LinkedHashMap<>();

        for (ConceptRelation rel : computedRelations) {
            Long sourceId = rel.getSourceConceptId();
            Long targetId = rel.getTargetConceptId();

            conceptNames.putIfAbsent(sourceId, conceptRepository.findById(sourceId)
                    .map(Concept::getName).orElse("概念" + sourceId));

            List<ConceptMapping> sourceMappings = conceptMappingRepository.findByConceptId(sourceId);
            for (ConceptMapping m : sourceMappings) {
                requiredColumns.add(m.getColumnName().toLowerCase());
            }

            List<ConceptMapping> targetMappings = conceptMappingRepository.findByConceptId(targetId);
            List<String> cols = targetMappings.stream()
                    .map(m -> m.getColumnName().toLowerCase())
                    .collect(Collectors.toList());
            factorColumns.computeIfAbsent(sourceId, k -> new ArrayList<>()).addAll(cols);
            requiredColumns.addAll(cols);
        }

        Set<String> queriedColumns = new LinkedHashSet<>();
        for (Map<String, Object> msg : messages) {
            if (!"assistant".equals(msg.get("role"))) continue;
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> toolCalls = (List<Map<String, Object>>) msg.get("tool_calls");
            if (toolCalls == null) continue;
            for (Map<String, Object> tc : toolCalls) {
                @SuppressWarnings("unchecked")
                Map<String, Object> function = (Map<String, Object>) tc.get("function");
                if (function == null) continue;
                String funcName = (String) function.get("name");
                if (!"nl2sql_executor".equals(funcName) && !"code_executor".equals(funcName)) continue;
                String args = (String) function.get("arguments");
                if (args == null) continue;
                try {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> argsMap = objectMapper.readValue(args, Map.class);
                    String text = (String) argsMap.get("sql");
                    if (text == null) text = (String) argsMap.get("code");
                    if (text != null) {
                        String lower = text.toLowerCase();
                        for (String col : requiredColumns) {
                            if (lower.contains(col)) {
                                queriedColumns.add(col);
                            }
                        }
                    }
                } catch (Exception ignored) {
                }
            }
        }

        Set<String> missing = new LinkedHashSet<>(requiredColumns);
        missing.removeAll(queriedColumns);
        if (missing.isEmpty()) return null;

        StringBuilder sb = new StringBuilder("【双通道校验未通过】以下计算关系的必需列未被查询：\n");
        for (ConceptRelation rel : computedRelations) {
            Long sourceId = rel.getSourceConceptId();
            String sourceName = conceptNames.get(sourceId);
            String targetName = conceptRepository.findById(rel.getTargetConceptId())
                    .map(Concept::getName).orElse("概念" + rel.getTargetConceptId());
            sb.append("- ").append(sourceName).append(" 由 ").append(targetName).append(" 计算，公式：")
                    .append(rel.getExpression() != null ? rel.getExpression() : "未设置").append("\n");
        }
        sb.append("\n缺失列：");
        for (String col : missing) {
            sb.append(col).append(" ");
        }
        sb.append("\n请补充查询这些列，完成双通道交叉验证后再输出 final_answer。");
        return sb.toString();
    }

    private List<Map<String, Object>> buildAutoEvidence(Map<String, Object> data) {
        List<Map<String, Object>> evidence = new ArrayList<>();
        @SuppressWarnings("unchecked")
        Map<String, Object> nl2sql = (Map<String, Object>) data.get("nl2sql");
        @SuppressWarnings("unchecked")
        Map<String, Object> queryResult = (Map<String, Object>) data.get("query_result");
        if (nl2sql == null || queryResult == null) {
            return evidence;
        }
        String sql = (String) nl2sql.get("sql");
        if (sql == null || sql.isBlank()) {
            return evidence;
        }
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("step", 1);
        ev.put("dimension", "数据查询");
        ev.put("sql", sql);
        String error = (String) queryResult.get("error");
        if (error != null && !error.isBlank()) {
            ev.put("finding", "查询失败: " + error);
            ev.put("anomaly", true);
        } else {
            Object rowCountObj = queryResult.getOrDefault("rowCount", 0);
            int rowCount = rowCountObj instanceof Number ? ((Number) rowCountObj).intValue() : 0;
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> rows = (List<Map<String, Object>>) queryResult.getOrDefault("rows", List.of());
            if (!rows.isEmpty()) {
                StringBuilder finding = new StringBuilder("查询结果 " + rowCount + " 行: ");
                int limit = Math.min(rows.size(), 3);
                for (int i = 0; i < limit; i++) {
                    if (i > 0) finding.append("; ");
                    Map<String, Object> row = rows.get(i);
                    boolean first = true;
                    for (Map.Entry<String, Object> e : row.entrySet()) {
                        if (!first) finding.append(", ");
                        finding.append(e.getKey()).append("=").append(e.getValue());
                        first = false;
                    }
                }
                if (rows.size() > 3) finding.append(" ...");
                ev.put("finding", finding.toString());
            } else {
                ev.put("finding", "查询返回 0 行");
                ev.put("anomaly", true);
            }
        }
        evidence.add(ev);
        return evidence;
    }

    private void routeToolCall(Map<String, Object> data, List<Map<String, Object>> messages,
            Map<String, Object> parsed) {
        @SuppressWarnings("unchecked")
        Map<String, Object> toolCall = (Map<String, Object>) parsed.get("tool_call");
        String toolName = (String) toolCall.get("name");
        @SuppressWarnings("unchecked")
        Map<String, Object> toolArgs = (Map<String, Object>) toolCall.getOrDefault("arguments", Map.of());
        String toolCallId = "call_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        toolCall.put("tool_call_id", toolCallId);
        appendReasoning(data, (String) parsed.getOrDefault("reasoning", ""));
        data.put("next_action", "tool_call");
        data.put("pending_tool_call", toolCall);
        addAssistantToolCallMsg(messages, toolCallId, toolName, toolArgs);
    }

    private void routeNl2sql(Map<String, Object> data, List<Map<String, Object>> messages,
            Map<String, Object> parsed) {
        @SuppressWarnings("unchecked")
        List<?> rawConceptIds = (List<?>) parsed.getOrDefault("concept_ids", List.of());
        List<Long> conceptIds = rawConceptIds.stream()
                .filter(v -> v instanceof Number)
                .map(v -> ((Number) v).longValue())
                .collect(Collectors.toList());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> conceptTrace = (List<Map<String, Object>>)
                data.getOrDefault("concept_trace", List.of());
        Set<Long> validConceptIds = conceptTrace.stream()
                .map(c -> c.get("conceptId"))
                .filter(Objects::nonNull)
                .filter(v -> v instanceof Number)
                .map(v -> ((Number) v).longValue())
                .collect(Collectors.toSet());
        for (Long cid : conceptIds) {
            if (!validConceptIds.contains(cid)) {
                String warn = "concept_ids 中的 " + cid + " 不在可用概念列表中，请从上方「概念追踪」表格中获取有效概念ID。";
                messages.add(Map.of("role", "system", "content", warn));
                data.put("next_action", "continue");
                return;
            }
        }

        String sql = (String) parsed.get("sql");
        agentDebug.info("[ROUTE] nl2sql extracted, sqlLen={}, sql=[{}]", sql != null ? sql.length() : 0, sql);

        String joinError = validateJoinConditions(sql, data);
        if (joinError != null) {
            messages.add(Map.of("role", "system", "content", joinError));
            data.put("next_action", "continue");
            return;
        }

        String emptyColumnError = validateEmptyEnumColumns(sql, data);
        if (emptyColumnError != null) {
            messages.add(Map.of("role", "system", "content", emptyColumnError));
            data.put("next_action", "continue");
            return;
        }

        String enumNotCheckedError = validateEnumCheckRequired(sql, data);
        if (enumNotCheckedError != null) {
            messages.add(Map.of("role", "system", "content", enumNotCheckedError));
            data.put("next_action", "continue");
            return;
        }

        if (hasDateFilter(sql) && !Boolean.TRUE.equals(data.get("_date_range_queried"))) {
            messages.add(Map.of("role", "system", "content",
                    "SQL 包含日期过滤条件，但尚未执行日期范围查询。请先执行 SELECT MIN(日期列), MAX(日期列) FROM 表名 确认日期范围，再重新生成正式查询 SQL。"));
            data.put("next_action", "continue");
            return;
        }

        String toolCallId = "call_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        Map<String, Object> pendingNl2sql = new LinkedHashMap<>(parsed);
        pendingNl2sql.put("tool_call_id", toolCallId);
        appendReasoning(data, (String) parsed.getOrDefault("reasoning", ""));
        data.put("next_action", "nl2sql");
        data.put("pending_nl2sql", pendingNl2sql);
        addAssistantToolCallMsg(messages, toolCallId, "nl2sql_executor", Map.of("sql", sql));
    }

    private boolean hasDateFilter(String sql) {
        if (sql == null) return false;
        String lower = sql.toLowerCase();
        if (!lower.contains("where")) return false;
        return java.util.regex.Pattern.compile("'\\d{4}-\\d{2}-\\d{2}'").matcher(lower).find();
    }

    private boolean isDateRangeQuery(String sql) {
        if (sql == null) return false;
        String lower = sql.toLowerCase();
        return (lower.contains("min(") || lower.contains("max("))
                && java.util.regex.Pattern.compile("\\b(date|time|dt|day|month|year)\\b", java.util.regex.Pattern.CASE_INSENSITIVE)
                        .matcher(lower).find();
    }

    private String validateEnumCheckRequired(String sql, Map<String, Object> data) {
        if (sql == null) return null;

        java.util.regex.Pattern pattern = java.util.regex.Pattern.compile(
                "(?i)\\b(\\w+)\\s*(!?=)\\s*'([^']+)'");
        java.util.regex.Matcher matcher = pattern.matcher(sql);
        List<String> stringValues = new ArrayList<>();
        while (matcher.find()) {
            String value = matcher.group(3);
            if (!value.matches("\\d+")) {
                stringValues.add(value);
            }
        }
        if (stringValues.isEmpty()) return null;

        @SuppressWarnings("unchecked")
        Map<String, List<String>> whitelist = (Map<String, List<String>>) data.get("_enum_whitelist");
        @SuppressWarnings("unchecked")
        List<String> emptyColumns = (List<String>) data.get("_enum_empty_columns");
        boolean enumChecked = (whitelist != null && !whitelist.isEmpty())
                || (emptyColumns != null && !emptyColumns.isEmpty());
        if (enumChecked) return null;

        return "SQL 包含字符串等值条件（" + String.join(", ", stringValues) + "），"
                + "但尚未执行 get_enum_values 验证这些值是否存在于对应列中。"
                + "请先使用 get_enum_values 查询相关列的实际值，确认数据存在后再生成 SQL。"
                + "禁止在未验证的情况下直接使用字符串右值。";
    }

    private String validateEmptyEnumColumns(String sql, Map<String, Object> data) {
        if (sql == null) return null;
        @SuppressWarnings("unchecked")
        List<String> emptyColumns = (List<String>) data.get("_enum_empty_columns");
        if (emptyColumns == null || emptyColumns.isEmpty()) return null;

        java.util.regex.Pattern pattern = java.util.regex.Pattern.compile(
                "(\\w+)\\.(\\w+)\\s*=\\s*'[^']*'", java.util.regex.Pattern.CASE_INSENSITIVE);
        java.util.regex.Matcher matcher = pattern.matcher(sql);
        List<String> violations = new ArrayList<>();
        while (matcher.find()) {
            String table = matcher.group(1);
            String column = matcher.group(2);
            String key = table + "." + column;
            if (emptyColumns.contains(key)) {
                violations.add(key);
            }
        }

        if (violations.isEmpty()) return null;

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> tableMappings = (List<Map<String, Object>>) data.get("_tableMappings");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> conceptTrace = (List<Map<String, Object>>)
                data.getOrDefault("concept_trace", List.of());

        StringBuilder sb = new StringBuilder("SQL 引用了无实际数据的列，禁止执行：\n");
        for (String key : violations) {
            sb.append("- ").append(key).append("：该列经 get_enum_values 验证无任何数据\n");
            if (tableMappings != null) {
                for (Map<String, Object> mapping : tableMappings) {
                    String tableName = (String) mapping.get("tableName");
                    String columnName = (String) mapping.get("columnName");
                    if (key.equalsIgnoreCase(tableName + "." + columnName)) {
                        Object conceptId = mapping.get("conceptId");
                        if (conceptId instanceof Number) {
                            for (Map<String, Object> ct : conceptTrace) {
                                if (conceptId.equals(ct.get("conceptId")) && ct.get("conceptName") instanceof String) {
                                    sb.append("  对应概念：「").append(ct.get("conceptName")).append("」（ID ")
                                            .append(conceptId).append("）\n");
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
        sb.append("这属于**数据缺失**而非配置缺失——概念和映射已存在，但数据库中该列无实际数据。\n");
        sb.append("请使用 final_answer 告知用户具体缺失的数据列，不要尝试生成 SQL。");
        return sb.toString();
    }

    private String validateJoinConditions(String sql, Map<String, Object> data) {
        if (sql == null) return null;
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> joinMappings = (List<Map<String, Object>>) data.get("_joinMappings");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> tableMappings = (List<Map<String, Object>>) data.get("_tableMappings");
        if (joinMappings == null || joinMappings.isEmpty()) return null;

        java.util.regex.Matcher joinMatcher = java.util.regex.Pattern.compile(
                "\\bJOIN\\s+(\\w+)\\s+(\\w+)\\s+ON", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(sql);
        java.util.regex.Matcher fromMatcher = java.util.regex.Pattern.compile(
                "\\bFROM\\s+(\\w+)\\s+(\\w+)", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(sql);

        String fromTable = null;
        String fromAlias = null;
        if (fromMatcher.find()) {
            fromTable = fromMatcher.group(1).toLowerCase();
            fromAlias = fromMatcher.group(2).toLowerCase();
        }

        Set<String> domainTables = new HashSet<>();
        if (tableMappings != null) {
            for (Map<String, Object> cm : tableMappings) {
                String tn = (String) cm.get("tableName");
                if (tn != null) domainTables.add(tn.toLowerCase());
            }
        }
        for (Map<String, Object> jm : joinMappings) {
            String jt = (String) jm.get("joinTable");
            if (jt != null) domainTables.add(jt.toLowerCase());
        }

        Set<String> allowedPairs = new HashSet<>();
        for (Map<String, Object> jm : joinMappings) {
            String conceptTable = null;
            Object jmConceptId = jm.get("conceptId");
            if (tableMappings != null) {
                for (Map<String, Object> cm : tableMappings) {
                    if (cm.get("conceptId") != null && cm.get("conceptId").equals(jmConceptId)
                            && cm.get("tableName") != null) {
                        conceptTable = ((String) cm.get("tableName")).toLowerCase();
                        break;
                    }
                }
            }
            String jt = (String) jm.get("joinTable");
            if (conceptTable != null && jt != null) {
                allowedPairs.add(conceptTable + "|" + jt.toLowerCase());
                allowedPairs.add(jt.toLowerCase() + "|" + conceptTable);
            }
        }

        while (joinMatcher.find()) {
            String joinTable = joinMatcher.group(1).toLowerCase();
            if (domainTables.contains(joinTable) && fromTable != null) {
                String pair = fromTable + "|" + joinTable;
                if (!allowedPairs.contains(pair)) {
                    return "SQL 中的 JOIN 表 `" + joinTable + "` 与主表 `" + fromTable
                            + "` 的关联不在预定义 JOIN 列表中。请使用上方「表 JOIN 条件」中预定义的 JOIN 路径，"
                            + "通过预定义 JOIN 链间接到达目标表，禁止自行构造 JOIN 条件。";
                }
            }
        }
        return null;
    }

    private void routeCodeMode(Map<String, Object> data, List<Map<String, Object>> messages,
            Map<String, Object> parsed) {
        String code = (String) parsed.get("code");
        @SuppressWarnings("unchecked")
        Map<String, Object> inputData = (Map<String, Object>) parsed.getOrDefault("input_data", Map.of());
        String toolCallId = "call_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        appendReasoning(data, (String) parsed.getOrDefault("reasoning", ""));
        data.put("next_action", "code_mode");
        data.put("pending_code", Map.of("code", code, "input_data", inputData, "tool_call_id", toolCallId));
        addAssistantToolCallMsg(messages, toolCallId, "code_executor", Map.of("code", code));
    }

    private void routeAlgorithm(Map<String, Object> data, List<Map<String, Object>> messages,
            Map<String, Object> parsed) {
        String algorithmName = (String) parsed.get("algorithm_name");
        @SuppressWarnings("unchecked")
        Map<String, Object> inputData = (Map<String, Object>) parsed.getOrDefault("input_data", Map.of());

        ToolDefinition algorithm = null;
        if (algorithmName != null) {
            algorithm = toolDefinitionRepository.findByName(algorithmName).orElse(null);
            if (algorithm == null) {
                algorithm = toolDefinitionRepository.findByNameAndScope(algorithmName, "PLATFORM").orElse(null);
            }
            if (algorithm == null) {
                List<ToolDefinition> fuzzy = toolDefinitionRepository.findByNameIlike(algorithmName);
                algorithm = fuzzy.stream().filter(t -> t.getToolType() == ToolType.ALGORITHM).findFirst().orElse(null);
            }
        }
        if (algorithm == null) {
            messages.add(Map.of("role", "system", "content",
                    "未找到算法 '" + algorithmName + "'，请使用 code_mode 自行生成代码，或确认算法名称。"));
            data.put("next_action", "continue");
            return;
        }
        if (algorithm.getToolType() != ToolType.ALGORITHM) {
            messages.add(Map.of("role", "system", "content",
                    "工具 '" + algorithmName + "' 不是算法类型，无法通过 algorithm action 调用。"));
            data.put("next_action", "continue");
            return;
        }

        @SuppressWarnings("unchecked")
        Set<String> executedAlgos = (Set<String>) data.getOrDefault("_executed_algorithms", new LinkedHashSet<>());
        if (executedAlgos.contains(algorithm.getName())) {
            messages.add(Map.of("role", "system", "content",
                    "算法 '" + algorithm.getName() + "' 本次对话已执行过，请直接给出 final_answer。"));
            data.put("next_action", "continue");
            return;
        }

        String toolCallId = "call_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        appendReasoning(data, (String) parsed.getOrDefault("reasoning", ""));
        data.put("next_action", "algorithm");
        data.put("pending_algorithm", Map.of(
                "algorithm_id", algorithm.getId(),
                "algorithm_name", algorithm.getName(),
                "input_data", inputData,
                "tool_call_id", toolCallId
        ));
        addAssistantToolCallMsg(messages, toolCallId, "algorithm_executor",
                Map.of("algorithm_name", algorithm.getName(), "input_data", inputData));
    }

    private void routeOntologyAction(Map<String, Object> data, List<Map<String, Object>> messages,
            Map<String, Object> parsed) {
        String sessionId = (String) data.get("session_id");
        String intent = (String) data.getOrDefault("intent", "query");

        if (!"ontology".equals(intent)) {
            data.put("next_action", "final_answer");
            data.put("final_answer", buildMissingConfigMessage(data, parsed));
            return;
        }

        if (!Boolean.TRUE.equals(data.get("_schema_fetched"))) {
            messages.add(Map.of("role", "system", "content",
                    "请先使用 get_table_schema 获取数据源表结构，确认列名后再提交 ontology_action。"));
            data.put("next_action", "continue");
            return;
        }

        List<OntologyChangeLog> pendingChanges = ontologyChangeService.getPendingChanges(sessionId);
        if (pendingChanges != null && !pendingChanges.isEmpty()) {
            data.put("next_action", "final_answer");
            data.put("final_answer", "仍有 " + pendingChanges.size() + " 条本体变更待审核，请先进入本体编辑器审核通过后再提交新的变更。");
            return;
        }
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> changes = (List<Map<String, Object>>) parsed.getOrDefault("changes", List.of());
        String toolCallId = "call_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        appendReasoning(data, (String) parsed.getOrDefault("reasoning", ""));
        data.put("next_action", "ontology_action");
        data.put("pending_ontology_changes", changes);
        data.put("pending_ontology_tool_call_id", toolCallId);
        addAssistantToolCallMsg(messages, toolCallId, "ontology_advisor", Map.of("changes", changes.size()));
    }

    private String buildMissingConfigMessage(Map<String, Object> data, Map<String, Object> parsed) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> conceptTrace = (List<Map<String, Object>>)
                data.getOrDefault("concept_trace", List.of());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> tableMappings = (List<Map<String, Object>>)
                data.getOrDefault("_tableMappings", List.of());

        Map<Long, String> conceptNames = new LinkedHashMap<>();
        for (Map<String, Object> ct : conceptTrace) {
            Object cid = ct.get("conceptId");
            Object cname = ct.get("conceptName");
            if (cid instanceof Number && cname instanceof String) {
                conceptNames.put(((Number) cid).longValue(), (String) cname);
            }
        }

        List<?> parsedConceptIds = (List<?>) parsed.getOrDefault("concept_ids", List.of());
        List<Long> requestedIds = parsedConceptIds.stream()
                .filter(v -> v instanceof Number)
                .map(v -> ((Number) v).longValue())
                .collect(Collectors.toList());

        @SuppressWarnings("unchecked")
        Map<String, List<String>> enumWhitelist = (Map<String, List<String>>)
                data.getOrDefault("_enum_whitelist", Map.of());
        @SuppressWarnings("unchecked")
        List<String> emptyEnumColumns = (List<String>) data.getOrDefault("_enum_empty_columns", List.of());

        if (!requestedIds.isEmpty()) {
            StringBuilder sb = new StringBuilder();
            for (Long cid : requestedIds) {
                String name = conceptNames.getOrDefault(cid, "未知概念");
                sb.append("概念「").append(name).append("」（ID ").append(cid).append("）");

                List<Map<String, Object>> mappingsForConcept = tableMappings.stream()
                        .filter(m -> cid.equals(m.get("conceptId")))
                        .collect(Collectors.toList());

                if (mappingsForConcept.isEmpty()) {
                    sb.append("未配置数据映射（无表/列映射），属于**配置缺失**，请联系管理员补充映射。\n");
                } else {
                    for (Map<String, Object> mapping : mappingsForConcept) {
                        String tableName = (String) mapping.get("tableName");
                        String columnName = (String) mapping.get("columnName");
                        String key = (tableName != null && columnName != null) ? tableName + "." + columnName : null;

                        sb.append("已映射到 ").append(tableName != null ? tableName : "?");
                        if (columnName != null) {
                            sb.append(".").append(columnName);
                        }

                        if (key != null && emptyEnumColumns.contains(key)) {
                            sb.append("，但该列**无实际数据**，属于数据缺失而非配置缺失。\n");
                        } else if (key != null && enumWhitelist.containsKey(key)
                                && enumWhitelist.get(key).isEmpty()) {
                            sb.append("，但该列**无实际数据**，属于数据缺失而非配置缺失。\n");
                        } else {
                            sb.append("。");
                            if (key != null && enumWhitelist.containsKey(key)) {
                                List<String> values = enumWhitelist.get(key);
                                sb.append(" 该列现有值：").append(values).append("。\n");
                            } else {
                                sb.append(" 未通过 get_enum_values 验证数据，可能存在数据缺失。\n");
                            }
                        }
                    }
                }
            }
            if (sb.length() > 0) {
                return sb.toString();
            }
        }

        if (!conceptNames.isEmpty()) {
            return "当前查询涉及的概念已存在，但可能缺少有效的数据映射或数据。"
                    + "请通过 get_enum_values 验证相关列是否有实际数据，或联系管理员确认数据源状态。";
        }

        return "当前无法查询该数据，可能缺少相关概念或数据映射配置，请联系管理员补充。";
    }

    /**
     * P1：历史裁剪——messages 超过 30 条时按"组"压缩早期反馈
     * （assistant(tool_calls) 与其后续 tool 消息为一组，避免拆散导致 LLM API 400）。
     */
    private void trimMessages(List<Map<String, Object>> messages) {
        final int KEEP = 30;
        if (messages.size() <= KEEP) return;
        // 组划分：assistant(tool_calls) 吸收其后续 tool 消息；其余每条一组
        List<List<Map<String, Object>>> groups = new ArrayList<>();
        for (int i = 0; i < messages.size(); i++) {
            Map<String, Object> m = messages.get(i);
            List<Map<String, Object>> group = new ArrayList<>();
            group.add(m);
            boolean hasToolCalls = m.get("tool_calls") != null;
            while (hasToolCalls && i + 1 < messages.size()
                    && "tool".equals(messages.get(i + 1).get("role"))) {
                group.add(messages.get(++i));
            }
            groups.add(group);
        }
        // 从第 2 组开始丢弃，直到剩余消息数 <= KEEP
        int drop = 0;
        int remain = messages.size();
        for (int g = 1; g < groups.size() && remain > KEEP; g++) {
            remain -= groups.get(g).size();
            drop = g + 1;
        }
        if (drop <= 1) return;
        List<Map<String, Object>> trimmed = new ArrayList<>();
        trimmed.addAll(groups.get(0));
        trimmed.add(Map.of("role", "system", "content",
                "（为控制上下文长度，早期 " + (messages.size() - remain) + " 条反馈已省略；"
                + "已执行动作摘要见下方记录）"));
        for (int g = drop; g < groups.size(); g++) {
            trimmed.addAll(groups.get(g));
        }
        log.info("trimMessages: {} -> {} (dropped {} groups)", messages.size(), trimmed.size(), drop - 1);
        messages.clear();
        messages.addAll(trimmed);
    }

    /** P1：动作执行摘要增量注入——让模型记住已尝试的动作，避免每轮重建同样的计划 */
    @SuppressWarnings("unchecked")
    private void injectExecutedActionsSummary(Map<String, Object> data, List<Map<String, Object>> messages) {
        List<String> log = (List<String>) data.get("executed_actions_log");
        if (log == null || log.isEmpty()) return;
        int summarized = (int) data.getOrDefault("executed_actions_summarized", 0);
        if (log.size() <= summarized) return;
        String delta = String.join("\n", log.subList(summarized, log.size()));
        messages.add(Map.of("role", "system", "content",
                "## 你此前已执行的动作（禁止重复执行）\n" + delta));
        data.put("executed_actions_summarized", log.size());
    }

    /** 动作摘要行（供 executed_actions_log 与循环兜底文案使用） */
    private String describeAction(Map<String, Object> parsed) {
        String type = (String) parsed.get("type");
        if (type == null) return "unknown";
        String detail = "";
        if ("nl2sql".equals(type)) {
            String sql = (String) parsed.get("sql");
            detail = sql != null ? " SQL=" + (sql.length() > 100 ? sql.substring(0, 100) + "…" : sql) : "";
        } else if ("get_enum_values".equals(type)) {
            detail = " columns=" + parsed.get("columns");
        } else if ("algorithm".equals(type)) {
            detail = " algorithm=" + parsed.get("algorithm_name");
        }
        return type + detail;
    }

    /** 只读动作预算：每类动作最多 limit 次，超限要求模型立即输出 final_answer */
    @SuppressWarnings("unchecked")
    private boolean reserveReadonlyBudget(Map<String, Object> data, List<Map<String, Object>> messages,
            String actionType) {
        Map<String, Integer> counts = (Map<String, Integer>) data.get("readonly_budget");
        if (counts == null) {
            counts = new LinkedHashMap<>();
            data.put("readonly_budget", counts);
        }
        boolean allowed = com.luban.service.agent.ReadonlyBudget.reserve(counts, actionType,
                com.luban.service.agent.ReadonlyBudget.DEFAULT_LIMIT);
        if (!allowed) {
            log.warn("Agent readonly budget exhausted: {} (iter={})", actionType, data.get("iteration"));
            messages.add(Map.of("role", "system", "content",
                    actionType + " 已达执行上限（" + com.luban.service.agent.ReadonlyBudget.DEFAULT_LIMIT
                            + " 次）。禁止再次调用该动作，请基于已获取的信息立即输出 final_answer；"
                            + "若数据不足以得出结论，请在 final_answer 中如实说明缺失的数据范围。"));
            data.put("next_action", "continue");
        }
        return allowed;
    }

    private void routeRequestContext(Map<String, Object> data, List<Map<String, Object>> messages,
            Map<String, Object> parsed, int iteration) {
        if (!reserveReadonlyBudget(data, messages, "request_context")) return;
        @SuppressWarnings("unchecked")
        List<String> conceptNames = (List<String>) parsed.getOrDefault("concept_names", List.of());
        String requestType = (String) parsed.getOrDefault("request", "all");
        String context = contextBuilder.buildMappingsForConcepts(conceptNames, requestType);
        messages.add(Map.of("role", "user", "content", "以下是你请求的映射信息：\n" + context
                + "\n请继续使用 ontology_action 输出完整的本体变更建议。"));
        data.put("next_action", "agent");
        data.put("iteration", iteration);
    }

    private void routeGetTableSchema(Map<String, Object> data,
            List<Map<String, Object>> messages, Map<String, Object> parsed) {
        if (!reserveReadonlyBudget(data, messages, "get_table_schema")) return;
        List<?> rawIds = (List<?>) parsed.get("datasourceIds");
        List<?> rawTables = (List<?>) parsed.get("tableNames");
        if (rawIds == null || rawIds.isEmpty()) {
            messages.add(Map.of("role", "system", "content",
                    "get_table_schema 缺少 datasourceIds 参数，请从上方「可用数据源」表格中获取数据源ID。"));
            data.put("next_action", "continue");
            return;
        }

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> availableDatasources = (List<Map<String, Object>>) data.get("availableDatasources");
        Set<Long> validDsIds = availableDatasources != null
                ? availableDatasources.stream().map(d -> ((Number) d.get("id")).longValue()).collect(Collectors.toSet())
                : Set.of();

        StringBuilder result = new StringBuilder("以下是你请求的数据源表结构：\n\n");
        int fetched = 0;
        for (Object idObj : rawIds) {
            if (!(idObj instanceof Number)) continue;
            Long dsId = ((Number) idObj).longValue();
            if (!validDsIds.isEmpty() && !validDsIds.contains(dsId)) {
                result.append("数据源ID ").append(dsId).append(" 不存在于可用数据源列表中，已跳过。\n\n");
                continue;
            }
            try {
                Map<String, Object> structure = datasourceService.getStructure(dsId);
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> tables = (List<Map<String, Object>>) structure.get("tables");
                if (tables == null || tables.isEmpty()) {
                    result.append("数据源 ").append(dsId).append(" 无可用表。\n\n");
                    continue;
                }
                List<String> requestedTables = rawTables != null ? rawTables.stream()
                        .map(Object::toString).collect(Collectors.toList()) : null;
                for (Map<String, Object> table : tables) {
                    String tableName = (String) table.get("name");
                    if (requestedTables != null && !requestedTables.isEmpty()
                            && !requestedTables.contains(tableName)) continue;
                    result.append("### ").append(tableName).append("\n");
                    result.append("| 列名 | 类型 | 约束 | 注释 |\n");
                    result.append("|------|------|------|------|\n");
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> columns = (List<Map<String, Object>>) table.get("columns");
                    if (columns != null) {
                        for (Map<String, Object> col : columns) {
                            result.append("| `").append(col.get("name")).append("`")
                                    .append(" | ").append(col.getOrDefault("type", "-"))
                                    .append(" | ").append(Boolean.TRUE.equals(col.getOrDefault("nullable", true)) ? "NULL" : "NOT NULL")
                                    .append(" | ").append(Objects.toString(col.getOrDefault("comment", ""), "-"))
                                    .append(" |\n");
                        }
                    }
                    result.append("\n");
                }
                fetched++;
            } catch (Exception e) {
                log.warn("get_table_schema failed for datasource {}: {}", dsId, e.getMessage());
                result.append("数据源 ").append(dsId).append(" 查询失败：").append(e.getMessage()).append("\n\n");
            }
        }
        if (fetched > 0) {
            data.put("_schema_fetched", true);
            result.append("已获取以上表结构，请继续使用 ontology_action 输出完整的本体变更建议。");
        } else {
            result.append("未能获取到任何有效的表结构，请检查数据源ID是否正确。");
        }
        messages.add(Map.of("role", "user", "content", result.toString()));
        data.put("next_action", "continue");
    }

    private void routeGetEnumValues(Map<String, Object> data, List<Map<String, Object>> messages,
            Map<String, Object> parsed) {
        if (!reserveReadonlyBudget(data, messages, "get_enum_values")) return;
        agentDebug.info("[ENUM] routeGetEnumValues called, columns={}", parsed.get("columns"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> columns = (List<Map<String, Object>>) parsed.get("columns");
        if (columns == null || columns.isEmpty()) {
            messages.add(Map.of("role", "system", "content",
                    "get_enum_values 缺少 columns 参数。请提供需要查询的列列表。"));
            data.put("next_action", "continue");
            return;
        }

        @SuppressWarnings("unchecked")
        Map<String, List<String>> whitelist = (Map<String, List<String>>) data
                .computeIfAbsent("_enum_whitelist", k -> new LinkedHashMap<>());
        @SuppressWarnings("unchecked")
        List<String> emptyColumns = (List<String>) data
                .computeIfAbsent("_enum_empty_columns", k -> new ArrayList<>());

        StringBuilder result = new StringBuilder("以下是你请求的枚举列实际值（请严格使用这些值，不要自行编造）：\n\n");
        result.append("| 表 | 列 | 实际值 |\n");
        result.append("|------|------|--------|\n");

        int fetched = 0;
        for (Map<String, Object> col : columns) {
            String table = (String) col.get("table");
            String column = (String) col.get("column");
            Object dsIdObj = col.get("datasourceId");
            if (table == null || column == null || !(dsIdObj instanceof Number)) {
                continue;
            }
            Long dsId = ((Number) dsIdObj).longValue();
            try {
                Set<String> values = datasourceService.queryDistinctValues(dsId, table, column);
                String key = table + "." + column;
                if (values.isEmpty()) {
                    result.append("| `").append(table).append("` | `").append(column)
                            .append("` | (无数据) |\n");
                    if (!emptyColumns.contains(key)) emptyColumns.add(key);
                } else {
                    result.append("| `").append(table).append("` | `").append(column)
                            .append("` | ").append(values).append(" |\n");
                    whitelist.put(key, new ArrayList<>(values));
                }
                fetched++;
            } catch (Exception e) {
                log.warn("get_enum_values failed for {}.{}: {}", table, column, e.getMessage());
                result.append("| `").append(table).append("` | `").append(column)
                        .append("` | **数据库连接失败**: ").append(e.getMessage()).append(" |\n");
                if (!emptyColumns.contains(table + "." + column)) {
                    emptyColumns.add(table + "." + column);
                }
            }
        }

        if (fetched == 0) {
            result.append("未能获取到任何枚举值，请检查表和列名是否正确。");
        }
        result.append("\n请继续使用 ontology_action 生成本体变更，JOIN 条件中的字符串值必须来自上述返回的实际值。");
        messages.add(Map.of("role", "user", "content", result.toString()));
        data.put("next_action", "continue");

        agentDebug.info("[ENUM] routeGetEnumValues completed, fetched={}, whitelistSize={}", fetched, whitelist.size());
    }

    private void routeParseError(Map<String, Object> data, List<Map<String, Object>> messages,
            Map<String, Object> parsed, int iteration) {
        String raw = (String) parsed.getOrDefault("raw", "");
        int retryCount = (int) data.getOrDefault("nl2sql_retry_count", 0);
        int parseRetryCount = (int) data.getOrDefault("parse_error_retry_count", 0);
        if (retryCount > 0 || parseRetryCount < 1) {
            log.warn("Agent iteration {}: parse_error, retrying (parseRetry={})", iteration, parseRetryCount);
            data.put("parse_error_retry_count", parseRetryCount + 1);
            String formatHint = retryCount > 0
                    ? "你的上一轮回复不是有效的 JSON 格式。请严格按照 JSON 格式输出修正后的 SQL，"
                      + "格式：{\"type\": \"nl2sql\", \"reasoning\": \"...\", \"sql\": \"...\", \"concept_ids\": [...]}"
                    : "你的上一轮回复不是有效的 JSON 格式。请严格按照 JSON 格式回复。";
            messages.add(Map.of("role", "system", "content", formatHint));
            data.put("next_action", "continue");
            data.put("iteration", iteration);
        } else {
            data.put("next_action", "final_answer");
            data.put("final_answer", raw);
            messages.add(Map.of("role", "assistant", "content", raw));
        }
    }

    private void appendReasoning(Map<String, Object> data, String reasoning) {
        if (reasoning == null || reasoning.isEmpty()) return;
        String prev = (String) data.getOrDefault("reasoning", "");
        data.put("reasoning", prev.isEmpty() ? reasoning : prev + "\n\n---\n\n" + reasoning);
    }

    private String addChineseEnglishSpacing(String text) {
        if (text == null || text.isEmpty()) return text;
        return text.replaceAll("([\\u4e00-\\u9fff\\u3400-\\u4dbf])([a-zA-Z0-9])", "$1 $2")
                   .replaceAll("([a-zA-Z0-9])([\\u4e00-\\u9fff\\u3400-\\u4dbf])", "$1 $2");
    }

    private void addAssistantToolCallMsg(List<Map<String, Object>> messages,
            String toolCallId, String toolName, Map<String, Object> args) {
        Map<String, Object> func = new LinkedHashMap<>();
        func.put("name", toolName);
        func.put("arguments", toJsonString(args));
        Map<String, Object> tc = new LinkedHashMap<>();
        tc.put("id", toolCallId);
        tc.put("type", "function");
        tc.put("function", func);
        Map<String, Object> asstMsg = new LinkedHashMap<>();
        asstMsg.put("role", "assistant");
        asstMsg.put("content", null);
        asstMsg.put("tool_calls", List.of(tc));
        messages.add(asstMsg);
    }

    private void sendProgress(String message) {
        java.util.function.Consumer<String> cb = PROGRESS_CALLBACK.get();
        if (cb != null) {
            cb.accept(message);
        }
    }

    private String extractLatestUserQuery(List<Map<String, Object>> messages) {
        for (int i = messages.size() - 1; i >= 0; i--) {
            Map<String, Object> msg = messages.get(i);
            if ("user".equals(msg.get("role"))) {
                String content = (String) msg.get("content");
                if (content != null && !content.isEmpty()) {
                    return content;
                }
            }
        }
        return "";
    }

    private AsyncNodeAction<AgentState> buildNl2sqlExecutorNode() {
        return (state) -> {
            Map<String, Object> data = new LinkedHashMap<>(state.data());

            @SuppressWarnings("unchecked")
            Map<String, Object> nl2sqlCall = (Map<String, Object>) data.get("pending_nl2sql");
            String sql = (String) nl2sqlCall.get("sql");
            String nl2sqlToolCallId = (String) nl2sqlCall.get("tool_call_id");
            @SuppressWarnings("unchecked")
            List<?> rawConceptIds = (List<?>) nl2sqlCall.getOrDefault("concept_ids", List.of());
            List<Long> conceptIds = new ArrayList<>();
            for (Object rawId : rawConceptIds) {
                if (rawId instanceof Number) {
                    conceptIds.add(((Number) rawId).longValue());
                }
            }

            if (conceptIds.isEmpty()) {
                @SuppressWarnings("unchecked")
                List<Long> ctxConceptIds = toLongList((List<?>) data.getOrDefault("concept_ids", List.of()));
                if (ctxConceptIds != null && !ctxConceptIds.isEmpty()) {
                    conceptIds = ctxConceptIds;
                }
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> messages = (List<Map<String, Object>>) data.get("messages");

            data.put("nl2sql", Map.of("sql", sql, "conceptIds", conceptIds));
            agentDebug.info("[EXEC] nl2sql stored, sqlLen={}, sql=[{}]", sql != null ? sql.length() : 0, sql);
            int sqlExecCount = (int) data.getOrDefault("sql_exec_count", 0);
            int retryCount = (int) data.getOrDefault("nl2sql_retry_count", 0);
            if (retryCount == 0) {
                if (sqlExecCount == 0) {
                    sendProgress("正在执行数据分析查询...");
                } else {
                    sendProgress("正在下钻分析第 " + sqlExecCount + " 轮...");
                }
            }
            Long userId = data.get("user_id") instanceof Number
                    ? ((Number) data.get("user_id")).longValue() : null;
            log.info("NL2SQL executor #{}: executing SQL={}", sqlExecCount + 1,
                    sql.length() > 200 ? sql.substring(0, 200) : sql);

            @SuppressWarnings("unchecked")
            Map<String, Map<String, Object>> valueOrigins = (Map<String, Map<String, Object>>) nl2sqlCall.get("value_origins");
            AgentStateData stateData = AgentStateData.fromMap(data);
            Map<String, Object> queryResult = sqlExecutionService.execute(sql, conceptIds, userId, valueOrigins, stateData);
            data.put("query_result", queryResult);

            String error = (String) queryResult.get("error");
            boolean isAuthError = error != null && error.contains("未授权");

            if (error != null && retryCount < NL2SQL_MAX_RETRIES && !isAuthError) {
                data.put("nl2sql_retry_count", retryCount + 1);
                data.put("nl2sql_last_error", error);
                String retryMsg = "SQL 执行失败: " + error + "。请根据错误信息修正 SQL 并重试（第 "
                        + (retryCount + 1) + "/" + NL2SQL_MAX_RETRIES + " 次重试）。";
                messages.add(Map.of("role", "tool", "tool_call_id",
                        nl2sqlToolCallId != null ? nl2sqlToolCallId : "", "content", retryMsg));
                data.put("next_action", "continue");
            } else {
                data.put("nl2sql_retry_count", 0);
                data.remove("nl2sql_last_error");
                if (isAuthError) {
                    String authMsg = "SQL 执行失败: " + error + "。请申请对应域的概念查询权限后再试。";
                    messages.add(Map.of("role", "tool", "tool_call_id",
                            nl2sqlToolCallId != null ? nl2sqlToolCallId : "", "content", authMsg));
                } else {
                    data.put("sql_exec_count", sqlExecCount + 1);
                    Long dsId = queryResult.containsKey("_datasourceId")
                            ? ((Number) queryResult.get("_datasourceId")).longValue() : null;
                    String resultSummary = sqlExecutionService.formatResult(queryResult, sql, dsId);
                    messages.add(Map.of("role", "tool", "tool_call_id",
                            nl2sqlToolCallId != null ? nl2sqlToolCallId : "", "content", resultSummary));

                    if (isDateRangeQuery(sql)) {
                        data.put("_date_range_queried", true);
                    }

                    @SuppressWarnings("unchecked")
                    List<Long> drilled = new ArrayList<>(toLongList((List<?>) data.getOrDefault("drilled_concepts", List.of())));
                    for (Long cid : conceptIds) {
                        if (!drilled.contains(cid)) {
                            drilled.add(cid);
                        }
                    }
                    data.put("drilled_concepts", drilled);
                }
                data.put("next_action", "continue");
            }

            data.remove("pending_nl2sql");
            @SuppressWarnings("unchecked")
            List<String> pa = (List<String>) data.get("pending_actions");
            agentDebug.info("[EXEC_RETURN] pending_actions after exec: {}", pa != null ? pa.size() : "null");
            return CompletableFuture.completedFuture(data);
        };
    }

    private AsyncNodeAction<AgentState> buildToolExecutorNode() {
        return (state) -> {
            Map<String, Object> data = new LinkedHashMap<>(state.data());

            @SuppressWarnings("unchecked")
            Map<String, Object> toolCall = (Map<String, Object>) data.get("pending_tool_call");
            String toolName = (String) toolCall.get("name");
            @SuppressWarnings("unchecked")
            Map<String, Object> toolArgs = (Map<String, Object>) toolCall.getOrDefault("arguments", Map.of());

            int toolCallCount = (int) data.getOrDefault("tool_call_count", 0);
            data.put("tool_call_count", toolCallCount + 1);

            String toolCallId = (String) toolCall.get("tool_call_id");
            String toolResult = executeTool(toolName, toolArgs);

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> messages = (List<Map<String, Object>>) data.get("messages");
            messages.add(Map.of("role", "tool", "tool_call_id", toolCallId != null ? toolCallId : "", "content", toolResult));

            data.put("next_action", "continue");
            data.remove("pending_tool_call");

            return CompletableFuture.completedFuture(data);
        };
    }

    private AsyncNodeAction<AgentState> buildCodeExecutorNode() {
        return (state) -> {
            Map<String, Object> data = new LinkedHashMap<>(state.data());

            @SuppressWarnings("unchecked")
            Map<String, Object> codeCall = (Map<String, Object>) data.get("pending_code");
            String code = (String) codeCall.get("code");
            String codeToolCallId = (String) codeCall.get("tool_call_id");
            @SuppressWarnings("unchecked")
            Map<String, Object> inputData = (Map<String, Object>) codeCall.getOrDefault("input_data", Map.of());

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> messages = (List<Map<String, Object>>) data.get("messages");

            log.info("Code executor: executing code length={}", code.length());
            Map<String, Object> result = codeExecutorService.execute(code, inputData);

            Boolean success = (Boolean) result.getOrDefault("success", false);
            if (success) {
                String stdout = (String) result.getOrDefault("stdout", "");
                messages.add(Map.of("role", "tool", "tool_call_id", codeToolCallId != null ? codeToolCallId : "", "content", "代码执行成功:\n" + stdout));
            } else {
                String stderr = (String) result.getOrDefault("stderr", "未知错误");
                log.warn("Code execution failed: {}", stderr);
                int codeRetry = (int) data.getOrDefault("code_retry_count", 0);
                if (codeRetry < 1) {
                    data.put("code_retry_count", codeRetry + 1);
                    messages.add(Map.of("role", "tool", "tool_call_id", codeToolCallId != null ? codeToolCallId : "", "content",
                            "代码执行失败: " + stderr + "\n请改用 SQL 查询重试，或直接给出 final_answer。"));
                } else {
                    messages.add(Map.of("role", "tool", "tool_call_id", codeToolCallId != null ? codeToolCallId : "", "content",
                            "代码执行再次失败，请直接给出分析结论。"));
                }
            }

            data.put("next_action", "continue");
            data.remove("pending_code");
            return CompletableFuture.completedFuture(data);
        };
    }

    private AsyncNodeAction<AgentState> buildAlgorithmExecutorNode() {
        return (state) -> {
            Map<String, Object> data = new LinkedHashMap<>(state.data());

            @SuppressWarnings("unchecked")
            Map<String, Object> algoCall = (Map<String, Object>) data.get("pending_algorithm");
            Long algorithmId = ((Number) algoCall.get("algorithm_id")).longValue();
            String algorithmName = (String) algoCall.get("algorithm_name");
            String algoToolCallId = (String) algoCall.get("tool_call_id");
            @SuppressWarnings("unchecked")
            Map<String, Object> inputData = (Map<String, Object>) algoCall.getOrDefault("input_data", Map.of());

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> messages = (List<Map<String, Object>>) data.get("messages");
            String sessionId = (String) data.get("session_id");
            String toolCallIdSafe = algoToolCallId != null ? algoToolCallId : "";

            ToolDefinition algorithm = toolDefinitionRepository.findById(algorithmId).orElse(null);
            if (algorithm == null) {
                messages.add(Map.of("role", "tool", "tool_call_id", toolCallIdSafe, "content",
                        buildAlgorithmFallback("SCRIPT_NOT_FOUND", "算法 '" + algorithmName + "' 未找到")));
                data.put("next_action", "continue");
                data.remove("pending_algorithm");
                return CompletableFuture.completedFuture(data);
            }

            com.luban.service.algorithm.AlgorithmConfig algoConfig = com.luban.service.algorithm.AlgorithmConfig.parse(algorithm.getConfig());
            if (algoConfig.getScriptPath() == null || algoConfig.getScriptPath().isBlank()) {
                messages.add(Map.of("role", "tool", "tool_call_id", toolCallIdSafe, "content",
                        buildAlgorithmFallback("SCRIPT_NOT_FOUND", "算法 '" + algorithmName + "' 未上传脚本，请先上传算法脚本")));
                data.put("next_action", "continue");
                data.remove("pending_algorithm");
                return CompletableFuture.completedFuture(data);
            }

            String inputJson = toJsonString(inputData);
            int maxInputSizeBytes = algoConfig.getMaxInputSizeMB() * 1024 * 1024;
            if (inputJson.length() > maxInputSizeBytes) {
                messages.add(Map.of("role", "tool", "tool_call_id", toolCallIdSafe, "content",
                        buildAlgorithmFallback("VALIDATION_ERROR",
                                "input_data 序列化后 " + inputJson.length() + " 字节，超过限制 " + maxInputSizeBytes + " 字节（" + algoConfig.getMaxInputSizeMB() + "MB）")));
                data.put("next_action", "continue");
                data.remove("pending_algorithm");
                return CompletableFuture.completedFuture(data);
            }

            if (algorithm.getInputSchema() != null && !algorithm.getInputSchema().isBlank()) {
                try {
                    Set<com.networknt.schema.ValidationMessage> violations = jsonSchemaValidator.validate(algorithm.getInputSchema(), inputJson);
                    if (!violations.isEmpty()) {
                        String violationMsg = violations.stream().map(com.networknt.schema.ValidationMessage::getMessage).collect(Collectors.joining("; "));
                        messages.add(Map.of("role", "tool", "tool_call_id", toolCallIdSafe, "content",
                                buildAlgorithmFallback("VALIDATION_ERROR", "input_data 不符合 input_schema: " + violationMsg)));
                        data.put("next_action", "continue");
                        data.remove("pending_algorithm");
                        return CompletableFuture.completedFuture(data);
                    }
                } catch (Exception e) {
                    log.warn("Input schema validation skipped: {}", e.getMessage());
                }
            }

            @SuppressWarnings("unchecked")
            Set<String> executedAlgos = (Set<String>) data.getOrDefault("_executed_algorithms", new LinkedHashSet<>());
            if (executedAlgos.contains(algorithmName)) {
                messages.add(Map.of("role", "tool", "tool_call_id", toolCallIdSafe, "content",
                        "算法 '" + algorithmName + "' 本次对话已执行过，请直接给出 final_answer。"));
                data.put("next_action", "continue");
                data.remove("pending_algorithm");
                return CompletableFuture.completedFuture(data);
            }

            log.info("Algorithm executor: executing algorithm id={}, name={}, scriptPath={}", algorithmId, algorithmName, algoConfig.getScriptPath());
            long startMs = System.currentTimeMillis();
            Map<String, Object> result;
            try {
                result = codeExecutorService.executeScript(algoConfig.getScriptPath(), inputData, algoConfig.getTimeout());
            } catch (Exception e) {
                long elapsedMs = System.currentTimeMillis() - startMs;
                saveExecutionLog(algorithmId, sessionId, algoToolCallId, (String) data.getOrDefault("user_query", ""), false, inputJson, null, e.getMessage(), elapsedMs);
                String errorType = e instanceof java.util.concurrent.TimeoutException ? "TIMEOUT" : "EXECUTION_ERROR";
                messages.add(Map.of("role", "tool", "tool_call_id", toolCallIdSafe, "content",
                        buildAlgorithmFallback(errorType, "算法执行异常: " + e.getMessage())));
                data.put("next_action", "continue");
                data.remove("pending_algorithm");
                return CompletableFuture.completedFuture(data);
            }
            long elapsedMs = System.currentTimeMillis() - startMs;

            Boolean success = (Boolean) result.getOrDefault("success", false);
            String stdout = (String) result.getOrDefault("stdout", "");
            String stderr = (String) result.getOrDefault("stderr", "");

            if (success && stdout != null && !stdout.isBlank()) {
                try {
                    objectMapper.readTree(stdout);
                } catch (Exception e) {
                    success = false;
                    stderr = "算法输出不是合法 JSON: " + stdout.substring(0, Math.min(stdout.length(), 200));
                    log.warn("Algorithm output is not valid JSON: {}", stderr);
                }
            }

            if (success && algorithm.getOutputSchema() != null && !algorithm.getOutputSchema().isBlank() && stdout != null) {
                try {
                    Set<com.networknt.schema.ValidationMessage> violations = jsonSchemaValidator.validate(algorithm.getOutputSchema(), stdout);
                    if (!violations.isEmpty()) {
                        String violationMsg = violations.stream().map(com.networknt.schema.ValidationMessage::getMessage).collect(Collectors.joining("; "));
                        success = false;
                        stderr = "算法输出不符合 output_schema: " + violationMsg;
                    }
                } catch (Exception e) {
                    log.warn("Output schema validation skipped: {}", e.getMessage());
                }
            }

            saveExecutionLog(algorithmId, sessionId, algoToolCallId, (String) data.getOrDefault("user_query", ""), success, inputJson, success ? stdout : null, success ? null : stderr, elapsedMs);

            if (success) {
                executedAlgos.add(algorithmName);
                data.put("_executed_algorithms", executedAlgos);
                messages.add(Map.of("role", "tool", "tool_call_id", toolCallIdSafe, "content",
                        "算法执行成功（耗时 " + elapsedMs + "ms）:\n" + stdout));
            } else {
                String errorType = classifyAlgorithmError(stderr);
                log.warn("Algorithm execution failed ({}): {}", errorType, stderr);
                messages.add(Map.of("role", "tool", "tool_call_id", toolCallIdSafe, "content",
                        buildAlgorithmFallback(errorType, "算法执行失败: " + stderr)));
            }

            data.put("next_action", "continue");
            data.remove("pending_algorithm");
            return CompletableFuture.completedFuture(data);
        };
    }

    private String classifyAlgorithmError(String stderr) {
        if (stderr == null) return "EXECUTION_ERROR";
        String lower = stderr.toLowerCase();
        if (lower.contains("timeout") || lower.contains("timed out")) return "TIMEOUT";
        if (lower.contains("oom") || lower.contains("outofmemory") || lower.contains("memoryerror")) return "OOM";
        if (lower.contains("syntaxerror") || lower.contains("syntax error") || lower.contains("indentationerror")) return "SYNTAX_ERROR";
        if (lower.contains("not valid json") || lower.contains("不符合 output_schema") || lower.contains("不符合 input_schema")) return "VALIDATION_ERROR";
        return "EXECUTION_ERROR";
    }

    private String buildAlgorithmFallback(String errorType, String detail) {
        return switch (errorType) {
            case "SCRIPT_NOT_FOUND" -> detail + "。\n降级建议：使用 code_mode 自行生成代码，或确认算法名称后重试。";
            case "SYNTAX_ERROR" -> detail + "。\n降级建议：算法脚本存在语法错误，请联系算法管理员修复。或使用 code_mode 临时生成代码。";
            case "TIMEOUT" -> detail + "。\n降级建议：算法执行超时，可能是输入数据过大或算法复杂度过高。可尝试减小输入数据规模，或使用 code_mode 生成简化版代码。";
            case "OOM" -> detail + "。\n降级建议：算法内存溢出，可能是输入数据过大。可尝试减小输入数据规模，或使用 code_mode 生成简化版代码。";
            case "VALIDATION_ERROR" -> detail + "。\n降级建议：请检查输入/输出参数是否符合算法 Schema 定义，修正后重试。或使用 code_mode 自行生成代码。";
            default -> detail + "。\n降级建议：使用 code_mode 自行生成代码，或直接给出 final_answer。";
        };
    }

    private void saveExecutionLog(Long algorithmId, String sessionId, String toolCallId, String userQuery,
                                  boolean success, String inputData, String outputData, String errorMessage, long elapsedMs) {
        try {
            com.luban.entity.AlgorithmExecutionLog execLog = new com.luban.entity.AlgorithmExecutionLog();
            execLog.setAlgorithmId(algorithmId);
            execLog.setSessionId(sessionId);
            execLog.setToolCallId(toolCallId);
            execLog.setUserQuery(userQuery != null ? userQuery.substring(0, Math.min(userQuery.length(), 2000)) : null);
            execLog.setSuccess(success);
            execLog.setInputData(inputData);
            execLog.setOutputData(outputData);
            execLog.setErrorMessage(errorMessage);
            execLog.setElapsedMs(elapsedMs);
            algorithmExecutionLogRepository.save(execLog);
        } catch (Exception e) {
            log.warn("Failed to save algorithm execution log: {}", e.getMessage());
        }
    }

    private String toJsonString(Object obj) {
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (Exception e) {
            return obj != null ? obj.toString() : "{}";
        }
    }

    private AsyncNodeAction<AgentState> buildOntologyAdvisorNode() {
        return (state) -> {
            Map<String, Object> data = new LinkedHashMap<>(state.data());

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> changes = (List<Map<String, Object>>) data.get("pending_ontology_changes");
            String sessionId = (String) data.get("session_id");
            Long userId = data.get("user_id") instanceof Number ? ((Number) data.get("user_id")).longValue() : null;
            String userName = (String) data.getOrDefault("user_name", "unknown");

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> messages = (List<Map<String, Object>>) data.get("messages");

            List<Map<String, Object>> recorded = new ArrayList<>();
            List<String> validationErrors = new ArrayList<>();
            Map<Long, Map<String, Set<String>>> tableColumnCache = new HashMap<>();

            Set<String> validOperations = OntologyOperationType.allOperationNames();

            Set<String> knownConcepts = contextBuilder.collectKnownConceptNames(changes);

            // 第一遍：全量校验，收集所有错误，不入库
            List<Map<String, Object>> validChanges = new ArrayList<>();
            for (Map<String, Object> change : changes) {
                String operation = (String) change.getOrDefault("operation",
                        change.getOrDefault("type", "UNKNOWN"));

                if (!validOperations.contains(operation)) {
                    validationErrors.add(String.format("- 无效操作类型「%s」，支持的操作：%s",
                            operation, OntologyOperationType.toOperationList()));
                    continue;
                }

                if (!validateChangeIntegrity(operation, change, validationErrors)) {
                    continue;
                }

                if (!validateConceptReference(operation, change, knownConcepts, validationErrors)) {
                    continue;
                }
                if (!validateMappingField(operation, change, tableColumnCache, data, validationErrors)) {
                    continue;
                }

                validChanges.add(change);
            }

            String summary;
            if (!validationErrors.isEmpty()) {
                // 有校验失败，全部不入库，返回错误让 LLM 一次性修复
                summary = "本体变更校验失败，请修正以下问题后重新提交完整的 ontology_action：\n"
                        + String.join("\n", validationErrors)
                        + "\n\n注意：以上所有变更均未入库，请一次性修正所有问题后重新提交。";
            } else {
                // 全部通过，逐条入库
                for (Map<String, Object> change : validChanges) {
                    String operation = (String) change.getOrDefault("operation",
                            change.getOrDefault("type", "UNKNOWN"));
                    OntologyOperationType opType = OntologyOperationType.from(operation);
                    String entityType = (String) change.getOrDefault("entity_type",
                            opType != null ? opType.entityType() : "UNKNOWN");
                    String reasoning = (String) change.getOrDefault("reasoning", "");
                    String beforeSnapshot = change.containsKey("before") ? change.get("before").toString() : null;
                    String afterSnapshot = change.containsKey("after")
                            ? change.get("after").toString()
                            : toJsonString(change);

                    if (beforeSnapshot == null || beforeSnapshot.isEmpty()) {
                        beforeSnapshot = buildBeforeSnapshot(operation, change);
                    }

                    try {
                        OntologyChangeLog log = ontologyChangeService.recordChange(
                                sessionId, operation, entityType, null,
                                beforeSnapshot, afterSnapshot,
                                userId != null ? userId : 0L, userName,
                                "auto_detect", reasoning);
                        recorded.add(Map.of("changeId", log.getChangeId(), "status", log.getStatus()));
                    } catch (Exception e) {
                        log.error("Failed to record ontology change: {}", e.getMessage());
                    }
                }
                summary = "本体变更已记录，共 " + recorded.size() + " 条，等待管理员审核";
            }
            String ontologyToolCallId = (String) data.get("pending_ontology_tool_call_id");
            messages.add(Map.of("role", "tool", "tool_call_id", ontologyToolCallId != null ? ontologyToolCallId : "", "content", summary));

            data.put("next_action", "continue");
            data.remove("pending_ontology_changes");
            data.remove("pending_ontology_tool_call_id");
            return CompletableFuture.completedFuture(data);
        };
    }

    private boolean validateChangeIntegrity(String operation, Map<String, Object> change,
            List<String> errors) {
        switch (operation) {
            case "ADD_CONCEPT": {
                @SuppressWarnings("unchecked")
                Map<String, Object> concept = (Map<String, Object>) change.get("concept");
                String conceptName = concept != null ? (String) concept.get("name") : null;
                if (conceptName != null && !conceptRepository.findByName(conceptName.toString()).isEmpty()) {
                    errors.add(String.format("- ADD_CONCEPT：概念「%s」已存在，请使用 UPDATE_CONCEPT 修改或改用其他名称", conceptName));
                    return false;
                }
                Long industryId = concept != null && concept.get("industryId") instanceof Number
                        ? ((Number) concept.get("industryId")).longValue() : null;
                if (industryId == null) {
                    errors.add("- ADD_CONCEPT：缺少必填字段 industryId");
                    return false;
                }
                boolean valid = industryService.list().stream()
                        .anyMatch(i -> i.getId().equals(industryId));
                if (!valid) {
                    errors.add(String.format("- ADD_CONCEPT：行业ID %d 不存在，请从上方「可用行业与域」表格中选择有效行业", industryId));
                    return false;
                }
                Long dataSourceId = change.get("dataSourceId") instanceof Number
                        ? ((Number) change.get("dataSourceId")).longValue() : null;
                if (dataSourceId != null) {
                    try {
                        Map<String, Object> struct = datasourceService.getStructure(dataSourceId);
                        if (struct.get("error") != null) {
                            errors.add(String.format("- ADD_CONCEPT：数据源ID %d 不存在或无法访问", dataSourceId));
                            return false;
                        }
                    } catch (Exception e) {
                        errors.add(String.format("- ADD_CONCEPT：数据源ID %d 验证失败：%s", dataSourceId, e.getMessage()));
                        return false;
                    }
                }
                break;
            }
            case "UPDATE_CONCEPT": {
                Long conceptId = change.get("id") instanceof Number
                        ? ((Number) change.get("id")).longValue() : null;
                String conceptName = change.get("conceptName") instanceof String
                        ? (String) change.get("conceptName") : null;
                if (conceptId == null && conceptName == null) {
                    errors.add("- UPDATE_CONCEPT：缺少 id 或 conceptName，无法定位目标概念");
                    return false;
                }
                if (conceptId != null && conceptRepository.findById(conceptId).isEmpty()) {
                    errors.add(String.format("- UPDATE_CONCEPT：概念ID %d 不存在", conceptId));
                    return false;
                }
                if (conceptId == null && conceptName != null
                        && conceptRepository.findByName(conceptName).isEmpty()) {
                    errors.add(String.format("- UPDATE_CONCEPT：概念「%s」不存在", conceptName));
                    return false;
                }
                break;
            }
            case "DELETE_CONCEPT": {
                Long conceptId = change.get("id") instanceof Number
                        ? ((Number) change.get("id")).longValue() : null;
                String conceptName = change.get("conceptName") instanceof String
                        ? (String) change.get("conceptName") : null;
                if (conceptId == null && conceptName == null) {
                    errors.add("- DELETE_CONCEPT：缺少 id 或 conceptName，无法定位目标概念");
                    return false;
                }
                if (conceptId != null && conceptRepository.findById(conceptId).isEmpty()) {
                    errors.add(String.format("- DELETE_CONCEPT：概念ID %d 不存在", conceptId));
                    return false;
                }
                if (conceptId == null && conceptName != null
                        && conceptRepository.findByName(conceptName).isEmpty()) {
                    errors.add(String.format("- DELETE_CONCEPT：概念「%s」不存在", conceptName));
                    return false;
                }
                break;
            }
            case "ADD_MAPPING": {
                Map<String, Object> m = (Map<String, Object>) change.get("mapping");
                if (m == null) {
                    errors.add("- ADD_MAPPING：缺少 mapping 数据");
                    return false;
                }
                String conceptName = (String) m.get("conceptName");
                if (conceptName == null || conceptName.isBlank()) {
                    errors.add("- ADD_MAPPING：缺少必填字段 conceptName");
                    return false;
                }
                String tableName = (String) m.get("tableName");
                if (tableName == null || tableName.isBlank()) {
                    errors.add("- ADD_MAPPING：缺少必填字段 tableName");
                    return false;
                }
                String columnName = (String) m.get("columnName");
                if (columnName == null || columnName.isBlank()) {
                    errors.add("- ADD_MAPPING：缺少必填字段 columnName");
                    return false;
                }
                String mappingType = (String) m.get("mappingType");
                if (mappingType == null || mappingType.isBlank()) {
                    errors.add("- ADD_MAPPING：缺少必填字段 mappingType");
                    return false;
                }
                if (!(m.get("dataSourceId") instanceof Number)) {
                    errors.add("- ADD_MAPPING：缺少必填字段 dataSourceId");
                    return false;
                }
                break;
            }
            case "ADD_JOIN_MAPPING": {
                Map<String, Object> j = (Map<String, Object>) change.get("joinMapping");
                if (j == null) {
                    errors.add("- ADD_JOIN_MAPPING：缺少 joinMapping 数据");
                    return false;
                }
                String conceptName = (String) j.get("conceptName");
                if (conceptName == null || conceptName.isBlank()) {
                    errors.add("- ADD_JOIN_MAPPING：缺少必填字段 conceptName");
                    return false;
                }
                String joinTable = (String) j.get("joinTable");
                if (joinTable == null || joinTable.isBlank()) {
                    errors.add("- ADD_JOIN_MAPPING：缺少必填字段 joinTable");
                    return false;
                }
                String joinCondition = (String) j.get("joinCondition");
                if (joinCondition == null || joinCondition.isBlank()) {
                    errors.add("- ADD_JOIN_MAPPING：缺少必填字段 joinCondition");
                    return false;
                }
                String relationType = (String) j.get("relationType");
                if (relationType == null || relationType.isBlank()) {
                    errors.add("- ADD_JOIN_MAPPING：缺少必填字段 relationType");
                    return false;
                }
                String targetConcept = (String) j.get("targetConcept");
                if (targetConcept == null || targetConcept.isBlank()) {
                    errors.add("- ADD_JOIN_MAPPING：缺少必填字段 targetConcept，请填写 joinTable 对应的概念名");
                    return false;
                }
                if (!(j.get("dataSourceId") instanceof Number)) {
                    errors.add("- ADD_JOIN_MAPPING：缺少必填字段 dataSourceId");
                    return false;
                }
                break;
            }
            case "UPDATE_MAPPING":
            case "DELETE_MAPPING":
            case "UPDATE_JOIN_MAPPING":
            case "DELETE_JOIN_MAPPING": {
                Long mappingId = change.get("id") instanceof Number
                        ? ((Number) change.get("id")).longValue() : null;
                if (mappingId == null) {
                    errors.add(String.format("- %s：缺少 id 字段，无法定位目标映射", operation));
                    return false;
                }
                boolean exists = false;
                if (operation.contains("JOIN")) {
                    exists = conceptJoinMappingRepository.findById(mappingId).isPresent();
                } else {
                    exists = conceptMappingRepository.findById(mappingId).isPresent();
                }
                if (!exists) {
                    errors.add(String.format("- %s：映射ID %d 不存在", operation, mappingId));
                    return false;
                }
                break;
            }
            default:
                break;
        }
        return true;
    }

    private boolean validateConceptReference(String operation, Map<String, Object> change,
                                              Set<String> knownConcepts, List<String> errors) {
        String conceptName = null;
        String refType = null;

        switch (operation) {
            case "ADD_MAPPING": {
                @SuppressWarnings("unchecked")
                Map<String, Object> mappingData = (Map<String, Object>) change.get("mapping");
                if (mappingData != null) {
                    conceptName = (String) mappingData.get("conceptName");
                    refType = "映射";
                }
                break;
            }
            case "ADD_JOIN_MAPPING": {
                @SuppressWarnings("unchecked")
                Map<String, Object> joinData = (Map<String, Object>) change.get("joinMapping");
                if (joinData != null) {
                    conceptName = (String) joinData.get("conceptName");
                    refType = "表连接";
                    String targetConcept = (String) joinData.get("targetConcept");
                    if (targetConcept != null && !knownConcepts.contains(targetConcept)
                            && conceptRepository.findByName(targetConcept).isEmpty()) {
                        errors.add(String.format("- ADD_JOIN_MAPPING：目标概念「%s」不存在，请先用 ADD_CONCEPT 创建该概念", targetConcept));
                        return false;
                    }
                }
                break;
            }
            case "ADD_RELATION": {
                @SuppressWarnings("unchecked")
                Map<String, Object> relationData = (Map<String, Object>) change.get("relation");
                if (relationData != null) {
                    String sourceName = (String) relationData.get("sourceConceptName");
                    String targetName = (String) relationData.get("targetConceptName");
                    if (sourceName != null && !knownConcepts.contains(sourceName)
                            && conceptRepository.findByName(sourceName).isEmpty()) {
                        errors.add(String.format("- ADD_RELATION：源概念「%s」不存在，请先创建该概念", sourceName));
                        return false;
                    }
                    if (targetName != null && !knownConcepts.contains(targetName)
                            && conceptRepository.findByName(targetName).isEmpty()) {
                        errors.add(String.format("- ADD_RELATION：目标概念「%s」不存在，请先创建该概念", targetName));
                        return false;
                    }
                    return true;
                }
                break;
            }
            default:
                return true;
        }

        if (conceptName != null && !knownConcepts.contains(conceptName)
                && conceptRepository.findByName(conceptName).isEmpty()) {
            errors.add(String.format("- %s：概念「%s」不存在，请先用 ADD_CONCEPT 创建该概念再添加%s",
                    operation, conceptName, refType));
            return false;
        }
        return true;
    }

    private boolean validateMappingField(String operation, Map<String, Object> change,
                                          Map<Long, Map<String, Set<String>>> cache,
                                          Map<String, Object> data,
                                          List<String> errors) {
        if ("ADD_MAPPING".equals(operation) || "UPDATE_MAPPING".equals(operation)) {
            return validateMappingFieldInternal(operation, change, cache, errors);
        }
        if ("ADD_JOIN_MAPPING".equals(operation) || "UPDATE_JOIN_MAPPING".equals(operation)) {
            return validateJoinMappingField(operation, change, cache, data, errors);
        }
        return true;
    }

    private boolean validateMappingFieldInternal(String operation, Map<String, Object> change,
                                                  Map<Long, Map<String, Set<String>>> cache,
                                                  List<String> errors) {
        @SuppressWarnings("unchecked")
        Map<String, Object> mappingData = (Map<String, Object>) change.get("mapping");
        if (mappingData == null) {
            return true;
        }

        String mappingType = (String) mappingData.getOrDefault("mappingType", "direct");
        if ("computed".equals(mappingType)) {
            return true;
        }

        String tableName = (String) mappingData.get("tableName");
        String columnName = (String) mappingData.get("columnName");
        Object dsIdObj = mappingData.get("dataSourceId");

        if (tableName == null || columnName == null || !(dsIdObj instanceof Number)) {
            return true;
        }

        Long dsId = ((Number) dsIdObj).longValue();
        Set<String> columns = getActualTableColumns(dsId, tableName, cache);
        if (columns == null) {
            log.warn("Cannot validate column existence for {}.{} (datasource {} unavailable), skipping validation",
                    tableName, columnName, dsId);
            return true;
        }

        String conceptName = (String) mappingData.getOrDefault("conceptName", "?");

        if (!cache.containsKey(dsId) || !cache.get(dsId).containsKey(tableName)) {
            errors.add(String.format("- %s：表 `%s` 在数据源中不存在（概念：%s，请确认表名是否正确）",
                    operation, tableName, conceptName));
            return false;
        }

        if (!columns.contains(columnName)) {
            errors.add(String.format("- %s：表 `%s` 中不存在列 `%s`（概念：%s，mappingType：%s）",
                    operation, tableName, columnName, conceptName, mappingType));
            return false;
        }

        return true;
    }

    private boolean validateJoinMappingField(String operation, Map<String, Object> change,
                                              Map<Long, Map<String, Set<String>>> cache,
                                              Map<String, Object> data,
                                              List<String> errors) {
        @SuppressWarnings("unchecked")
        Map<String, Object> joinData = (Map<String, Object>) change.get("joinMapping");
        if (joinData == null) {
            return true;
        }

        Object dsIdObj = joinData.get("dataSourceId");
        if (!(dsIdObj instanceof Number)) {
            return true;
        }
        Long dsId = ((Number) dsIdObj).longValue();

        String joinTable = (String) joinData.get("joinTable");
        String joinCondition = (String) joinData.get("joinCondition");
        String conceptName = (String) joinData.getOrDefault("conceptName", "?");

        if (joinTable != null) {
            Set<String> columns = getActualTableColumns(dsId, joinTable, cache);
            if (columns == null) {
                log.warn("Cannot validate table {} for joinMapping, skipping", joinTable);
            } else if (!cache.containsKey(dsId) || !cache.get(dsId).containsKey(joinTable)) {
                errors.add(String.format("- %s：连接表 `%s` 在数据源中不存在（概念：%s）", operation, joinTable, conceptName));
                return false;
            } else if (joinCondition != null) {
                validateJoinConditionEnums(dsId, joinTable, joinCondition, columns, conceptName, data, errors);
            }
        }

        return true;
    }

    private void validateJoinConditionEnums(Long dsId, String joinTable, String joinCondition,
                                             Set<String> tableColumns, String conceptName,
                                             Map<String, Object> data,
                                             List<String> errors) {
        @SuppressWarnings("unchecked")
        Map<String, List<String>> whitelist = (Map<String, List<String>>) data.get("_enum_whitelist");
        java.util.regex.Pattern pattern = java.util.regex.Pattern.compile(
                "(?:\\w+\\.)?(\\w+)\\s*=\\s*'([^']*)'");
        java.util.regex.Matcher matcher = pattern.matcher(joinCondition);
        while (matcher.find()) {
            String columnName = matcher.group(1);
            String value = matcher.group(2);
            if (!tableColumns.contains(columnName)) {
                continue;
            }
            String key = joinTable + "." + columnName;
            if (whitelist != null && whitelist.containsKey(key)) {
                if (!whitelist.get(key).contains(value)) {
                    errors.add(String.format(
                            "- ADD_JOIN_MAPPING：JOIN 条件 `%s = '%s'` 中，值 '%s' 不在白名单内。"
                            + "`%s` 的实际值：%s。请修正（概念：%s）",
                            columnName, value, value, key, whitelist.get(key), conceptName));
                }
            } else {
                try {
                    Set<String> actualValues = datasourceService.queryDistinctValues(dsId, joinTable, columnName);
                    if (!actualValues.isEmpty()) {
                        errors.add(String.format(
                                "- ADD_JOIN_MAPPING：JOIN 条件中使用了列 `%s` 的字符串值 '%s'，但该列未在 get_enum_values 白名单中声明。"
                                + "请先使用 get_enum_values 声明需要查询的枚举列，当前 `%s` 的实际值：%s（概念：%s）",
                                columnName, value, key, actualValues, conceptName));
                    }
                } catch (Exception e) {
                    log.warn("JOIN_MAPPING validation: queryDistinctValues failed for {}.{}: {}",
                            joinTable, columnName, e.getMessage());
                }
            }
        }
    }

    private Set<String> getActualTableColumns(Long datasourceId, String tableName,
                                               Map<Long, Map<String, Set<String>>> cache) {
        Map<String, Set<String>> dsCache = cache.computeIfAbsent(datasourceId, k -> new HashMap<>());
        if (dsCache.containsKey(tableName)) {
            return dsCache.get(tableName);
        }

        try {
            Map<String, Object> structure = datasourceService.getStructure(datasourceId);
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> tables = (List<Map<String, Object>>) structure.get("tables");
            if (tables != null) {
                for (Map<String, Object> table : tables) {
                    String name = (String) table.get("name");
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> cols = (List<Map<String, Object>>) table.get("columns");
                    Set<String> colNames = new HashSet<>();
                    if (cols != null) {
                        for (Map<String, Object> col : cols) {
                            String colName = (String) col.get("name");
                            if (colName != null) {
                                colNames.add(colName);
                            }
                        }
                    }
                    dsCache.put(name, colNames);
                }
            }
        } catch (Exception e) {
            log.warn("Failed to get table structure for datasource {}: {}", datasourceId, e.getMessage());
            return null;
        }

        return dsCache.getOrDefault(tableName, Collections.emptySet());
    }

    @SuppressWarnings("unchecked")
    private String buildBeforeSnapshot(String operation, Map<String, Object> change) {
        try {
            switch (operation) {
                case "UPDATE_CONCEPT": {
                    Map<String, Object> conceptData = (Map<String, Object>) change.get("concept");
                    if (conceptData == null) break;
                    Object idObj = conceptData.get("id");
                    if (idObj instanceof Number) {
                        Concept concept = conceptRepository.findById(((Number) idObj).longValue()).orElse(null);
                        if (concept != null) {
                            return objectMapper.writeValueAsString(Map.of(
                                    "id", concept.getId(),
                                    "name", concept.getName(),
                                    "description", concept.getDescription() != null ? concept.getDescription() : "",
                                    "anomalyThresholdExpr", concept.getAnomalyThresholdExpr() != null ? concept.getAnomalyThresholdExpr() : "",
                                    "anomalyThresholdDesc", concept.getAnomalyThresholdDesc() != null ? concept.getAnomalyThresholdDesc() : ""
                            ));
                        }
                    }
                    break;
                }
                case "UPDATE_MAPPING": {
                    Map<String, Object> mappingData = (Map<String, Object>) change.get("mapping");
                    if (mappingData == null) break;
                    Object idObj = mappingData.get("mappingId");
                    if (idObj instanceof Number) {
                        ConceptMapping mapping = conceptMappingRepository.findById(((Number) idObj).longValue()).orElse(null);
                        if (mapping != null) {
                            Map<String, Object> snap = new LinkedHashMap<>();
                            snap.put("id", mapping.getId());
                            snap.put("tableName", mapping.getTableName());
                            snap.put("columnName", mapping.getColumnName());
                            snap.put("mappingType", mapping.getMappingType() != null ? mapping.getMappingType() : "");
                            snap.put("datasourceId", mapping.getDatasourceId());
                            if (mapping.getComputedExpr() != null && !mapping.getComputedExpr().isBlank()) {
                                snap.put("computedExpr", mapping.getComputedExpr());
                            }
                            return objectMapper.writeValueAsString(snap);
                        }
                    }
                    break;
                }
                case "UPDATE_JOIN_MAPPING": {
                    Map<String, Object> joinData = (Map<String, Object>) change.get("joinMapping");
                    if (joinData == null) break;
                    Object idObj = joinData.get("joinMappingId");
                    if (idObj instanceof Number) {
                        ConceptJoinMapping join = conceptJoinMappingRepository.findById(((Number) idObj).longValue()).orElse(null);
                        if (join != null) {
                            return objectMapper.writeValueAsString(Map.of(
                                    "id", join.getId(),
                                    "joinTable", join.getJoinTable(),
                                    "joinCondition", join.getJoinCondition(),
                                    "relationType", join.getRelationType() != null ? join.getRelationType() : "",
                                    "targetConcept", join.getTargetConcept() != null ? join.getTargetConcept() : "",
                                    "datasourceId", join.getDatasourceId()
                            ));
                        }
                    }
                    break;
                }
            }
        } catch (Exception e) {
            log.warn("Failed to build beforeSnapshot for {}: {}", operation, e.getMessage());
        }
        return null;
    }

    private AsyncNodeAction<AgentState> buildFinalAnswerNode() {
        return (state) -> {
            Map<String, Object> data = new LinkedHashMap<>(state.data());
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> finalMessages = (List<Map<String, Object>>) data.get("messages");
            String faVal = (String) data.getOrDefault("final_answer", "");
            agentDebug.info("[FINAL_ANSWER_NODE] final_answer from state: len={}, preview={}",
                    faVal.length(),
                    faVal.length() > 300 ? faVal.substring(0, 300) : faVal);
            log.info("FINAL_ANSWER node: messagesSize={}, lastMsgRole={}",
                    finalMessages != null ? finalMessages.size() : 0,
                    finalMessages != null && !finalMessages.isEmpty() ? finalMessages.get(finalMessages.size() - 1).get("role") : "null");
            data.put("next_action", "final_answer");
            String messageId = UUID.randomUUID().toString();
            data.put("message_id", messageId);
            return CompletableFuture.completedFuture(data);
        };
    }

    private AsyncEdgeAction<AgentState> buildRouterEdge() {
        return (state) -> {
            String nextAction = (String) state.data().getOrDefault("next_action", "final_answer");
            return CompletableFuture.completedFuture(nextAction);
        };
    }

    private String callLlm(AgentConfig config, List<Map<String, Object>> messages, String toolsPrompt, boolean isAdmin) {
        java.util.function.Consumer<String> onChunk = STREAM_CALLBACK.get();
        java.util.function.Consumer<String> onReasoning = REASONING_CALLBACK.get();
        int maxRetries = 3;
        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            try {
            List<Map<String, Object>> fullMessages = new ArrayList<>();
            fullMessages.add(Map.of("role", "system", "content", buildSystemPrompt(isAdmin)));

            if (toolsPrompt != null && !toolsPrompt.isEmpty()) {
                fullMessages.add(Map.of("role", "system", "content", toolsPrompt));
            } else {
                fullMessages.add(Map.of("role", "system", "content", "请直接回答用户的问题。"));
            }

            fullMessages.addAll(messages);

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", config.getModelName());
            body.put("messages", fullMessages);
            body.put("temperature", 0.3);
            body.put("max_tokens", 4096);
            body.put("stream", true);

            String chatUrl = agentConfigService.normalizeChatUrl(config.getModelEndpoint());
            log.info("LLM call: url={}, model={}, stream=true, messagesCount={}",
                    chatUrl, config.getModelName(), fullMessages.size());
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(chatUrl))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + agentConfigService.decrypt(config.getSecretKeyEnc()))
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                    .timeout(LLM_HARD_TIMEOUT)
                    .build();

            CompletableFuture<String> resultFuture = new CompletableFuture<>();
            java.util.concurrent.atomic.AtomicReference<java.util.concurrent.ScheduledFuture<?>> idleWatchdog =
                    new java.util.concurrent.atomic.AtomicReference<>();
            long startTime = System.currentTimeMillis();
            java.util.concurrent.atomic.AtomicBoolean firstTokenLogged = new java.util.concurrent.atomic.AtomicBoolean(false);
            final StringBuilder fullContent = new StringBuilder();
            final StringBuilder reasoningBuf = new StringBuilder();

            Runnable resetIdleTimer = () -> {
                java.util.concurrent.ScheduledFuture<?> old = idleWatchdog.get();
                if (old != null) old.cancel(false);
                idleWatchdog.set(idleExecutor.schedule(() -> {
                    if (!resultFuture.isDone()) {
                        log.warn("LLM streaming idle timeout after {}s", LLM_IDLE_TIMEOUT.getSeconds());
                        resultFuture.completeExceptionally(
                                new java.util.concurrent.TimeoutException("LLM 流式空闲超时"));
                    }
                }, LLM_IDLE_TIMEOUT.toSeconds(), java.util.concurrent.TimeUnit.SECONDS));
            };

            httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofLines())
                    .thenAccept(response -> {
                        try {
                            if (response.statusCode() != 200) {
                                StringBuilder errorBody = new StringBuilder();
                                response.body().forEach(line -> errorBody.append(line).append("\n"));
                                log.error("LLM API error: status={}, url={}, model={}, body={}",
                                        response.statusCode(), chatUrl, config.getModelName(), errorBody.toString().trim());
                                resultFuture.completeExceptionally(
                                        new RuntimeException("LLM streaming API 返回 " + response.statusCode()));
                                return;
                            }
                            resetIdleTimer.run();
                            response.body().forEach(line -> {
                                resetIdleTimer.run();
                                if (!line.startsWith("data: ")) {
                                    if (!line.isEmpty()) {
                                        log.warn("LLM returned non-SSE line: {}", line);
                                    }
                                    return;
                                }
                                String data = line.substring(6).trim();
                                if ("[DONE]".equals(data)) {
                                    return;
                                }
                                try {
                                    Map<String, Object> chunk = objectMapper.readValue(data,
                                            new TypeReference<Map<String, Object>>() {});
                                    @SuppressWarnings("unchecked")
                                    List<Map<String, Object>> choices = (List<Map<String, Object>>) chunk.get("choices");
                                    if (choices != null && !choices.isEmpty()) {
                                        @SuppressWarnings("unchecked")
                                        Map<String, Object> delta = (Map<String, Object>) choices.get(0).get("delta");
                                        if (delta != null) {
                                            String content = (String) delta.get("content");
                                            String reasoningContent = (String) delta.get("reasoning_content");
                                            if (reasoningContent != null && !reasoningContent.isEmpty()) {
                                                reasoningBuf.append(reasoningContent);
                                                if (onReasoning != null) {
                                                    onReasoning.accept(addChineseEnglishSpacing(reasoningContent));
                                                }
                                            }
                                            if (content != null && !content.isEmpty()) {
                                                if (!firstTokenLogged.getAndSet(true)) {
                                                    long ttft = System.currentTimeMillis() - startTime;
                                                    log.info("LLM TTFT: {}ms", ttft);
                                                }
                                                fullContent.append(content);
                                                if (onChunk != null) {
                                                    onChunk.accept(addChineseEnglishSpacing(content));
                                                }
                                            }
                                        }
                                    }
                                } catch (Exception e) {
                                    log.debug("Failed to parse streaming chunk: {}", line);
                                }
                            });
                            long total = System.currentTimeMillis() - startTime;
                            String result;
                            if (fullContent.length() > 0) {
                                result = fullContent.toString();
                            } else if (reasoningBuf.length() > 0) {
                                log.warn("LLM returned only reasoning_content ({} chars), using as fallback", reasoningBuf.length());
                                result = reasoningBuf.toString();
                            } else {
                                result = "";
                            }
                            log.info("LLM streaming completed: total={}ms, contentLen={}, reasoningLen={}",
                                    total, fullContent.length(), reasoningBuf.length());
                            resultFuture.complete(result);
                        } catch (Exception e) {
                            resultFuture.completeExceptionally(e);
                        }
                    })
                    .exceptionally(ex -> {
                        resultFuture.completeExceptionally(ex);
                        return null;
                    });

            try {
                String result = resultFuture.join();
                if (reasoningBuf.length() > 0) {
                    LLM_REASONING_BUFFER.set(reasoningBuf);
                    agentDebug.info("[LLM_REASONING_BUFFER] SET on thread={}, len={}, preview={}",
                            Thread.currentThread().getName(), reasoningBuf.length(),
                            reasoningBuf.length() > 200 ? reasoningBuf.substring(0, 200) : reasoningBuf.toString());
                } else {
                    agentDebug.info("[LLM_REASONING_BUFFER] SKIP (reasoningBuf empty) on thread={}", Thread.currentThread().getName());
                }
                return result;
            } finally {
                java.util.concurrent.ScheduledFuture<?> sf = idleWatchdog.get();
                if (sf != null) sf.cancel(false);
            }
        } catch (java.util.concurrent.CompletionException e) {
                Throwable cause = e.getCause();
                String msg = cause != null ? cause.getMessage() : e.getMessage();
                if (msg != null && msg.contains("429") && attempt < maxRetries) {
                    long delay = (long) Math.pow(2, attempt) * 1000;
                    log.warn("LLM 429 rate limited, retrying in {}ms (attempt {}/{})", delay, attempt + 1, maxRetries);
                    try { Thread.sleep(delay); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
                    continue;
                }
                if (cause instanceof java.util.concurrent.TimeoutException) {
                    log.error("LLM streaming idle timeout", cause);
                    throw new RuntimeException(cause.getMessage());
                }
                log.error("LLM streaming call failed", cause != null ? cause : e);
                throw new RuntimeException("LLM 流式调用失败: " + (cause != null ? cause.getMessage() : e.getMessage()));
            } catch (Exception e) {
                String msg = e.getMessage();
                if (msg != null && msg.contains("429") && attempt < maxRetries) {
                    long delay = (long) Math.pow(2, attempt) * 1000;
                    log.warn("LLM 429 rate limited, retrying in {}ms (attempt {}/{})", delay, attempt + 1, maxRetries);
                    try { Thread.sleep(delay); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
                    continue;
                }
                log.error("LLM streaming call failed", e);
                throw new RuntimeException("LLM 流式调用失败: " + e.getMessage());
            }
        }
        throw new RuntimeException("LLM 流式调用失败: 重试次数已用完");
    }

    private String buildSystemPrompt(boolean isAdmin) {
        StringBuilder sb = new StringBuilder();
        sb.append("你是鲁班核心 Agent，一个企业数据查询助手。\n");
        sb.append("你的职责是帮助用户查询企业数据");
        if (isAdmin) {
            sb.append("，并在必要时自动发现本体配置缺陷");
        }
        sb.append("。\n");
        sb.append("请用中文回答。回答要简洁、准确、专业。\n\n");
        sb.append("## 当前时间\n");
        sb.append("- 当前日期: ").append(java.time.LocalDate.now()).append("\n");
        sb.append("- 当前时间: ").append(java.time.LocalTime.now().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))).append("\n");
        sb.append("- 星期: ").append(switch (java.time.LocalDate.now().getDayOfWeek()) {
            case MONDAY -> "星期一";
            case TUESDAY -> "星期二";
            case WEDNESDAY -> "星期三";
            case THURSDAY -> "星期四";
            case FRIDAY -> "星期五";
            case SATURDAY -> "星期六";
            case SUNDAY -> "星期日";
        }).append("\n");
        sb.append("用户提到「上个月」「昨天」「本周」等相对时间时，请以当前日期为基准计算。\n");
        sb.append("但查询数据时，由于数据库中的实际数据时间可能与当前时间不同，请先确认数据时间范围。\n\n");

        if (isAdmin) {
            sb.append("你有八种方式回答用户问题：\n");
            sb.append("1. 调用 API 工具获取数据\n");
            sb.append("2. 获取枚举列实际值（get_enum_values，**在 nl2sql 和 ontology_action 前必须执行**，验证 SQL WHERE 条件中字符串右值对应的列是否有数据，无数据时直接 final_answer 告知用户）\n");
            sb.append("3. 生成 SQL 查询数据库（仅限 SELECT，**仅当 get_enum_values 确认所有右值列有数据时才执行**，禁止臆造右值）\n");
            sb.append("4. 调用企业算法（algorithm，**前置检验全部通过后才可调用**，单次对话同一算法最多执行 1 次）\n");
            sb.append("5. 执行 Python 代码分析数据（code_mode）\n");
            sb.append("6. 获取数据源表结构（get_table_schema，本体管理前置步骤，在生成本体变更前必须执行）\n");
            sb.append("7. 生成本体管理建议（ontology_action，仅超管可用，必须在 get_table_schema 和 get_enum_values 之后）\n");
            sb.append("8. 直接回答（final_answer）\n\n");
        } else {
            sb.append("你有六种方式回答用户问题：\n");
            sb.append("1. 调用 API 工具获取数据\n");
            sb.append("2. 获取枚举列实际值（get_enum_values，**在 nl2sql 前必须执行**，验证 SQL WHERE 条件中字符串右值对应的列是否有数据，无数据时直接 final_answer 告知用户）\n");
            sb.append("3. 生成 SQL 查询数据库（仅限 SELECT，**仅当 get_enum_values 确认所有右值列有数据时才执行**，禁止臆造右值）\n");
            sb.append("4. 调用企业算法（algorithm，**前置检验全部通过后才可调用**，单次对话同一算法最多执行 1 次）\n");
            sb.append("5. 执行 Python 代码分析数据（code_mode）\n");
            sb.append("6. 直接回答（final_answer）\n\n");
        }

        sb.append("## 关键规则：空枚举值短路\n");
        sb.append("**get_enum_values 返回的所有列都为空时，必须立即 final_answer 告知用户数据缺失，禁止继续执行 nl2sql、algorithm 或任何其他 action。**\n");
        sb.append("不要在枚举值全空后仍然尝试 nl2sql 查询，这只会浪费时间。\n\n");

        sb.append("## algorithm action 格式\n");
        sb.append("调用企业算法时，输出以下 JSON：\n");
        sb.append("```json\n");
        sb.append("{\"type\": \"algorithm\", \"reasoning\": \"前置检验已通过，调用算法...\", \"algorithm_name\": \"算法名称\", \"input_data\": {...}}\n");
        sb.append("```\n");
        sb.append("- `algorithm_name`：必须与可用算法列表中的名称精确匹配\n");
        sb.append("- `input_data`：必须符合算法的 input_schema 定义\n");
        sb.append("- 前置检验未通过时，禁止调用算法，应直接 final_answer 说明原因\n");
        sb.append("- 若某项前置检验或算法输入所需的表/列不在【可用数据源】列表中，视为该项**不可满足**：禁止再次生成针对缺失表的查询，禁止反复尝试；直接输出 final_answer，说明数据缺失范围与基于已有数据的分析结论\n");
        sb.append("- 同一动作（相同 type+SQL 或相同参数）禁止生成两次；某查询已执行且无新信息时，应推进分析或输出 final_answer\n");
        sb.append("- 算法执行失败时，系统会提供降级建议，可按建议使用 code_mode 或 final_answer\n\n");

        sb.append("请根据上下文信息选择最合适的方式，并在 reasoning 中说明你的推理过程。\n");
        sb.append("所有回复必须严格按照 JSON 格式，不要添加额外文本。\n");
        sb.append("如需同时调用多个工具（如 get_table_schema + get_enum_values），可一次输出多个 JSON 对象，系统会依次执行并返回所有结果。\n");
        sb.append("不要预设后续步骤，不要在一次回复中输出过多 action。\n");
        sb.append("## 表格格式规范\n");
        sb.append("final_answer 的 answer 字段中需要展示表格时，必须使用 Markdown 表格（管道符 | 分隔），禁止 Tab 字符。\n\n");
        sb.append("## 下钻分析规则\n");
        sb.append("上文中出现「可下钻维度」表格时，说明当前查询结果可进一步按子维度拆解分析。\n");
        sb.append("**重要：请自动继续下钻，不要停在 final_answer 给建议。**\n");
        sb.append("每次 SQL 查询得到结果后，如果发现数据异常（超过阈值）或值得深入分析，\n");
        sb.append("应立即生成**一个** nl2sql 继续下钻到子维度，等待结果，而不是一次性输出多个 nl2sql 或跳去 final_answer。\n");
        sb.append("**下钻必须严格按照「可下钻维度」表格中列出的维度链依次进行，每次只走一步，不要跳步。**\n");
        sb.append("只有当所有可下钻维度都已分析完毕、数据无明显异常无需继续、或 SQL 连续返回 0 行无法继续时，才使用 final_answer 总结根因。\n");
        sb.append("final_answer 中如需总结已分析的下钻路径，以 `[drill_suggestions]` 为标记。\n");
        sb.append("如果维度有异常阈值，且当前查询结果触发了阈值，必须在 reasoning 中明确指出异常。\n");
        sb.append("例如：「订单量环比下降15%，超过10%阈值，继续按渠道下钻分析」。\n\n");
        sb.append("## 关联维度交叉验证规则\n");
        sb.append("上文中出现「关联维度（交叉验证）」表格时，说明存在与当前概念相关联的维度，需要交叉验证以排除干扰因素。\n");
        sb.append("**在完成所有下钻维度分析后、输出 final_answer 之前，对每个关联维度逐个生成一个 nl2sql 进行交叉验证，每次只验证一个，等待结果后再验证下一个。**\n");
        sb.append("关联维度的用途是确认根因是否由该维度变化导致，例如：\n");
        sb.append("- 客诉率上升 → 检查订单量是否暴涨（如果是，则客诉率的上升可能是分母变大导致，而非真实客诉变多）\n");
        sb.append("- 退货率上升 → 检查销量是否暴涨（如果是，则退货率的上升可能是分母变大导致）\n");
        sb.append("关联维度验证完毕后，在 final_answer 的 evidence 中包含关联维度的验证结果，并标注 anomaly 为 false（除非关联维度本身也异常）。\n\n");
        sb.append("## 根因分析输出规范\n");
        sb.append("final_answer 必须包含 evidence 证据链和 root_cause 根因总结。\n");
        sb.append("root_cause 为结构化对象：summary 为整体结论，items 中每个受影响实体独立描述其故障。\n");
        sb.append("item 之间不得推断依赖关系，如有明确数据支撑的因果关联，在 detail 中引用 evidence 注明。\n");
        if (isAdmin) {
            sb.append("\n");
            sb.append("## 本体管理规则\n");
            sb.append("当用户明确要求管理本体，或分析过程中发现概念缺失/关系不完整/映射错误时，可使用 ontology_action。\n");
            sb.append("支持操作：").append(OntologyOperationType.toOperationList()).append("。\n");
            sb.append("每条 change 必须包含 operation 字段（或 type 字段）和 entity_type 字段。entity_type 取值：CONCEPT（概念操作）、RELATION（关系操作）、MAPPING（映射操作）、JOIN_MAPPING（表连接操作）。\n");
            sb.append("change 格式示例：\n");
            sb.append(OntologyOperationType.toPromptExamples());
            sb.append("内置关系类型（relationType 字段优先使用已有类型，如无合适类型可自定义新关系名称）：\n");
            sb.append(OntologyOperationType.BuiltinRelation.toPromptList());
            sb.append("变更不会自动生效，需管理员审核确认。变更数量不做限制，按实际需求完整配置。");
        }
        return sb.toString();
    }

    private Object safeParseJson(String json) {
        try {
            if (json.startsWith("[")) {
                return objectMapper.readValue(json, List.class);
            }
            return objectMapper.readValue(json, Map.class);
        } catch (Exception e) {
            return json;
        }
    }

    private String typeSignature(Map<String, Object> parsed) {
        String type = (String) parsed.get("type");
        if (type == null) return null;
        @SuppressWarnings("unchecked")
        List<Object> conceptIds = (List<Object>) parsed.get("concept_ids");
        String ids = conceptIds != null ? conceptIds.stream()
                .sorted().map(String::valueOf).collect(Collectors.joining(",")) : "";
        String contentSig = "";
        if ("nl2sql".equals(type)) {
            String sql = (String) parsed.get("sql");
            if (sql != null) contentSig = "|" + sql;
        } else if ("code_mode".equals(type)) {
            String code = (String) parsed.get("code");
            if (code != null) contentSig = "|" + code;
        }
        return type + "|" + ids + contentSig;
    }

    private Map<String, Object> parseResponse(String response) {
        try {
            Map<String, Object> result = objectMapper.readValue(response, new TypeReference<Map<String, Object>>() {});
            log.info("parseResponse success: type={}, jsonLen={}", result.get("type"), response.length());
            if ("nl2sql".equals(result.get("type"))) {
                String sql = (String) result.get("sql");
                agentDebug.info("[PARSE] type=nl2sql, sqlLen={}, sql=[{}]", sql != null ? sql.length() : 0, sql);
            }
            return result;
        } catch (Exception e) {
            log.warn("parseResponse failed, falling back to parse_error: {}", e.getMessage());
            return Map.of("type", "parse_error", "raw", response);
        }
    }

    private List<String> extractJsons(String response) {
        response = response.trim();
        List<String> jsons = new ArrayList<>();
        int pos = 0;

        log.info("extractJsons: responseLen={}, preview={}",
                response.length(),
                response.length() > 100 ? response.substring(0, 100) : response);

        while (pos < response.length()) {
            int start = response.indexOf('{', pos);
            if (start < 0) break;

            int braceCount = 0;
            boolean inString = false;
            boolean escaped = false;
            int end = -1;
            for (int i = start; i < response.length(); i++) {
                char c = response.charAt(i);
                if (escaped) { escaped = false; continue; }
                if (c == '\\') { escaped = true; continue; }
                if (c == '"') { inString = !inString; continue; }
                if (!inString) {
                    if (c == '{') braceCount++;
                    else if (c == '}') {
                        braceCount--;
                        if (braceCount == 0) { end = i; break; }
                    }
                }
            }

            if (end < 0) break;

            String json = response.substring(start, end + 1);
            try {
                objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
                jsons.add(json);
            } catch (Exception e) {
                log.warn("extractJsons: invalid JSON at pos {}: {}", start, e.getMessage());
            }

            pos = end + 1;
        }

        log.info("extractJsons: found {} valid JSON objects", jsons.size());
        return jsons;
    }

    private String executeTool(String toolName, Map<String, Object> arguments) {
        ToolDefinition tool = toolDefinitionRepository.findByName(toolName).orElse(null);
        if (tool == null) {
            return "{\"error\": \"Tool not found: " + toolName + "\"}";
        }
        try {
            ToolType toolType = tool.getToolType();
            return switch (toolType) {
                case HTTP -> httpExecutor.execute(tool, arguments, "agent");
                case MCP_PASSTHROUGH -> mcpExecutor.execute(tool, arguments);
                case ALGORITHM -> {
                    com.luban.service.algorithm.AlgorithmConfig algoConfig = com.luban.service.algorithm.AlgorithmConfig.parse(tool.getConfig());
                    if (algoConfig.getScriptPath() == null || algoConfig.getScriptPath().isBlank()) {
                        yield "{\"error\": \"算法未上传脚本\"}";
                    }
                    Map<String, Object> result = codeExecutorService.executeScript(algoConfig.getScriptPath(), arguments, algoConfig.getTimeout());
                    yield result.toString();
                }
            };
        } catch (Exception e) {
            log.error("Tool execution failed: {}", toolName, e);
            return "{\"error\": \"" + e.getMessage() + "\"}";
        }
    }
}