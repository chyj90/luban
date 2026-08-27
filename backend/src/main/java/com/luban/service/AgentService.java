package com.luban.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.AgentConfig;
import com.luban.entity.AgentQueryLog;
import com.luban.entity.ChatMessage;
import com.luban.entity.ChatDatasourceSelection;
import com.luban.entity.ChatRootCause;
import com.luban.entity.Concept;
import com.luban.entity.ConceptJoinMapping;
import com.luban.entity.ConceptMapping;
import com.luban.entity.ToolConcept;
import com.luban.entity.ToolDefinition;
import com.luban.entity.ToolGroup;
import com.luban.executor.HttpExecutor;
import com.luban.executor.McpExecutor;
import com.luban.repository.AgentConfigRepository;
import com.luban.repository.ChatMessageRepository;
import com.luban.repository.ChatDatasourceSelectionRepository;
import com.luban.repository.ChatRootCauseRepository;
import com.luban.repository.ConceptJoinMappingRepository;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptRepository;
import com.luban.entity.ConceptRelation;
import com.luban.entity.OntologyChangeLog;
import com.luban.entity.OntologyGroup;
import com.luban.repository.ConceptRelationRepository;
import com.luban.repository.OntologyGroupRepository;
import com.luban.repository.ToolConceptRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.repository.ToolGroupRepository;
import lombok.extern.slf4j.Slf4j;
import org.bsc.langgraph4j.CompiledGraph;
import org.bsc.langgraph4j.StateGraph;
import org.bsc.langgraph4j.action.AsyncEdgeAction;
import org.bsc.langgraph4j.action.AsyncNodeAction;
import org.bsc.langgraph4j.state.AgentState;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.sql.DataSource;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
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
    private final ToolEmbeddingService toolEmbeddingService;
    private final FaissService faissService;
    private final OntologyService ontologyService;
    private final ConceptMappingRepository conceptMappingRepository;
    private final ConceptJoinMappingRepository conceptJoinMappingRepository;
    private final ConceptRepository conceptRepository;
    private final ToolConceptRepository toolConceptRepository;
    private final ConceptRelationRepository conceptRelationRepository;
    private final RoleConceptPermissionService roleConceptPermissionService;
    private final SqlSecurityValidator sqlSecurityValidator;
    private final DatasourceService datasourceService;
    private final AgentMetricsService agentMetricsService;
    private final Nl2sqlConnectionPool nl2sqlConnectionPool;
    private final ChatMessageRepository chatMessageRepository;
    private final ChatDatasourceSelectionRepository chatDatasourceSelectionRepository;
    private final ChatRootCauseRepository chatRootCauseRepository;
    private final OntologyGroupRepository ontologyGroupRepository;
    private final CodeExecutorService codeExecutorService;
    private final OntologyChangeService ontologyChangeService;
    private final IndustryService industryService;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private final ConcurrentHashMap<String, List<Map<String, Object>> > conversationHistories = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompiledGraph<AgentState>> compiledGraphs = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Deque<Long>> rateLimitBuckets = new ConcurrentHashMap<>();
    private final AtomicInteger totalCallCount = new AtomicInteger(0);
    
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
                        ToolEmbeddingService toolEmbeddingService,
                        FaissService faissService,
                        OntologyService ontologyService,
                        ConceptMappingRepository conceptMappingRepository,
                        ConceptJoinMappingRepository conceptJoinMappingRepository,
                        ConceptRepository conceptRepository,
                        ToolConceptRepository toolConceptRepository,
                        ConceptRelationRepository conceptRelationRepository,
                        RoleConceptPermissionService roleConceptPermissionService,
                        SqlSecurityValidator sqlSecurityValidator,
                        DatasourceService datasourceService,
                        AgentMetricsService agentMetricsService,
                        Nl2sqlConnectionPool nl2sqlConnectionPool,
                        ChatMessageRepository chatMessageRepository,
                        ChatDatasourceSelectionRepository chatDatasourceSelectionRepository,
                        ChatRootCauseRepository chatRootCauseRepository,
                        OntologyGroupRepository ontologyGroupRepository,
                        CodeExecutorService codeExecutorService,
                        OntologyChangeService ontologyChangeService,
                        IndustryService industryService) {
        this.agentConfigRepository = agentConfigRepository;
        this.agentConfigService = agentConfigService;
        this.toolDefinitionRepository = toolDefinitionRepository;
        this.toolGroupRepository = toolGroupRepository;
        this.httpExecutor = httpExecutor;
        this.mcpExecutor = mcpExecutor;
        this.toolEmbeddingService = toolEmbeddingService;
        this.faissService = faissService;
        this.ontologyService = ontologyService;
        this.conceptMappingRepository = conceptMappingRepository;
        this.conceptJoinMappingRepository = conceptJoinMappingRepository;
        this.conceptRepository = conceptRepository;
        this.toolConceptRepository = toolConceptRepository;
        this.conceptRelationRepository = conceptRelationRepository;
        this.roleConceptPermissionService = roleConceptPermissionService;
        this.sqlSecurityValidator = sqlSecurityValidator;
        this.datasourceService = datasourceService;
        this.agentMetricsService = agentMetricsService;
        this.nl2sqlConnectionPool = nl2sqlConnectionPool;
        this.chatMessageRepository = chatMessageRepository;
        this.chatDatasourceSelectionRepository = chatDatasourceSelectionRepository;
        this.chatRootCauseRepository = chatRootCauseRepository;
        this.ontologyGroupRepository = ontologyGroupRepository;
        this.codeExecutorService = codeExecutorService;
        this.ontologyChangeService = ontologyChangeService;
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
            finalAnswer.put("answer", finalData.getOrDefault("final_answer", "处理完成"));
            finalAnswer.put("answerType", finalData.getOrDefault("answer_type", ""));
            finalAnswer.put("rootCause", finalData.getOrDefault("root_cause", ""));
            finalAnswer.put("suggestion", finalData.getOrDefault("suggestion", ""));
            finalAnswer.put("evidence", finalData.getOrDefault("evidence", List.of()));
            finalAnswer.put("iterations", finalData.getOrDefault("iteration", 0));
            finalAnswer.put("history", history);
            finalAnswer.put("conceptTrace", usedConceptTrace != null ? usedConceptTrace : finalData.getOrDefault("concept_trace", List.of()));
            finalAnswer.put("reasoning", finalData.getOrDefault("reasoning", ""));
            finalAnswer.put("llm_reasoning", finalData.getOrDefault("llm_reasoning", ""));
            finalAnswer.put("nl2sql", finalData.getOrDefault("nl2sql", null));
            finalAnswer.put("queryResult", finalData.getOrDefault("query_result", null));
            finalAnswer.put("sqlExecCount", finalData.getOrDefault("sql_exec_count", 0));
            finalAnswer.put("messageId", finalData.getOrDefault("message_id", UUID.randomUUID().toString()));
            finalAnswer.put("usedConcepts", usedConcepts);
            finalAnswer.put("select_datasources", finalData.getOrDefault("select_datasources", null));

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
        }
    }

    @Transactional
    public void clearSession(String sessionId) {
        conversationHistories.remove(sessionId);
        compiledGraphs.remove(sessionId);
        try {
            chatMessageRepository.deleteBySessionId(sessionId);
            chatDatasourceSelectionRepository.deleteBySessionId(sessionId);
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

            String conceptTraceJson = null;
            Object conceptTrace = finalAnswer.get("conceptTrace");
            if (conceptTrace != null) {
                conceptTraceJson = objectMapper.writeValueAsString(conceptTrace);
            }

            String reasoning = (String) finalAnswer.get("reasoning");
            String llmReasoning = (String) finalAnswer.get("llm_reasoning");
            if (llmReasoning != null && !llmReasoning.isEmpty()) {
                reasoning = (reasoning != null && !reasoning.isEmpty())
                        ? llmReasoning + "\n\n---\n\n" + reasoning
                        : llmReasoning;
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

            Object selectDatasources = finalAnswer.get("select_datasources");
            if (selectDatasources instanceof List && !((List<?>) selectDatasources).isEmpty()) {
                ChatDatasourceSelection ds = ChatDatasourceSelection.builder()
                        .messageId(messageId)
                        .sessionId(sessionId)
                        .datasources(objectMapper.writeValueAsString(selectDatasources))
                        .build();
                chatDatasourceSelectionRepository.save(ds);
            }

            Object rootCause = finalAnswer.get("rootCause");
            Object suggestion = finalAnswer.get("suggestion");
            Object evidence = finalAnswer.get("evidence");
            if ((rootCause != null && !rootCause.toString().isEmpty())
                    || (suggestion != null && !suggestion.toString().isEmpty())
                    || (evidence instanceof List && !((List<?>) evidence).isEmpty())) {
                ChatRootCause cr = ChatRootCause.builder()
                        .messageId(messageId)
                        .sessionId(sessionId)
                        .rootCause(rootCause != null ? rootCause.toString() : null)
                        .suggestion(suggestion != null ? suggestion.toString() : null)
                        .evidence(evidence != null ? objectMapper.writeValueAsString(evidence) : null)
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
            List<ChatDatasourceSelection> selections = chatDatasourceSelectionRepository.findBySessionId(sessionId);
            Map<String, String> selectionMap = new java.util.HashMap<>();
            for (ChatDatasourceSelection sel : selections) {
                selectionMap.put(sel.getMessageId(), sel.getDatasources());
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
                    String dsJson = selectionMap.get(msg.getMessageId());
                    if (dsJson != null) {
                        try {
                            item.put("selectDatasources", objectMapper.readValue(dsJson, List.class));
                        } catch (Exception e) {
                            log.warn("Failed to parse selectDatasources for history message={}", msg.getMessageId());
                        }
                    }
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
        List<ChatDatasourceSelection> selections = chatDatasourceSelectionRepository.findBySessionId(sessionId);
        Map<String, String> selectionMap = new java.util.HashMap<>();
        for (ChatDatasourceSelection sel : selections) {
            selectionMap.put(sel.getMessageId(), sel.getDatasources());
        }
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
                String dsJson = selectionMap.get(msg.getMessageId());
                if (dsJson != null) {
                    try {
                        item.put("selectDatasources", objectMapper.readValue(dsJson, List.class));
                    } catch (Exception e) {
                        log.warn("Failed to parse selectDatasources for message={}", msg.getMessageId());
                    }
                }
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
            List<Long> conceptIds = (List<Long>) finalData.getOrDefault("concept_ids", List.of());
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

        graph.addNode("agent", buildAgentNode(config));
        graph.addNode("tool_executor", buildToolExecutorNode());
        graph.addNode("nl2sql_executor", buildNl2sqlExecutorNode());
        graph.addNode("code_executor", buildCodeExecutorNode());
        graph.addNode("ontology_advisor", buildOntologyAdvisorNode());
        graph.addNode("select_datasources", buildSelectDatasourcesNode());
        graph.addNode("final_answer", buildFinalAnswerNode());

        graph.addEdge("__START__", "agent");

        graph.addConditionalEdges("agent", buildRouterEdge(), Map.of(
                "tool_call", "tool_executor",
                "nl2sql", "nl2sql_executor",
                "code_mode", "code_executor",
                "ontology_action", "ontology_advisor",
                "select_datasources", "select_datasources",
                "final_answer", "final_answer",
                "continue", "agent"
        ));

        graph.addEdge("tool_executor", "agent");
        graph.addEdge("nl2sql_executor", "agent");
        graph.addEdge("code_executor", "agent");
        graph.addEdge("ontology_advisor", "agent");
        graph.addEdge("select_datasources", "final_answer");

        graph.addEdge("final_answer", "__END__");

        return graph.compile();
    }

    private AsyncNodeAction<AgentState> buildAgentNode(AgentConfig config) {
        return (state) -> {
            Map<String, Object> data = new LinkedHashMap<>(state.data());
            int iteration = (int) data.getOrDefault("iteration", 0);
            int llmCallCount = (int) data.getOrDefault("llm_call_count", 0);

            if (iteration >= MAX_ITERATIONS) {
                data.put("next_action", "final_answer");
                data.put("final_answer", "已达到最大迭代次数，请重试。");
                return CompletableFuture.completedFuture(data);
            }

            int sqlExecCount = (int) data.getOrDefault("sql_exec_count", 0);

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> messages = (List<Map<String, Object>>) data.get("messages");
            String sessionId = (String) data.get("session_id");
            Long userId = data.get("user_id") instanceof Number ? ((Number) data.get("user_id")).longValue() : null;

            // 检查 pending_actions 队列：LLM 上次返回了多个动作，逐个消费（不消耗下钻轮数）
            @SuppressWarnings("unchecked")
            List<String> pendingActions = (List<String>) data.get("pending_actions");
            Map<String, Object> parsed;

            if (pendingActions != null && !pendingActions.isEmpty()) {
                String nextJson = pendingActions.remove(0);
                if (pendingActions.isEmpty()) {
                    data.remove("pending_actions");
                }
                parsed = parseResponse(nextJson);
                data.put("iteration", iteration + 1);
                log.info("Agent iteration {}: consumed from queue, type={}, remaining={}",
                        iteration, parsed.get("type"), pendingActions.size());
            } else {
                // 队列为空，需要调 LLM
                if (sqlExecCount >= MAX_DRILL_ROUNDS) {
                    // 已达最大下钻轮数，调 LLM 基于已有结果生成总结
                    log.info("Agent iteration {}: max drill rounds reached, calling LLM for summary", iteration);
                    data.put("llm_call_count", llmCallCount + 1);
                    messages.add(Map.of("role", "system", "content",
                            "已完成 " + sqlExecCount + " 轮下钻分析。请基于以上所有查询结果，以 final_answer 格式给出最终根因分析总结，"
                            + "包含 evidence 证据链和 root_cause 根因。不要再生成新的 SQL。"));
                    String userQuery = extractLatestUserQuery(messages);
                    Map<String, Object> unifiedContext = buildUnifiedContext(sessionId, userQuery, messages, userId);
                    boolean isAdmin = userId != null && roleConceptPermissionService.isSuperAdmin(userId);
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> conceptTrace = (List<Map<String, Object>>) unifiedContext.get("conceptTrace");
                    @SuppressWarnings("unchecked")
                    List<Long> conceptIds = (List<Long>) unifiedContext.get("conceptIds");
                    data.put("concept_trace", conceptTrace);
                    data.put("concept_ids", conceptIds);
                    data.put("availableDatasources", unifiedContext.get("availableDatasources"));
                    String llmResponse = callLlm(config, messages, (String) unifiedContext.get("prompt"), isAdmin);
                    StringBuilder llmReasoning = LLM_REASONING_BUFFER.get();
                    if (llmReasoning != null && llmReasoning.length() > 0) {
                        String prev = (String) data.getOrDefault("llm_reasoning", "");
                        data.put("llm_reasoning", prev.isEmpty() ? llmReasoning.toString() : prev + "\n\n---\n\n" + llmReasoning.toString());
                        LLM_REASONING_BUFFER.remove();
                    }
                    String prevRaw = (String) data.getOrDefault("llm_raw_output", "");
                    data.put("llm_raw_output", prevRaw.isEmpty() ? llmResponse : prevRaw + "\n" + llmResponse);
                    data.put("last_llm_response", llmResponse);
                    data.put("iteration", iteration + 1);
                    parsed = parseResponse(llmResponse);
                } else {
                    // 正常流程：检查下钻完成度
                    @SuppressWarnings("unchecked")
                    List<Long> drilledConcepts = (List<Long>) data.getOrDefault("drilled_concepts", List.of());
                    @SuppressWarnings("unchecked")
                    List<Long> currentConceptIds = (List<Long>) data.getOrDefault("concept_ids", List.of());
                    if (sqlExecCount > 0 && !currentConceptIds.isEmpty()) {
                        boolean allDrilled = currentConceptIds.stream().allMatch(drilledConcepts::contains);
                        if (allDrilled) {
                            log.info("All concepts already drilled, suggesting final answer");
                            data.put("next_action", "final_answer");
                            data.put("final_answer", "所有相关维度已完成下钻分析，请查看之前的分析结果。");
                            return CompletableFuture.completedFuture(data);
                        }
                    }

                    String userQuery = extractLatestUserQuery(messages);
                    if (iteration == 0) {
                        sendProgress("正在检索相关概念和数据库表...");
                    } else if (sqlExecCount > 0) {
                        sendProgress("正在分析第 " + sqlExecCount + " 轮下钻结果...");
                    }
                    Map<String, Object> unifiedContext = buildUnifiedContext(sessionId, userQuery, messages, userId);

                    boolean isAdmin = userId != null && roleConceptPermissionService.isSuperAdmin(userId);

                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> conceptTrace = (List<Map<String, Object>>) unifiedContext.get("conceptTrace");
                    String unifiedPrompt = (String) unifiedContext.get("prompt");
                    @SuppressWarnings("unchecked")
                    List<Long> conceptIds = (List<Long>) unifiedContext.get("conceptIds");

                    data.put("concept_trace", conceptTrace);
                    data.put("concept_ids", conceptIds);
                    data.put("availableDatasources", unifiedContext.get("availableDatasources"));

                    data.put("llm_call_count", llmCallCount + 1);
                    long tLlm = System.currentTimeMillis();
                    String llmResponse = callLlm(config, messages, unifiedPrompt, isAdmin);
                    StringBuilder llmReasoning = LLM_REASONING_BUFFER.get();
                    if (llmReasoning != null && llmReasoning.length() > 0) {
                        String prev = (String) data.getOrDefault("llm_reasoning", "");
                        data.put("llm_reasoning", prev.isEmpty() ? llmReasoning.toString() : prev + "\n\n---\n\n" + llmReasoning.toString());
                        LLM_REASONING_BUFFER.remove();
                    }
                    String prevRaw = (String) data.getOrDefault("llm_raw_output", "");
                    data.put("llm_raw_output", prevRaw.isEmpty() ? llmResponse : prevRaw + "\n" + llmResponse);
                    log.info("Agent iteration {}: LLM call completed in {}ms",
                            iteration, System.currentTimeMillis() - tLlm);
                    data.put("last_llm_response", llmResponse);
                    data.put("iteration", iteration + 1);

                    List<String> allJsons = extractJsons(llmResponse);
                    if (allJsons.isEmpty()) {
                        parsed = parseResponse(llmResponse);
                    } else {
                        parsed = parseResponse(allJsons.get(0));
                        // 循环检测：同一 action type + concept_ids 连续出现超过阈值则强制结束
                        String currentSig = typeSignature(parsed);
                        String lastSig = (String) data.get("last_action_signature");
                        int repeatCount = (int) data.getOrDefault("action_repeat_count", 0);
                        if (currentSig != null && currentSig.equals(lastSig)) {
                            repeatCount++;
                            data.put("action_repeat_count", repeatCount);
                            if (repeatCount >= 2) {
                                log.warn("Agent iteration {}: loop detected (sig={}, count={}), requesting summary",
                                        iteration, currentSig, repeatCount);
                                messages.add(Map.of("role", "system", "content",
                                        "请停止继续生成 SQL，直接输出 final_answer 总结当前分析结果。"));
                                try {
                                    Map<String, Object> summaryContext = buildUnifiedContext(sessionId, userQuery, messages, userId);
                                    String summaryResponse = callLlm(config, messages, (String) summaryContext.get("prompt"), isAdmin);
                                    prevRaw = (String) data.getOrDefault("llm_raw_output", "");
                                    data.put("llm_raw_output", prevRaw.isEmpty() ? summaryResponse : prevRaw + "\n" + summaryResponse);
                                    List<String> summaryJsons = extractJsons(summaryResponse);
                                    Map<String, Object> finalParsed = !summaryJsons.isEmpty()
                                            ? parseResponse(summaryJsons.get(0))
                                            : parseResponse(summaryResponse);
                                    if ("final_answer".equals(finalParsed.get("type"))) {
                                        data.putAll(finalParsed);
                                    }
                                } catch (Exception e) {
                                    log.warn("Summary call failed: {}", e.getMessage());
                                }
                                data.putIfAbsent("final_answer", "分析已达当前数据深度极限，请查看之前的分析结果。");
                                data.put("next_action", "final_answer");
                                return CompletableFuture.completedFuture(data);
                            }
                        } else {
                            data.put("action_repeat_count", 0);
                            data.put("last_action_signature", currentSig);
                        }
                        if (allJsons.size() > 1) {
                            data.put("pending_actions", new ArrayList<>(allJsons.subList(1, allJsons.size())));
                            log.info("Agent iteration {}: queued {} pending actions", iteration, allJsons.size() - 1);
                        }
                    }
                }
            }

            String type = (String) parsed.get("type");
            log.info("Agent iteration {}: action type={}, preview={}",
                    iteration, type,
                    parsed.toString().length() > 200 ? parsed.toString().substring(0, 200) : parsed.toString());

            if ("final_answer".equals(type)) {
                String answer = (String) parsed.get("answer");
                String reasoning = (String) parsed.getOrDefault("reasoning", "");
                String prevReasoning = (String) data.getOrDefault("reasoning", "");
                data.put("next_action", "final_answer");
                data.put("final_answer", answer);
                data.put("reasoning", prevReasoning.isEmpty() ? reasoning : prevReasoning + "\n\n---\n\n" + reasoning);
                data.put("answer_type", parsed.getOrDefault("answer_type", ""));
                data.put("root_cause", parsed.getOrDefault("root_cause", ""));
                data.put("suggestion", parsed.getOrDefault("suggestion", ""));
                data.put("evidence", parsed.getOrDefault("evidence", List.of()));
                // 提取 LLM 识别的概念ID
                List<?> rawIds = (List<?>) parsed.get("concept_ids");
                if (rawIds != null && !rawIds.isEmpty()) {
                    data.put("recognized_concept_ids", rawIds.stream()
                            .map(id -> id instanceof Number ? ((Number) id).longValue() : null)
                            .filter(id -> id != null)
                            .collect(Collectors.toList()));
                }
                messages.add(Map.of("role", "assistant", "content", answer));
            } else if ("tool_call".equals(type)) {
                @SuppressWarnings("unchecked")
                Map<String, Object> toolCall = (Map<String, Object>) parsed.get("tool_call");
                String toolName = (String) toolCall.get("name");
                @SuppressWarnings("unchecked")
                Map<String, Object> toolArgs = (Map<String, Object>) toolCall.getOrDefault("arguments", Map.of());
                String toolCallId = "call_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
                toolCall.put("tool_call_id", toolCallId);
                String reasoning = (String) parsed.getOrDefault("reasoning", "");
                String prevReasoning = (String) data.getOrDefault("reasoning", "");
                data.put("next_action", "tool_call");
                data.put("pending_tool_call", toolCall);
                data.put("reasoning", prevReasoning.isEmpty() ? reasoning : prevReasoning + "\n\n---\n\n" + reasoning);
                Map<String, Object> func = new LinkedHashMap<>();
                func.put("name", toolName);
                func.put("arguments", toJsonString(toolArgs));
                Map<String, Object> tc = new LinkedHashMap<>();
                tc.put("id", toolCallId);
                tc.put("type", "function");
                tc.put("function", func);
                Map<String, Object> assistantMsg = new LinkedHashMap<>();
                assistantMsg.put("role", "assistant");
                assistantMsg.put("content", null);
                assistantMsg.put("tool_calls", List.of(tc));
                messages.add(assistantMsg);
            } else if ("nl2sql".equals(type)) {
                String sql = (String) parsed.get("sql");
                String toolCallId = "call_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
                Map<String, Object> pendingNl2sql = new LinkedHashMap<>(parsed);
                pendingNl2sql.put("tool_call_id", toolCallId);
                String reasoning = (String) parsed.getOrDefault("reasoning", "");
                String prevReasoning = (String) data.getOrDefault("reasoning", "");
                data.put("next_action", "nl2sql");
                data.put("pending_nl2sql", pendingNl2sql);
                data.put("reasoning", prevReasoning.isEmpty() ? reasoning : prevReasoning + "\n\n---\n\n" + reasoning);
                Map<String, Object> func = new LinkedHashMap<>();
                func.put("name", "nl2sql_executor");
                func.put("arguments", toJsonString(Map.of("sql", sql)));
                Map<String, Object> tc = new LinkedHashMap<>();
                tc.put("id", toolCallId);
                tc.put("type", "function");
                tc.put("function", func);
                Map<String, Object> asstMsg = new LinkedHashMap<>();
                asstMsg.put("role", "assistant");
                asstMsg.put("content", null);
                asstMsg.put("tool_calls", List.of(tc));
                messages.add(asstMsg);
            } else if ("code_mode".equals(type)) {
                String code = (String) parsed.get("code");
                @SuppressWarnings("unchecked")
                Map<String, Object> inputData = (Map<String, Object>) parsed.getOrDefault("input_data", Map.of());
                String toolCallId = "call_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
                String reasoning = (String) parsed.getOrDefault("reasoning", "");
                String prevReasoning = (String) data.getOrDefault("reasoning", "");
                data.put("next_action", "code_mode");
                data.put("pending_code", Map.of("code", code, "input_data", inputData, "tool_call_id", toolCallId));
                data.put("reasoning", prevReasoning.isEmpty() ? reasoning : prevReasoning + "\n\n---\n\n" + reasoning);
                Map<String, Object> func = new LinkedHashMap<>();
                func.put("name", "code_executor");
                func.put("arguments", toJsonString(Map.of("code", code)));
                Map<String, Object> tc = new LinkedHashMap<>();
                tc.put("id", toolCallId);
                tc.put("type", "function");
                tc.put("function", func);
                Map<String, Object> asstMsg = new LinkedHashMap<>();
                asstMsg.put("role", "assistant");
                asstMsg.put("content", null);
                asstMsg.put("tool_calls", List.of(tc));
                messages.add(asstMsg);
            } else if ("ontology_action".equals(type)) {
                List<OntologyChangeLog> pendingChanges = ontologyChangeService.getPendingChanges(sessionId);
                if (pendingChanges != null && !pendingChanges.isEmpty()) {
                    data.put("next_action", "final_answer");
                    data.put("final_answer", "仍有 " + pendingChanges.size() + " 条本体变更待审核，请先进入本体编辑器审核通过后再提交新的变更。");
                    return CompletableFuture.completedFuture(data);
                }
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> changes = (List<Map<String, Object>>) parsed.getOrDefault("changes", List.of());
                String toolCallId = "call_" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
                String reasoning = (String) parsed.getOrDefault("reasoning", "");
                String prevReasoning = (String) data.getOrDefault("reasoning", "");
                data.put("next_action", "ontology_action");
                data.put("pending_ontology_changes", changes);
                data.put("pending_ontology_tool_call_id", toolCallId);
                data.put("reasoning", prevReasoning.isEmpty() ? reasoning : prevReasoning + "\n\n---\n\n" + reasoning);
                Map<String, Object> func = new LinkedHashMap<>();
                func.put("name", "ontology_advisor");
                func.put("arguments", toJsonString(Map.of("changes", changes.size())));
                Map<String, Object> tc = new LinkedHashMap<>();
                tc.put("id", toolCallId);
                tc.put("type", "function");
                tc.put("function", func);
                Map<String, Object> asstMsg = new LinkedHashMap<>();
                asstMsg.put("role", "assistant");
                asstMsg.put("content", null);
                asstMsg.put("tool_calls", List.of(tc));
                messages.add(asstMsg);
            } else if ("request_context".equals(type)) {
                @SuppressWarnings("unchecked")
                List<String> conceptNames = (List<String>) parsed.getOrDefault("concept_names", List.of());
                String requestType = (String) parsed.getOrDefault("request", "all");
                String context = buildMappingsForConcepts(conceptNames, requestType);
                messages.add(Map.of("role", "user", "content", "以下是你请求的映射信息：\n" + context
                        + "\n请继续使用 ontology_action 输出完整的本体变更建议。"));
                data.put("next_action", "agent");
                data.put("iteration", iteration);
                return CompletableFuture.completedFuture(data);
            } else if ("select_datasources".equals(type)) {
                String reasoning = (String) parsed.getOrDefault("reasoning", "");
                data.put("next_action", "select_datasources");
                data.put("select_datasources_reasoning", reasoning);
                messages.add(new java.util.LinkedHashMap<>() {{
                    put("role", "assistant");
                    put("content", "请选择需要使用的数据源和表");
                }});
                return CompletableFuture.completedFuture(data);
            } else if ("parse_error".equals(type)) {
                String raw = (String) parsed.getOrDefault("raw", "");
                int retryCount = (int) data.getOrDefault("nl2sql_retry_count", 0);
                int parseRetryCount = (int) data.getOrDefault("parse_error_retry_count", 0);
                if (retryCount > 0 || parseRetryCount < 1) {
                    log.warn("Agent iteration {}: parse_error, retrying with JSON format prompt (parseRetry={})", iteration, parseRetryCount);
                    data.put("parse_error_retry_count", parseRetryCount + 1);
                    String formatHint = retryCount > 0
                            ? "你的上一轮回复不是有效的 JSON 格式。请严格按照 JSON 格式输出修正后的 SQL，"
                              + "格式：{\"type\": \"nl2sql\", \"reasoning\": \"...\", \"sql\": \"...\", \"concept_ids\": [...]}"
                            : "你的上一轮回复不是有效的 JSON 格式。请严格按照 JSON 格式回复，"
                              + "根据当前上下文选择输出 final_answer、nl2sql 或 code_mode。";
                    messages.add(Map.of("role", "system", "content", formatHint));
                    data.put("next_action", "continue");
                    data.put("iteration", iteration);
                    return CompletableFuture.completedFuture(data);
                }
                data.put("next_action", "final_answer");
                data.put("final_answer", raw);
                messages.add(Map.of("role", "assistant", "content", raw));
            } else {
                data.put("next_action", "final_answer");
                String fallback = (String) data.getOrDefault("last_llm_response", parsed.toString());
                data.put("final_answer", fallback);
                messages.add(Map.of("role", "assistant", "content", fallback));
            }

            return CompletableFuture.completedFuture(data);
        };
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

    private Map<String, Object> buildUnifiedContext(String sessionId, String userQuery,
            List<Map<String, Object>> messages, Long userId) {
        long t0 = System.currentTimeMillis();
        Map<String, Object> result = new LinkedHashMap<>();
        List<Map<String, Object>> conceptTrace = new ArrayList<>();
        List<Long> conceptIds = new ArrayList<>();
        List<ToolDefinition> apiTools = new ArrayList<>();
        List<ConceptMapping> tableMappings = new ArrayList<>();
        List<ConceptJoinMapping> joinMappings = new ArrayList<>();

        // ===== 管道阶段 1: FAISS 概念搜索 =====
        long tFaiss = System.currentTimeMillis();
        List<Map<String, Object>> faissResults = searchConcepts(userQuery);
        List<Long> matchedConceptIds = faissResults.stream()
                .map(r -> ((Number) r.get("conceptId")).longValue())
                .collect(Collectors.toList());
        log.info("buildUnifiedContext FAISS: {}ms, matched {} concepts",
                System.currentTimeMillis() - tFaiss, matchedConceptIds.size());

        // 计算授权概念集合：用于后续过滤 LLM 上下文中的表映射
        Set<Long> authorizedConceptIds = new HashSet<>(matchedConceptIds);
        if (userId != null && !matchedConceptIds.isEmpty()) {
            try {
                Map<Long, Boolean> perms = roleConceptPermissionService.batchCheckQueryPermission(
                        userId, new ArrayList<>(matchedConceptIds));
                authorizedConceptIds = matchedConceptIds.stream()
                        .filter(id -> perms.getOrDefault(id, true))
                        .collect(Collectors.toSet());
                if (authorizedConceptIds.size() < matchedConceptIds.size()) {
                    log.info("buildUnifiedContext FAISS: {} authorized / {} total concepts",
                            authorizedConceptIds.size(), matchedConceptIds.size());
                }
            } catch (Exception e) {
                log.warn("buildUnifiedContext FAISS: failed to check permissions: {}", e.getMessage());
            }
        }

        Map<String, Object> pipeline = new LinkedHashMap<>();
        Map<String, Object> faissStage = new LinkedHashMap<>();
        faissStage.put("matched", !faissResults.isEmpty());
        faissStage.put("concepts", faissResults);
        pipeline.put("faiss", faissStage);

        // 多轮对话三层判断：概念交集 → 表复用 → 聚合语义
        long tReuse = System.currentTimeMillis();
        Map<String, Object> reuseContext = analyzeMultiTurnReuse(messages, matchedConceptIds);
        log.info("buildUnifiedContext multi-turn reuse: {}ms, fullReuse={}",
                System.currentTimeMillis() - tReuse, reuseContext.containsKey("fullReuse"));
        if (!reuseContext.isEmpty()) {
            @SuppressWarnings("unchecked")
            List<ConceptMapping> reusedMappings = (List<ConceptMapping>) reuseContext.get("tableMappings");
            @SuppressWarnings("unchecked")
            List<ConceptJoinMapping> reusedJoins = (List<ConceptJoinMapping>) reuseContext.get("joinMappings");
            @SuppressWarnings("unchecked")
            List<ToolDefinition> reusedTools = (List<ToolDefinition>) reuseContext.get("apiTools");

            if (reusedMappings != null) tableMappings.addAll(reusedMappings);
            if (reusedJoins != null) joinMappings.addAll(reusedJoins);
            if (reusedTools != null) apiTools.addAll(reusedTools);
            if (reusedMappings != null && !reusedMappings.isEmpty()) {
                conceptTrace.add(Map.of("type", "reuse", "message",
                        "多轮对话复用上一轮概念映射，概念交集 > 50%"));
            }
        }

        // ===== 管道阶段 2: 本体扩展 =====
        long tOntology = System.currentTimeMillis();
        List<Map<String, Object>> ontologyConcepts = new ArrayList<>();
        Map<Long, List<Map<String, Object>> > ontologyRelations = new LinkedHashMap<>();
        if (!matchedConceptIds.isEmpty() && !reuseContext.containsKey("fullReuse")) {
            conceptIds.addAll(matchedConceptIds);
            Map<Long, Double> faissConfidence = new LinkedHashMap<>();
            for (Map<String, Object> r : faissResults) {
                Long cid = ((Number) r.get("conceptId")).longValue();
                Object conf = r.get("confidence");
                faissConfidence.put(cid, conf instanceof Number ? ((Number) conf).doubleValue() : 0.0);
            }
            Map<String, Object> expanded = ontologyService.analyzeContext(matchedConceptIds, faissConfidence);
            @SuppressWarnings("unchecked")
            List<Long> expandedIds = (List<Long>) expanded.getOrDefault("conceptIds", List.of());
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> trace = (List<Map<String, Object>>) expanded.getOrDefault("conceptTrace", List.of());
            @SuppressWarnings("unchecked")
            List<ToolDefinition> apiToolsFromConcepts = (List<ToolDefinition>) expanded.getOrDefault("apiTools", List.of());
            @SuppressWarnings("unchecked")
            List<ConceptMapping> mappings = (List<ConceptMapping>) expanded.getOrDefault("tableMappings", List.of());
            @SuppressWarnings("unchecked")
            List<ConceptJoinMapping> joins = (List<ConceptJoinMapping>) expanded.getOrDefault("joinMappings", List.of());
            ontologyRelations = (Map<Long, List<Map<String, Object>> >) expanded.getOrDefault("relatedConcepts", Map.of());

            conceptIds.addAll(expandedIds);
            conceptTrace.addAll(trace);
            apiTools.addAll(apiToolsFromConcepts);
            tableMappings.addAll(mappings);
            joinMappings.addAll(joins);

            // 记录本体扩展的概念（包含所有深度 >= 1 的概念，携带置信度）
            for (Map<String, Object> t : trace) {
                Object cid = t.get("conceptId");
                Object depth = t.get("depth");
                if (cid instanceof Number && depth instanceof Number && ((Number) depth).intValue() > 0) {
                    ontologyConcepts.add(t);
                }
            }
            log.info("buildUnifiedContext ontology: {}ms, expanded {} concepts, {} relations",
                    System.currentTimeMillis() - tOntology, ontologyConcepts.size(), ontologyRelations.size());
        } else if (!matchedConceptIds.isEmpty() && reuseContext.containsKey("fullReuse")) {
            // fullReuse：复用上一轮映射，但仍进行本体扩展用于前端展示
            conceptIds.addAll(matchedConceptIds);
            conceptTrace.addAll(faissResults);

            Map<Long, Double> faissConfidence = new LinkedHashMap<>();
            for (Map<String, Object> r : faissResults) {
                Long cid = ((Number) r.get("conceptId")).longValue();
                Object conf = r.get("confidence");
                faissConfidence.put(cid, conf instanceof Number ? ((Number) conf).doubleValue() : 0.0);
            }
            Map<String, Object> expanded = ontologyService.analyzeContext(matchedConceptIds, faissConfidence);
            List<Map<String, Object>> trace = (List<Map<String, Object>>) expanded.getOrDefault("conceptTrace", List.of());
            ontologyRelations = (Map<Long, List<Map<String, Object>> >) expanded.getOrDefault("relatedConcepts", Map.of());

            conceptTrace.addAll(trace);
            for (Map<String, Object> t : trace) {
                Object cid = t.get("conceptId");
                Object depth = t.get("depth");
                if (cid instanceof Number && depth instanceof Number && ((Number) depth).intValue() > 0) {
                    ontologyConcepts.add(t);
                }
            }

            // 复用上一轮的表映射和工具
            @SuppressWarnings("unchecked")
            List<ConceptMapping> prevMappings = (List<ConceptMapping>) reuseContext.get("tableMappings");
            if (prevMappings != null) tableMappings.addAll(prevMappings);
            @SuppressWarnings("unchecked")
            List<ConceptJoinMapping> prevJoins = (List<ConceptJoinMapping>) reuseContext.get("joinMappings");
            if (prevJoins != null) joinMappings.addAll(prevJoins);
            @SuppressWarnings("unchecked")
            List<Long> prevToolIds = (List<Long>) reuseContext.get("toolIds");
            if (prevToolIds != null && !prevToolIds.isEmpty()) {
                List<ToolDefinition> prevTools = toolDefinitionRepository.findAllById(prevToolIds);
                apiTools.addAll(prevTools);
            }
            log.info("buildUnifiedContext ontology(fullReuse): {}ms, expanded {} concepts, {} relations",
                    System.currentTimeMillis() - tOntology, ontologyConcepts.size(), ontologyRelations.size());
        }

        // 精选概念：限制用于查表映射的 conceptIds ≤ MAX_CONCEPT_IDS
        // 但 conceptTrace 保留全部概念，确保 LLM 能看到所有匹配概念及其权限状态
        if (conceptIds.size() > MAX_CONCEPT_IDS) {
            List<Long> limited = selectTopConcepts(conceptIds, conceptTrace, faissResults);
            conceptIds.clear();
            conceptIds.addAll(limited);
        }

        Map<String, Object> ontologyStage = new LinkedHashMap<>();
        ontologyStage.put("expanded", !ontologyConcepts.isEmpty() || !ontologyRelations.isEmpty());
        ontologyStage.put("concepts", ontologyConcepts);
        Map<String, List<Map<String, Object>>> relationsStr = new LinkedHashMap<>();
        for (Map.Entry<Long, List<Map<String, Object>>> e : ontologyRelations.entrySet()) {
            relationsStr.put(String.valueOf(e.getKey()), e.getValue());
        }
        ontologyStage.put("relations", relationsStr);
        pipeline.put("ontology", ontologyStage);

        List<ToolDefinition> vectorTools = toolEmbeddingService.search(null, userQuery, 5);
        if (vectorTools != null) {
            for (ToolDefinition t : vectorTools) {
                if (apiTools.stream().noneMatch(e -> e.getId().equals(t.getId()))) {
                    apiTools.add(t);
                }
            }
        }

        if (apiTools.size() > MAX_API_TOOLS) {
            apiTools = apiTools.subList(0, MAX_API_TOOLS);
        }

        // 无概念匹配时，将所有可访问概念作为普通概念提供给 LLM 自主决策
        if (matchedConceptIds.isEmpty()) {
            List<Concept> accessibleConcepts = getAccessibleConcepts(userId);
            if (!accessibleConcepts.isEmpty()) {
                for (Concept c : accessibleConcepts) {
                    conceptIds.add(c.getId());
                    conceptTrace.add(Map.of(
                            "conceptId", c.getId(),
                            "conceptName", c.getName(),
                            "description", c.getDescription() != null ? c.getDescription() : "",
                            "depth", 0
                    ));
                }
            }

            if (!conceptIds.isEmpty()) {
                List<Long> toolIds = toolConceptRepository.findByConceptIdIn(conceptIds).stream()
                        .map(ToolConcept::getToolId).distinct().collect(Collectors.toList());
                if (!toolIds.isEmpty()) {
                    List<ToolDefinition> boundTools = toolDefinitionRepository.findAllById(toolIds);
                    for (ToolDefinition t : boundTools) {
                        if (apiTools.stream().noneMatch(e -> e.getId().equals(t.getId()))) {
                            apiTools.add(t);
                        }
                    }
                }
            } else if (apiTools.isEmpty()) {
                List<ToolDefinition> allTools = toolDefinitionRepository.findByScope("PLATFORM");
                if (allTools != null && !allTools.isEmpty()) {
                    apiTools.addAll(allTools);
                }
            }

            if (!conceptIds.isEmpty()) {
                List<ConceptMapping> mappings = conceptMappingRepository.findAll().stream()
                        .filter(m -> conceptIds.contains(m.getConceptId()))
                        .collect(Collectors.toList());
                for (ConceptMapping m : mappings) {
                    boolean exists = tableMappings.stream().anyMatch(
                            e -> e.getTableName().equals(m.getTableName())
                                    && e.getColumnName().equals(m.getColumnName()));
                    if (!exists) {
                        tableMappings.add(m);
                    }
                }
            }
        }

        // ===== 管道阶段 3: 提交给 LLM 的上下文摘要 =====
        Map<String, Object> submittedStage = new LinkedHashMap<>();
        Set<Long> submittedConceptIdSet = new LinkedHashSet<>(conceptIds);
        List<Map<String, Object>> submittedConcepts = conceptTrace.stream()
                .filter(t -> !"pipeline".equals(t.get("type")))
                .filter(t -> t.get("conceptName") != null && !"".equals(t.get("conceptName")))
                .filter(t -> t.get("conceptId") instanceof Number)
                .filter(t -> submittedConceptIdSet.contains(((Number) t.get("conceptId")).longValue()))
                .collect(Collectors.toMap(
                        t -> ((Number) t.get("conceptId")).longValue(),
                        t -> {
                            Map<String, Object> c = new LinkedHashMap<>();
                            c.put("conceptId", t.get("conceptId"));
                            c.put("conceptName", t.get("conceptName"));
                            c.put("depth", t.get("depth"));
                            return c;
                        },
                        (existing, replacement) -> existing,
                        LinkedHashMap::new))
                .values().stream()
                .collect(Collectors.toList());
        submittedStage.put("conceptCount", submittedConcepts.size());
        submittedStage.put("concepts", submittedConcepts);
        submittedStage.put("toolCount", apiTools.size());
        submittedStage.put("tools", apiTools.stream()
                .map(t -> Map.of("name", t.getName(), "description",
                        t.getDescription() != null ? t.getDescription() : ""))
                .collect(Collectors.toList()));
        submittedStage.put("tableMappingCount", tableMappings.size());
        submittedStage.put("tableMappings", tableMappings.stream()
                .map(m -> Map.of("tableName", m.getTableName(), "columnName", m.getColumnName(),
                        "mappingType", m.getMappingType() != null ? m.getMappingType() : ""))
                .collect(Collectors.toList()));
        submittedStage.put("joinMappingCount", joinMappings.size());
        submittedStage.put("joinMappings", joinMappings.stream()
                .map(j -> Map.of("joinType", j.getJoinType() != null ? j.getJoinType() : "",
                        "joinTable", j.getJoinTable() != null ? j.getJoinTable() : "",
                        "joinCondition", j.getJoinCondition() != null ? j.getJoinCondition() : ""))
                .collect(Collectors.toList()));
        pipeline.put("submitted", submittedStage);

        // 将管道信息作为 conceptTrace 的第一项
        conceptTrace.add(0, Map.of("type", "pipeline", "pipeline", pipeline));

        Map<Long, String> groupNameMap = buildGroupNameMap(conceptTrace);

        Map<Long, List<Map<String, Object>>> drillDimensions = new LinkedHashMap<>();
        for (Long cid : conceptIds) {
            List<Map<String, Object>> dims = ontologyService.getDrillDimensions(cid);
            if (!dims.isEmpty()) {
                drillDimensions.put(cid, dims);
            }
        }

        Map<Long, List<Map<String, Object>>> correlatedDimensions = new LinkedHashMap<>();
        for (Long cid : conceptIds) {
            List<Map<String, Object>> dims = ontologyService.getCorrelatedDimensions(cid);
            if (!dims.isEmpty()) {
                correlatedDimensions.put(cid, dims);
            }
        }

        List<Map<String, Object>> availableDatasources = datasourceService.getAvailableDatasources();

        String availableRelations = buildAvailableRelationsPrompt(conceptTrace);

        boolean isAdmin = userId != null && roleConceptPermissionService.isSuperAdmin(userId);
        String prompt = buildUnifiedContextPrompt(userQuery, conceptTrace, apiTools,
                tableMappings, joinMappings, authorizedConceptIds, groupNameMap, drillDimensions, correlatedDimensions, messages, availableDatasources, availableRelations, isAdmin);

        log.info("buildUnifiedContext TOTAL: {}ms, concepts={}, tools={}, tables={}",
                System.currentTimeMillis() - t0, conceptIds.size(), apiTools.size(), tableMappings.size());

        result.put("conceptIds", conceptIds.stream().distinct().collect(Collectors.toList()));
        result.put("conceptTrace", conceptTrace);
        result.put("apiTools", apiTools);
        result.put("tableMappings", tableMappings);
        result.put("joinMappings", joinMappings);
        result.put("prompt", prompt);
        result.put("availableDatasources", availableDatasources);
        return result;
    }

    /**
     * 多轮对话复用分析：三层判断
     * 1. 概念交集 > 50%：复用上一轮映射
     * 2. 表复用：复用 JOIN 条件
     * 3. 聚合语义检测：检测 AVG/SUM/COUNT/MAX/MIN 关键词
     */
    private Map<String, Object> analyzeMultiTurnReuse(
            List<Map<String, Object>> messages, List<Long> currentConceptIds) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (currentConceptIds == null || currentConceptIds.isEmpty()) return result;

        // 提取上一轮的概念 ID
        List<Long> prevConceptIds = new ArrayList<>();
        List<Map<String, Object>> prevMessages = new ArrayList<>();
        for (int i = messages.size() - 1; i >= 0; i--) {
            Map<String, Object> msg = messages.get(i);
            if ("user".equals(msg.get("role"))) {
                prevMessages.add(0, msg);
                if (prevMessages.size() >= 2) break;
            }
        }
        if (prevMessages.size() < 2) return result;

        String prevQuery = (String) prevMessages.get(0).get("content");
        if (prevQuery == null) return result;

        // 第一层：概念交集检查
        try {
            List<Float> prevEmbedding = faissService.getEmbedding(prevQuery);
            if (prevEmbedding != null && !prevEmbedding.isEmpty()) {
                List<Map<String, Object>> prevResults = faissService.search(prevEmbedding, 10);
                if (prevResults != null) {
                    for (Map<String, Object> r : prevResults) {
                        Object id = r.get("id");
                        if (id == null) id = r.get("concept_id");
                        if (id instanceof Number n) {
                            prevConceptIds.add(n.longValue());
                        } else if (id instanceof String s) {
                            try {
                                prevConceptIds.add(Long.parseLong(s));
                            } catch (NumberFormatException ignored) {
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.debug("Multi-turn concept intersection check failed: {}", e.getMessage());
        }

        if (!prevConceptIds.isEmpty()) {
            Set<Long> currentSet = new HashSet<>(currentConceptIds);
            long intersection = prevConceptIds.stream().filter(currentSet::contains).count();
            double ratio = (double) intersection / Math.max(prevConceptIds.size(), currentSet.size());

            if (ratio >= CONCEPT_INTERSECTION_THRESHOLD) {
                result.put("conceptIntersectionRatio", ratio);
                result.put("reuseLevel", "concept");
                result.put("fullReuse", true);
                List<ConceptMapping> mappings = conceptMappingRepository.findByConceptIdIn(new ArrayList<>(currentConceptIds));
                result.put("tableMappings", mappings);
                List<ConceptJoinMapping> joins = conceptJoinMappingRepository.findByConceptIdIn(new ArrayList<>(currentConceptIds));
                result.put("joinMappings", joins);
                List<Long> toolIds = toolConceptRepository.findByConceptIdIn(new ArrayList<>(currentConceptIds))
                        .stream().map(ToolConcept::getToolId).distinct().collect(Collectors.toList());
                if (!toolIds.isEmpty()) {
                    result.put("apiTools", toolDefinitionRepository.findAllById(toolIds));
                }
                log.debug("Multi-turn: concept intersection {:.0%} >= threshold, reusing mappings", ratio);
                return result;
            }
        }

        // 第二层：表复用检查
        String currentQuery = (String) messages.get(messages.size() - 1).get("content");
        if (currentQuery != null) {
            boolean sameTableContext = checkTableReuse(prevQuery, currentQuery);
            if (sameTableContext) {
                result.put("reuseLevel", "table");
                log.debug("Multi-turn: table context reuse detected");
            }
        }

        // 第三层：聚合语义检测
        String latestQuery = (String) messages.get(messages.size() - 1).get("content");
        if (latestQuery != null) {
            String upper = latestQuery.toUpperCase();
            boolean hasAggregation = upper.contains("AVG") || upper.contains("平均") ||
                    upper.contains("SUM") || upper.contains("合计") || upper.contains("总和") ||
                    upper.contains("COUNT") || upper.contains("数量") || upper.contains("统计") ||
                    upper.contains("MAX") || upper.contains("最大") ||
                    upper.contains("MIN") || upper.contains("最小");
            if (hasAggregation) {
                result.put("hasAggregation", true);
                log.debug("Multi-turn: aggregation semantics detected");
            }
        }

        return result;
    }

    private boolean checkTableReuse(String prevQuery, String currentQuery) {
        if (prevQuery == null || currentQuery == null) return false;
        String prevLower = prevQuery.toLowerCase();
        String currLower = currentQuery.toLowerCase();
        String[] tableKeywords = {"表", "table", "数据", "记录", "行", "列"};
        for (String kw : tableKeywords) {
            if (prevLower.contains(kw) && currLower.contains(kw)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 获取用户有权访问的已索引概念，按域分组用于能力摘要。
     * 无 userId 或 RBAC 无匹配时返回所有已索引概念。
     */
    private List<Concept> getAccessibleConcepts(Long userId) {
        List<Concept> allIndexed = conceptRepository.findAll().stream()
                .filter(c -> c.getEmbedding() != null && c.getEmbedding().length > 0)
                .collect(Collectors.toList());
        if (userId == null || allIndexed.isEmpty()) {
            return allIndexed;
        }
        try {
            List<Long> conceptIds = allIndexed.stream().map(Concept::getId).collect(Collectors.toList());
            Map<Long, Boolean> perms = roleConceptPermissionService.batchCheckQueryPermission(userId, conceptIds);
            return allIndexed.stream()
                    .filter(c -> perms.getOrDefault(c.getId(), true))
                    .collect(Collectors.toList());
        } catch (Exception e) {
            log.warn("Failed to check RBAC permissions for capability summary: {}", e.getMessage());
            return allIndexed;
        }
    }

    private List<Map<String, Object>> searchConcepts(String userQuery) {
        if (!faissService.isHealthy()) {
            return List.of();
        }
        try {
            List<Float> embedding = faissService.getEmbedding(userQuery);
            if (embedding == null || embedding.isEmpty()) {
                return List.of();
            }
            List<Map<String, Object>> results = faissService.search(embedding, 10);
            if (results == null || results.isEmpty()) {
                return List.of();
            }
            List<Map<String, Object>> enriched = new ArrayList<>();
            for (Map<String, Object> r : results) {
                Object id = r.get("id");
                if (id == null) id = r.get("concept_id");
                long conceptId;
                if (id instanceof Number n) {
                    conceptId = n.longValue();
                } else if (id instanceof String s) {
                    try {
                        conceptId = Long.parseLong(s);
                    } catch (NumberFormatException e) {
                        continue;
                    }
                } else {
                    continue;
                }
                Concept concept = conceptRepository.findById(conceptId).orElse(null);
                if (concept == null) continue;
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("conceptId", conceptId);
                item.put("conceptName", concept.getName());
                Object score = r.get("score");
                if (score instanceof Number) {
                    item.put("confidence", ((Number) score).doubleValue());
                }
                enriched.add(item);
            }
            return enriched;
        } catch (Exception e) {
            log.warn("FAISS concept search failed: {}", e.getMessage());
            return List.of();
        }
    }

    /**
     * 精选概念：从 FAISS 命中 + 本体扩展中选出 Top N 提交给 LLM。
     * 评分规则：FAISS 概念用原始置信度，本体扩展用传播置信度（parentConfidence * 0.85^depth）。
     */
    private List<Long> selectTopConcepts(List<Long> conceptIds,
            List<Map<String, Object>> conceptTrace,
            List<Map<String, Object>> faissResults) {
        // 置信度映射（从 trace 中提取，FAISS 和本体扩展都有）
        Map<Long, Double> confidenceMap = new LinkedHashMap<>();
        for (Map<String, Object> t : conceptTrace) {
            Object cid = t.get("conceptId");
            Object conf = t.get("confidence");
            if (cid instanceof Number && conf instanceof Number) {
                Long id = ((Number) cid).longValue();
                double c = ((Number) conf).doubleValue();
                confidenceMap.merge(id, c, Math::max);
            }
        }
        // FAISS 置信度作为后备
        for (Map<String, Object> r : faissResults) {
            Long cid = ((Number) r.get("conceptId")).longValue();
            Object conf = r.get("confidence");
            if (conf instanceof Number) {
                confidenceMap.merge(cid, ((Number) conf).doubleValue(), Math::max);
            }
        }

        // 本体深度映射（从 conceptTrace 中提取）
        Map<Long, Integer> depthMap = new LinkedHashMap<>();
        for (Map<String, Object> t : conceptTrace) {
            Object cid = t.get("conceptId");
            if (cid instanceof Number) {
                Long id = ((Number) cid).longValue();
                Object d = t.get("depth");
                depthMap.put(id, d instanceof Number ? ((Number) d).intValue() : 0);
            }
        }

        // 为每个概念计算评分（使用传播置信度）
        List<Long> uniqueIds = conceptIds.stream().distinct().collect(Collectors.toList());
        List<Map.Entry<Long, Double>> scored = new ArrayList<>();
        for (Long id : uniqueIds) {
            double score = confidenceMap.getOrDefault(id, 0.0);
            scored.add(Map.entry(id, score));
        }

        // 按评分降序，取前 MAX_CONCEPT_IDS
        scored.sort((a, b) -> Double.compare(b.getValue(), a.getValue()));
        List<Long> result = new ArrayList<>();
        for (int i = 0; i < Math.min(MAX_CONCEPT_IDS, scored.size()); i++) {
            result.add(scored.get(i).getKey());
        }
        return result;
    }

    private Map<Long, String> buildGroupNameMap(List<Map<String, Object>> conceptTrace) {
        Map<Long, String> map = new LinkedHashMap<>();
        if (conceptTrace == null) return map;
        for (Map<String, Object> c : conceptTrace) {
            if ("pipeline".equals(c.get("type"))) continue;
            Object gid = c.get("groupId");
            if (gid instanceof Number) {
                map.putIfAbsent(((Number) gid).longValue(), null);
            }
        }
        for (Long gid : map.keySet()) {
            try {
                ontologyGroupRepository.findById(gid).ifPresent(g -> {
                    String name = g.getDisplayName() != null ? g.getDisplayName() : g.getName();
                    map.put(gid, name != null ? name : "域" + gid);
                });
            } catch (Exception e) {
                map.put(gid, "域" + gid);
            }
        }
        return map;
    }

    private String buildPreviousAnalysisContext(List<Map<String, Object>> messages) {
        if (messages == null || messages.size() < 2) return "";

        StringBuilder sb = new StringBuilder();
        int queryNum = 0;

        for (Map<String, Object> msg : messages) {
            String role = (String) msg.get("role");
            String content = (String) msg.get("content");

            if ("tool".equals(role) && content != null && content.contains("SQL")) {
                queryNum++;
                sb.append("**查询 ").append(queryNum).append("**：\n");
                if (content.length() > 600) {
                    sb.append(content, 0, 600).append("...(截断)\n\n");
                } else {
                    sb.append(content).append("\n\n");
                }
            }
        }

        if (queryNum == 0) return "";

        return "已执行 **" + queryNum + "** 次 SQL 查询。请基于以上结果继续分析，**禁止重复已执行的查询**：\n\n" + sb;
    }

    private String buildAvailableRelationsPrompt(List<Map<String, Object>> conceptTrace) {
        if (conceptTrace == null || conceptTrace.isEmpty()) {
            return "";
        }
        Set<Long> groupIds = conceptTrace.stream()
                .filter(c -> c.get("groupId") instanceof Number)
                .map(c -> ((Number) c.get("groupId")).longValue())
                .collect(Collectors.toSet());
        if (groupIds.isEmpty()) {
            return "";
        }
        Set<Long> industryIds = new LinkedHashSet<>();
        for (Long gid : groupIds) {
            ontologyGroupRepository.findById(gid).ifPresent(g -> {
                if (g.getIndustryId() != null) {
                    industryIds.add(g.getIndustryId());
                }
            });
        }
        if (industryIds.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (Long industryId : industryIds) {
            List<com.luban.entity.IndustryRelation> relations = industryService.getRelations(industryId);
            if (relations.isEmpty()) continue;
            for (com.luban.entity.IndustryRelation r : relations) {
                sb.append("     - ").append(r.getRelationType());
                if (r.getDescription() != null && !r.getDescription().isEmpty()) {
                    sb.append(": ").append(r.getDescription());
                }
                sb.append("\n");
            }
        }
        return sb.toString();
    }

    private String buildUnifiedContextPrompt(String userQuery,
                                             List<Map<String, Object>> conceptTrace,
                                             List<ToolDefinition> apiTools,
                                             List<ConceptMapping> tableMappings,
                                             List<ConceptJoinMapping> joinMappings,
                                             Set<Long> authorizedConceptIds,
                                             Map<Long, String> groupNameMap,
                                             Map<Long, List<Map<String, Object>>> drillDimensions,
                                             Map<Long, List<Map<String, Object>>> correlatedDimensions,
                                             List<Map<String, Object>> messages,
                                             List<Map<String, Object>> availableDatasources,
                                             String availableRelations,
                                             boolean isAdmin) {
        StringBuilder sb = new StringBuilder();

        sb.append("## 用户问题\n");
        sb.append(userQuery).append("\n\n");

        sb.append("## 意图分类（由你自行判断）\n");
        sb.append("请先判断用户意图属于以下哪类：\n");
        sb.append("- **数据查询**：用户想查数据、分析指标、下钻根因。走正常查询流程（tool_call/nl2sql/code_mode/final_answer）。\n");
        if (isAdmin) {
            sb.append("- **本体管理**：用户想配置本体（添加概念、关系、映射、表连接）。请严格按照下方「本体创建思维链」操作，使用 ontology_action 输出。\n\n");
            sb.append(buildOntologyThinkingChain());
            String fullContext = buildFullOntologyContext();
            if (!fullContext.isEmpty()) {
                sb.append(fullContext);
            }
        }
        sb.append("\n");

        Map<String, Object> dsSelection = parseSelectedDatasources(messages);
        log.info("buildUnifiedContextPrompt: dsSelection={}, messages count={}",
                dsSelection != null ? "found" : "null", messages != null ? messages.size() : 0);

        if (dsSelection == null && tableMappings != null && !tableMappings.isEmpty() && availableDatasources != null) {
            Set<Long> derivedDsIds = tableMappings.stream()
                    .map(ConceptMapping::getDatasourceId)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet());
            if (!derivedDsIds.isEmpty()) {
                List<Map<String, Object>> selected = new ArrayList<>();
                for (Map<String, Object> ds : availableDatasources) {
                    Object dsId = ds.get("id");
                    if (dsId instanceof Number && derivedDsIds.contains(((Number) dsId).longValue())) {
                        Map<String, Object> sel = new LinkedHashMap<>();
                        sel.put("id", dsId);
                        sel.put("name", ds.get("name"));
                        Set<String> tables = tableMappings.stream()
                                .filter(m -> dsId.equals(m.getDatasourceId()))
                                .map(ConceptMapping::getTableName)
                                .filter(Objects::nonNull)
                                .collect(Collectors.toCollection(LinkedHashSet::new));
                        sel.put("tables", new ArrayList<>(tables));
                        selected.add(sel);
                    }
                }
                if (!selected.isEmpty()) {
                    dsSelection = Map.of("selected", selected);
                    log.info("buildUnifiedContextPrompt: derived {} datasources from tableMappings", selected.size());
                }
            }
        }

        if (dsSelection != null) {
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> selected = (List<Map<String, Object>>) dsSelection.get("selected");
            if (selected != null && !selected.isEmpty() && availableDatasources != null) {
                sb.append("## 数据源\n");
                sb.append("| 数据源ID | 名称 | 选择的数据表 |\n");
                sb.append("|----------|------|-------------|\n");
                for (Map<String, Object> sel : selected) {
                    Object selId = sel.get("id");
                    String selName = (String) sel.get("name");
                    @SuppressWarnings("unchecked")
                    List<String> selTables = (List<String>) sel.get("tables");
                    sb.append("| ").append(selId != null ? selId : "-")
                            .append(" | ").append(selName)
                            .append(" | ").append(selTables != null ? String.join(", ", selTables) : "全部")
                            .append(" |\n");
                }
                sb.append("\n");
                for (Map<String, Object> sel : selected) {
                    Object selId = sel.get("id");
                    String selName = (String) sel.get("name");
                    @SuppressWarnings("unchecked")
                    List<String> selTables = (List<String>) sel.get("tables");
                    Map<String, Object> ds = selId != null ? availableDatasources.stream()
                            .filter(d -> selId.equals(d.get("id")))
                            .findFirst().orElse(null) : null;
                    if (ds != null) {
                        @SuppressWarnings("unchecked")
                        List<Map<String, Object>> tables = (List<Map<String, Object>>) ds.get("tables");
                        if (tables != null && !tables.isEmpty()) {
                            sb.append("### ").append(selName != null ? selName : ds.get("name")).append(" 表结构\n");
                            sb.append("| 表名 | 列名 | 类型 | 约束 | 注释 |\n");
                            sb.append("|------|------|------|------|------|\n");
                            for (Map<String, Object> table : tables) {
                                String tableName = (String) table.get("name");
                                if (selTables != null && !selTables.isEmpty() && !selTables.contains(tableName)) {
                                    continue;
                                }
                                @SuppressWarnings("unchecked")
                                Object columnsRaw = table.get("columns");
                                if (columnsRaw instanceof List<?> columnsList) {
                                    String first = "**" + tableName + "**";
                                    for (Object colObj : columnsList) {
                                        if (colObj instanceof Map) {
                                            @SuppressWarnings("unchecked")
                                            Map<String, Object> col = (Map<String, Object>) colObj;
                                            String colName = (String) col.get("name");
                                            String colType = (String) col.getOrDefault("type", "-");
                                            Boolean nullable = (Boolean) col.getOrDefault("nullable", true);
                                            String constraint = Boolean.TRUE.equals(nullable) ? "NULL" : "NOT NULL";
                                            String comment = (String) col.getOrDefault("comment", "");
                                            sb.append("| ").append(first).append(" | `").append(colName).append("`")
                                                    .append(" | ").append(colType)
                                                    .append(" | ").append(constraint)
                                                    .append(" | ").append(comment.isEmpty() ? "-" : comment)
                                                    .append(" |\n");
                                            first = "";
                                        } else if (colObj instanceof String) {
                                            sb.append("| ").append(first).append(" | `").append(colObj)
                                                    .append("` | - | - | - |\n");
                                            first = "";
                                        }
                                    }
                                }
                            }
                            sb.append("\n");
                        }
                    }
                }
            }
        }

        if (conceptTrace != null && !conceptTrace.isEmpty()) {
            sb.append("## 语义层匹配的概念\n");
            sb.append("| 概念ID | 概念名 | 域ID | 域名 | 描述 | 深度 | 权限 |\n");
            sb.append("|--------|--------|------|------|------|------|------|\n");
            for (Map<String, Object> c : conceptTrace) {
                if ("pipeline".equals(c.get("type"))) continue;
                Object cid = c.get("conceptId");
                Object gid = c.get("groupId");
                String groupName = gid instanceof Number
                        ? groupNameMap.getOrDefault(((Number) gid).longValue(), "-")
                        : "-";
                boolean authorized = cid instanceof Number
                        && (authorizedConceptIds == null || authorizedConceptIds.isEmpty()
                            || authorizedConceptIds.contains(((Number) cid).longValue()));
                sb.append("| ").append(c.get("conceptId"))
                        .append(" | ").append(c.get("conceptName"))
                        .append(" | ").append(gid != null ? gid : "-")
                        .append(" | ").append(groupName)
                        .append(" | ").append(c.getOrDefault("description", "-"))
                        .append(" | ").append(c.get("depth"))
                        .append(" | ").append(authorized ? "[可用]" : "[无权限]")
                        .append(" |\n");
            }
            sb.append("\n");
        }

        if (drillDimensions != null && !drillDimensions.isEmpty()) {
            sb.append("## 可下钻维度\n");
            sb.append("下方列出各概念可进一步下钻分析的子维度，LLM 生成 SQL 后可据此提示用户下钻。\n\n");
            for (Map.Entry<Long, List<Map<String, Object>>> entry : drillDimensions.entrySet()) {
                Long conceptId = entry.getKey();
                String conceptName = conceptTrace.stream()
                        .filter(t -> conceptId.equals(t.get("conceptId")))
                        .map(t -> String.valueOf(t.get("conceptName")))
                        .findFirst().orElse("概念" + conceptId);
                sb.append("### ").append(conceptName).append(" (ID: ").append(conceptId).append(") 的下钻维度\n");
                sb.append("| 维度ID | 维度名 | 描述 | 异常阈值 |\n");
                sb.append("|--------|--------|------|----------|\n");
                for (Map<String, Object> dim : entry.getValue()) {
                    sb.append("| ").append(dim.get("conceptId"))
                            .append(" | ").append(dim.get("conceptName"))
                            .append(" | ").append(dim.getOrDefault("description", "-"))
                            .append(" | ").append(dim.containsKey("anomalyThresholdExpr")
                                    ? dim.get("anomalyThresholdDesc") : "-")
                            .append(" |\n");
                }
                sb.append("\n");
            }
        }

        if (correlatedDimensions != null && !correlatedDimensions.isEmpty()) {
            sb.append("## 关联维度（交叉验证）\n");
            sb.append("下方列出各概念的关联维度，用于交叉验证根因。**在下钻分析过程中，必须同时检查关联维度以排除干扰因素。**\n\n");
            for (Map.Entry<Long, List<Map<String, Object>>> entry : correlatedDimensions.entrySet()) {
                Long conceptId = entry.getKey();
                String conceptName = conceptTrace.stream()
                        .filter(t -> conceptId.equals(t.get("conceptId")))
                        .map(t -> String.valueOf(t.get("conceptName")))
                        .findFirst().orElse("概念" + conceptId);
                sb.append("### ").append(conceptName).append(" (ID: ").append(conceptId).append(") 的关联维度\n");
                sb.append("| 维度ID | 维度名 | 描述 | 用途 |\n");
                sb.append("|--------|--------|------|------|\n");
                for (Map<String, Object> dim : entry.getValue()) {
                    sb.append("| ").append(dim.get("conceptId"))
                            .append(" | ").append(dim.get("conceptName"))
                            .append(" | ").append(dim.getOrDefault("description", "-"))
                            .append(" | 交叉验证：确认根因是否由该维度变化导致")
                            .append(" |\n");
                }
                sb.append("\n");
            }
        }

        String previousAnalysis = buildPreviousAnalysisContext(messages);
        if (!previousAnalysis.isEmpty()) {
            sb.append("## 上轮分析回顾\n");
            sb.append(previousAnalysis);
            sb.append("\n");
        }

        if (tableMappings != null && !tableMappings.isEmpty()) {
            // 按授权状态分组
            Map<Boolean, List<ConceptMapping>> partitioned = tableMappings.stream()
                    .collect(Collectors.partitioningBy(m ->
                            authorizedConceptIds == null || authorizedConceptIds.isEmpty()
                            || authorizedConceptIds.contains(m.getConceptId())));

            // 授权表
            List<ConceptMapping> authMappings = partitioned.getOrDefault(true, List.of());
            if (!authMappings.isEmpty()) {
                sb.append("## 可用的数据库表结构（✅ 已授权）\n");
                appendTableMappings(sb, authMappings);
            }

            // 未授权表
            List<ConceptMapping> unauthMappings = partitioned.getOrDefault(false, List.of());
            if (!unauthMappings.isEmpty()) {
                sb.append("## 数据库表结构（🔒 未授权，仅供分析参考）\n");
                sb.append("以下表结构存在但当前用户暂无查询权限，你不能对其生成 SQL，但可以在 final_answer 中告知用户需要申请权限。\n\n");
                appendTableMappings(sb, unauthMappings);
            }
        } else {
            sb.append("## 可用的数据库表结构\n");
            sb.append("（未找到与问题相关的表结构）\n\n");
        }

        if (joinMappings != null && !joinMappings.isEmpty()) {
            sb.append("## 表 JOIN 条件\n");
            for (ConceptJoinMapping join : joinMappings) {
                boolean authorized = authorizedConceptIds == null || authorizedConceptIds.isEmpty()
                        || authorizedConceptIds.contains(join.getConceptId());
                sb.append("- **").append(join.getRelationType() != null
                        ? join.getRelationType() : "LEFT JOIN").append("**");
                if (!authorized) sb.append(" 🔒");
                sb.append("\n");
                sb.append("  - **JOIN 表**: `").append(join.getJoinTable()).append("`\n");
                sb.append("  - **JOIN 条件**: `").append(join.getJoinCondition()).append("`\n\n");
            }
        }

        if (apiTools != null && !apiTools.isEmpty()) {
            sb.append("## 可用的 API 工具\n");
            for (int i = 0; i < apiTools.size(); i++) {
                ToolDefinition tool = apiTools.get(i);
                sb.append("### ").append(i + 1).append(". ").append(tool.getDisplayName() != null
                        ? tool.getDisplayName() : tool.getName()).append("\n");
                sb.append("- **名称**: `").append(tool.getName()).append("`\n");
                if (tool.getDescription() != null) {
                    sb.append("- **描述**: ").append(tool.getDescription()).append("\n");
                }
                if (tool.getInputSchema() != null) {
                    sb.append("- **输入参数**: ").append(tool.getInputSchema()).append("\n");
                }
                sb.append("\n");
            }
        }

        sb.append("## 决策规则\n\n");
        sb.append("首先判断用户意图：如果用户是在咨询系统能力范围（如询问\"你能做什么\"），请直接以 final_answer 介绍可用概念域，不要调用工具或生成 SQL。\n\n");
        sb.append("否则，你需要根据概念的权限状态做出判断，有以下三种情况：\n\n");
        sb.append("**情况 1 - 信息足够且全部有权限**：如果匹配的概念全部标记为 ✅，且表结构足够回答用户问题，请生成 SQL 或调用工具。\n\n");
        sb.append("**情况 2 - 信息足够但部分无权限**：如果匹配的概念中含有 🔒 标记，且这些概念对回答用户问题至关重要，请在 final_answer 中明确告知用户：「您的问题涉及「概念名」概念，该概念属于「域名」，当前暂无查询权限，请申请该域的数据权限后再试」。概念名和域名必须从上方的语义层匹配概念表格中读取，不要自己编造。不要对未授权概念生成 SQL。\n\n");
        sb.append("**情况 3 - 信息不足**：如果匹配的概念无法回答用户问题，请直接告知用户需要补充哪些信息。\n");
        sb.append("   - 如果上方「可用的数据库表结构」显示「未找到与问题相关的表结构」，说明当前系统没有配置对应的数据映射，请使用 final_answer 告知用户：「当前未找到与您问题相关的数据表结构，请联系管理员完善本体配置」。\n");
        sb.append("   - 信息不足时不要使用 select_datasources，select_datasources 仅用于本体管理场景。\n\n");
        sb.append("根据判断结果，选择以下方式回复：\n\n");
        sb.append("1. **调用 API 工具**：如果有合适的 API 可以直接回答用户问题，请以如下 JSON 格式回复：\n");
        sb.append("   ```json\n");
        sb.append("   {\"type\": \"tool_call\", \"reasoning\": \"你选择这个工具的原因\", ");
        sb.append("\"tool_call\": {\"name\": \"工具名\", \"arguments\": {...}}}\n");
        sb.append("   ```\n\n");
        sb.append("2. **生成 SQL 查询**：只能对标记为 ✅ 的表生成 SQL。回复格式：\n");
        sb.append("   ```json\n");
        sb.append("   {\"type\": \"nl2sql\", \"reasoning\": \"你选择 SQL 的原因\", ");
        sb.append("\"sql\": \"SELECT ... FROM ...\", \"concept_ids\": [1, 2, 3]}\n");
        sb.append("   ```\n");
        sb.append("   - SQL 只能是 SELECT 查询\n");
        sb.append("   - 请使用上面提供的表名和字段名\n");
        sb.append("   - 如果有 JOIN 条件，请使用提供的 JOIN 条件\n");
        sb.append("   - 如果没有合适的表和字段，不要生成 SQL\n");
        sb.append("   - **【强制】任何涉及日期过滤的查询，必须先执行 `SELECT MIN(date_col), MAX(date_col) FROM table` 确认数据库中实际数据的日期范围**，禁止基于当前系统日期推算日期范围\n");
        sb.append("   - 用户说\"最近\"指的是数据库中最新数据，不是\"最近一个月\"。先查 MAX(date_col) 获取最新日期，再根据最新日期确定查询范围\n");
        sb.append("   - **【强制】对字符串列做等值过滤前，必须先执行 `SELECT DISTINCT(col) FROM table` 查询该列的实际枚举值，根据实际值生成过滤条件，禁止猜测或使用中文语义值（如\"有效\"、\"已完成\"等）**\n");
        sb.append("   - **【强制】计算比率类指标（客诉率、退货率等）时，SQL 必须从分母表出发 LEFT JOIN 分子表，禁止从分子表出发 JOIN 分母表。**\n");
        sb.append("     例如：客诉率 = 客诉订单数 / 总订单数，SQL 应为 `FROM orders LEFT JOIN complaints`，而不是 `FROM complaints LEFT JOIN orders`\n");
        sb.append("   - **【强制】按维度下钻分组时，GROUP BY 的列应从维度实际关联的表中选取，不能从分母表取。**\n");
        sb.append("     判断方法：在「可下钻维度」表格中查看维度的 join_condition，使用该表的分组列。\n");
        sb.append("   - **【强制】分组结果中如果某个维度列全为 NULL，说明当前 JOIN 路径不通，应检查本体中是否存在其他 JOIN 路径，换路径重试，禁止直接下结论。**\n");
        sb.append("   - **禁止使用 CURDATE()、NOW() 等当前时间函数做日期过滤**\n");
        sb.append("   - 如果 SQL 返回 0 行，自行判断是否需要调整 SQL 重试；若判断数据确实不满足条件，直接输出 final_answer 告知用户，不要反复重试\n\n");

        boolean codeModeAvailable = codeExecutorService.isHealthy();
        int optionNum = 3;
        if (codeModeAvailable) {
            sb.append(optionNum).append(". **执行 Python 代码**：当 SQL 无法直接表达复杂计算逻辑（如统计检验、离群值检测、时间序列分解）时，使用 code_mode：\n");
            sb.append("   ```json\n");
            sb.append("   {\"type\": \"code_mode\", \"reasoning\": \"为什么需要代码分析\", ");
            sb.append("\"code\": \"import pandas as pd\\n# 你的分析代码\\n\", \"input_data\": {\"sql\": \"SELECT ...\", \"concept_ids\": [1, 2]}}\n");
            sb.append("   ```\n");
            sb.append("   - code 为完整 Python 脚本，系统会执行并返回 stdout/stderr\n");
            sb.append("   - input_data.sql 为前置 SQL 查询，结果会以 DataFrame 形式传入\n");
            sb.append("   - 仅用于统计计算，不得执行系统命令、文件操作\n\n");
            optionNum++;
        }
        if (isAdmin) {
            sb.append(optionNum).append(". **本体管理建议**：⚠️ 仅当用户意图明确为本体管理（创建概念、配置映射、表连接）时才能使用此选项。数据查询场景下即使缺少表结构，也必须使用 final_answer，不要使用此选项。\n");
            sb.append("   - **如果上方没有「数据源」章节**：说明当前没有可用的数据源信息，你必须先输出 select_datasources 让系统提供数据源：\n");
            sb.append("     ```json\n");
            sb.append("     {\"type\": \"select_datasources\", \"reasoning\": \"为什么需要选择数据源\"}\n");
            sb.append("     ```\n");
            sb.append("   - **如果上方已有「数据源」章节**：直接使用其中提供的数据源ID和表结构，输出 ontology_action 生成本体变更：\n");
            sb.append("   ```json\n");
            sb.append("   {\"type\": \"ontology_action\", \"action\": \"suggest\", \"reasoning\": \"为什么需要变更\", ");
            sb.append("\"trigger\": \"user_request\", \"changes\": [\n");
            sb.append("     {\"operation\": \"ADD_CONCEPT\", \"concept\": {\"name\": \"概念名\", \"description\": \"描述\", \"industryId\": 1, \"groupId\": 1, \"anomalyThresholdExpr\": \">5%\", \"anomalyThresholdDesc\": \"超过5%判定为异常\"}},\n");
            sb.append("     {\"operation\": \"ADD_CONCEPT\", \"concept\": {\"name\": \"概念名\", \"description\": \"描述\", \"industryId\": 1, \"groupName\": \"新领域名\", \"anomalyThresholdExpr\": \">10%\", \"anomalyThresholdDesc\": \"超过10%判定为异常\"}},\n");
            sb.append("     {\"operation\": \"UPDATE_CONCEPT\", \"concept\": {\"id\": 70, \"name\": \"新名称\", \"description\": \"更新后的描述\", \"anomalyThresholdExpr\": \">5%\", \"anomalyThresholdDesc\": \"超过5%判定为异常\"}},\n");
            sb.append("     {\"operation\": \"ADD_RELATION\", \"relation\": {\"sourceConceptName\": \"源概念\", \"targetConceptName\": \"目标概念\", \"relationType\": \"DRILLS_INTO\"}},\n");
            sb.append("     {\"operation\": \"ADD_MAPPING\", \"mapping\": {\"conceptName\": \"概念名\", \"tableName\": \"表名\", \"columnName\": \"列名\", \"mappingType\": \"direct\", \"dataSourceId\": 1}},\n");
            sb.append("     {\"operation\": \"ADD_JOIN_MAPPING\", \"joinMapping\": {\"leftTable\": \"orders\", \"rightTable\": \"returns\", \"leftColumn\": \"order_id\", \"rightColumn\": \"order_id\", \"joinType\": \"LEFT\", \"dataSourceId\": 1, \"targetConcept\": \"退货记录\", \"conceptName\": \"订单量\"}}\n");
            sb.append("   ]}\n");
            sb.append("   ```\n");
            sb.append("   - 支持操作：ADD_CONCEPT、UPDATE_CONCEPT、DELETE_CONCEPT、ADD_RELATION、DELETE_RELATION、ADD_MAPPING、UPDATE_MAPPING、DELETE_MAPPING、ADD_JOIN_MAPPING、UPDATE_JOIN_MAPPING、DELETE_JOIN_MAPPING\n");
            sb.append("   - trigger 可选 user_request（用户明确要求）或 auto_detect（分析过程中自动发现）\n");
            sb.append("   - 变更数量不做限制，按实际需求完整配置，每条变更必须附带 reasoning\n");
            sb.append("   - 变更不会自动生效，需管理员审核确认\n");
            sb.append("   - 仅超管可用，普通用户触发时返回权限不足提示\n");
            sb.append("   - **可用关系类型**：创建关系时必须使用以下已注册的关系类型之一，如果现有类型不满足需求，可先在 ADD_RELATION 中使用新类型名（管理员审核时会自动注册）\n");
            if (availableRelations != null && !availableRelations.isEmpty()) {
                sb.append(availableRelations);
            } else {
                sb.append("     - DRILLS_INTO: 可下钻到子维度，纯分析导航\n");
                sb.append("     - CORRELATED: 关联维度，交叉分析提示\n");
            }
            sb.append("\n\n");
            optionNum++;
        }
        sb.append(optionNum).append(". **直接回答**：如果无法通过工具或 SQL 回答，请直接回复：\n");
        sb.append("   ```json\n");
        sb.append("   {\"type\": \"final_answer\", \"reasoning\": \"你的推理过程\", \"answer\": \"你的回答\", \"concept_ids\": [匹配的概念ID列表]}\n");
        sb.append("   ```\n");
        sb.append("   - concept_ids 必须填写：从上方语义层匹配概念表格中，列出你认为回答此问题所涉及的概念ID\n");
        sb.append("   - 当完成下钻分析确定根因时，使用 root_cause 格式（见下方「根因分析输出规范」）\n\n");
        sb.append("当 SQL 查询成功返回结果后，在 final_answer 中必须遵守以下规范：\n");
        sb.append("- 在答案开头明确写出本次查询的具体条件，让用户能验证证据链\n");
        sb.append("- 如果结果以表格呈现，表格中必须包含与查询条件直接相关的字段，不能只展示 ID\n");
        sb.append("请务必严格按照上述 JSON 格式回复，不要添加额外文本。\n\n");
        sb.append("## 根因分析输出规范\n\n");
        sb.append("当经过多轮下钻分析确定根因后，final_answer 必须使用以下 JSON Schema：\n");
        sb.append("```json\n");
        sb.append("{\n");
        sb.append("  \"type\": \"final_answer\",\n");
        sb.append("  \"answer_type\": \"root_cause\",\n");
        sb.append("  \"reasoning\": \"完整推理链，包含每轮下钻的SQL和关键发现\",\n");
        sb.append("  \"answer\": \"根因结论的自然语言描述\",\n");
        sb.append("  \"evidence\": [\n");
        sb.append("    {\"step\": 1, \"dimension\": \"分析维度\", \"sql\": \"执行的SQL\", \"finding\": \"关键发现\", \"anomaly\": true/false}\n");
        sb.append("  ],\n");
        sb.append("  \"root_cause\": \"根因总结\",\n");
        sb.append("  \"suggestion\": \"建议措施\",\n");
        sb.append("  \"concept_ids\": [1, 2, 3]\n");
        sb.append("}\n");
        sb.append("```\n\n");
        sb.append("## 异常阈值检测规则\n\n");
        sb.append("如果上方「可下钻维度」表格中某个维度标注了异常阈值，且当前查询结果显示该维度值触发了阈值：\n");
        sb.append("1. 在 answer 中明确标注异常：「⚠️ 异常：维度名 当前值 X%，超过阈值 Y%」\n");
        sb.append("2. 在 [drill_suggestions] 中将该维度排在首位，并标注 [异常] 标记\n");
        sb.append("3. 如果阈值是「< 80% 计划值」等下限阈值，数值低于阈值视为异常\n");
        sb.append("示例：「订单量环比下降 15%，超过 10% 阈值，建议按渠道下钻分析」");

        return sb.toString();
    }

    private void appendTableMappings(StringBuilder sb, List<ConceptMapping> mappings) {
        Map<String, List<ConceptMapping>> grouped = mappings.stream()
                .collect(Collectors.groupingBy(ConceptMapping::getTableName, LinkedHashMap::new, Collectors.toList()));
        for (Map.Entry<String, List<ConceptMapping>> entry : grouped.entrySet()) {
            sb.append("### 表: `").append(entry.getKey()).append("`\n");
            sb.append("| 列名 | 属性名 | 映射类型 | 计算表达式 |\n");
            sb.append("|------|--------|----------|------------|\n");
            for (ConceptMapping m : entry.getValue()) {
                sb.append("| `").append(m.getColumnName()).append("`");
                sb.append(" | ").append(m.getAttributeName() != null ? m.getAttributeName() : "-");
                sb.append(" | ").append(m.getMappingType() != null ? m.getMappingType() : "direct");
                sb.append(" | ").append(m.getComputedExpr() != null ? m.getComputedExpr() : "-");
                sb.append(" |\n");
            }
            sb.append("\n");
        }
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

            // 如果 LLM 未返回 concept_ids，使用统一上下文中的概念 ID 作为回退
            if (conceptIds.isEmpty()) {
                @SuppressWarnings("unchecked")
                List<Long> ctxConceptIds = (List<Long>) data.getOrDefault("concept_ids", List.of());
                if (ctxConceptIds != null && !ctxConceptIds.isEmpty()) {
                    conceptIds = ctxConceptIds;
                }
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> messages = (List<Map<String, Object>>) data.get("messages");

            data.put("nl2sql", Map.of("sql", sql, "conceptIds", conceptIds));
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
            log.info("NL2SQL executor #{}: executing SQL={}", sqlExecCount + 1, sql.length() > 200 ? sql.substring(0, 200) : sql);
            @SuppressWarnings("unchecked")
            Set<String> knownValues = new java.util.HashSet<>();
            Object knownObj = data.get("known_values");
            if (knownObj instanceof List<?> list) {
                for (Object item : list) {
                    if (item instanceof String s) knownValues.add(s);
                }
            }
            Map<String, Object> queryResult = executeNl2sql(sql, conceptIds, userId, knownValues);
            data.put("query_result", queryResult);

            Boolean executed = (Boolean) queryResult.get("executed");
            String error = (String) queryResult.get("error");

            // 授权错误不重试：提示用户申请对应域的概念权限
            boolean isAuthError = error != null && error.contains("未授权");

            if (executed != null && !executed && retryCount < NL2SQL_MAX_RETRIES && !isAuthError) {
                data.put("nl2sql_retry_count", retryCount + 1);
                data.put("nl2sql_last_error", error);
                String retryMsg = "SQL 执行失败: " + error + "。请根据错误信息修正 SQL 并重试（第 " + (retryCount + 1) + "/" + NL2SQL_MAX_RETRIES + " 次重试）。";
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> mismatches = (List<Map<String, Object>>) queryResult.get("stringMismatches");
                if (mismatches != null && !mismatches.isEmpty()) {
                    StringBuilder sb = new StringBuilder();
                    sb.append(retryMsg).append("\n\n实际数据库中的值如下：\n");
                    for (Map<String, Object> m : mismatches) {
                        sb.append("- 表 `").append(m.get("table")).append("` 列 `").append(m.get("column"))
                                .append("` 不存在值 '").append(m.get("usedValue")).append("'，实际值为：")
                                .append(m.get("actualValues")).append("\n");
                    }
                    sb.append("\n请使用上述实际值替换 SQL 中的字符串过滤条件后重新生成 nl2sql。");
                    retryMsg = sb.toString();
                }
                messages.add(Map.of("role", "tool", "tool_call_id", nl2sqlToolCallId != null ? nl2sqlToolCallId : "", "content", retryMsg));
                data.put("next_action", "continue");
            } else {
                data.put("nl2sql_retry_count", 0);
                data.remove("nl2sql_last_error");
                if (isAuthError) {
                    // 授权错误：直接提示用户申请权限，不让 LLM 继续尝试
                    String authMsg = "SQL 执行失败: " + error + "。请申请对应域的概念查询权限后再试。";
                    messages.add(Map.of("role", "tool", "tool_call_id", nl2sqlToolCallId != null ? nl2sqlToolCallId : "", "content", authMsg));
                } else {
                    // SQL 执行成功，计入下钻轮数
                    data.put("sql_exec_count", sqlExecCount + 1);
                    String resultSummary = formatNl2sqlResult(queryResult);
                    messages.add(Map.of("role", "tool", "tool_call_id", nl2sqlToolCallId != null ? nl2sqlToolCallId : "", "content", resultSummary));

                    // 累积 SQL 结果中的字符串值，用于后续等值校验判断是否为真实数据值
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> resultData = (List<Map<String, Object>>) queryResult.get("data");
                    if (resultData != null) {
                        java.util.List<String> known = (java.util.List<String>) data.computeIfAbsent("known_values", k -> new java.util.ArrayList<String>());
                        for (Map<String, Object> row : resultData) {
                            for (Object val : row.values()) {
                                if (val instanceof String s && !s.isEmpty()) {
                                    known.add(s);
                                }
                            }
                        }
                    }

                    @SuppressWarnings("unchecked")
                    List<Long> drilled = new ArrayList<>((List<Long>) data.getOrDefault("drilled_concepts", List.of()));
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
            return CompletableFuture.completedFuture(data);
        };
    }

    private Map<String, Object> executeNl2sql(String sql, List<Long> conceptIds, Long userId, Set<String> knownValues) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sql", sql);

        Set<Long> authorizedGroupIds = Set.of();
        List<ConceptMapping> allowedMappings = new ArrayList<>();

        if (conceptIds != null && !conceptIds.isEmpty() && userId != null) {
            List<Concept> matchedConcepts = conceptRepository.findAllById(conceptIds);
            Set<Long> groupIds = matchedConcepts.stream()
                    .map(Concept::getGroupId)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet());

            authorizedGroupIds = roleConceptPermissionService.getAuthorizedGroupIds(userId, groupIds);
            Set<Long> unauthorizedGroups = new HashSet<>(groupIds);
            unauthorizedGroups.removeAll(authorizedGroupIds);

            if (!unauthorizedGroups.isEmpty()) {
                List<String> unauthorizedNames = matchedConcepts.stream()
                        .filter(c -> unauthorizedGroups.contains(c.getGroupId()))
                        .map(Concept::getName)
                        .collect(Collectors.toList());
                result.put("executed", false);
                result.put("error", "权限不足：以下概念所属域未授权 —— " + String.join(", ", unauthorizedNames));
                log.warn("NL2SQL permission denied: userId={}, unauthorized groups={}", userId, unauthorizedGroups);
                return result;
            }

            List<Long> allConceptIds = new ArrayList<>();
            allConceptIds.addAll(conceptIds);
            for (Long gid : authorizedGroupIds) {
                List<Concept> groupConcepts = conceptRepository.findByGroupId(gid);
                for (Concept gc : groupConcepts) {
                    if (!allConceptIds.contains(gc.getId())) {
                        allConceptIds.add(gc.getId());
                    }
                }
            }
            log.info("NL2SQL: concept_ids {} → authorized groups {} → expanded to {} concepts",
                    conceptIds, authorizedGroupIds, allConceptIds.size());

            if (!allConceptIds.isEmpty()) {
                allowedMappings = conceptMappingRepository.findByConceptIdIn(allConceptIds);
            }
        }

        SqlSecurityValidator.ValidationResult validation = sqlSecurityValidator.validate(
                sql, null, allowedMappings.isEmpty() ? null : allowedMappings);
        if (!validation.isValid()) {
            result.put("executed", false);
            result.put("error", String.join("; ", validation.getErrors()));
            log.warn("NL2SQL validation failed: {}", result.get("error"));
            return result;
        }

        Long datasourceId = null;
        if (!allowedMappings.isEmpty()) {
            datasourceId = allowedMappings.get(0).getDatasourceId();
        }

        if (datasourceId == null) {
            result.put("executed", false);
            result.put("error", "无法确定数据源，SQL 未执行");
            return result;
        }

        try {
            com.luban.entity.Datasource ds = datasourceService.getById(datasourceId);
            Map<String, Object> config = new ObjectMapper().readValue(
                    ds.getConfig(), new TypeReference<Map<String, Object>>() {});
            String url = datasourceService.buildJdbcUrl(ds.getType(), config);

            try (Connection conn = nl2sqlConnectionPool.getConnection(
                    datasourceId, url,
                    String.valueOf(config.get("username")),
                    String.valueOf(config.get("password")));
                 Statement stmt = conn.createStatement()) {

                stmt.setQueryTimeout(NL2SQL_TIMEOUT_SECONDS);

                // 字符串等值校验：检查 WHERE 条件中字符串值是否真实存在
                Map<String, Object> stringCheck = validateStringEqualityFilters(sql, allowedMappings, conn, knownValues);
                if (!Boolean.TRUE.equals(stringCheck.get("valid"))) {
                    result.put("executed", false);
                    result.put("error", "SQL 中字符串过滤条件使用了不存在的值，请使用以下实际值重新生成 SQL");
                    result.put("stringMismatches", stringCheck.get("mismatches"));
                    log.warn("NL2SQL string value mismatch: {}", stringCheck.get("mismatches"));
                    return result;
                }

                String limitedSql = sql.trim().replaceAll(";+\\s*$", "");
                if (!limitedSql.toUpperCase().contains("LIMIT")) {
                    limitedSql = limitedSql + " LIMIT " + NL2SQL_MAX_ROWS;
                }

                try (ResultSet rs = stmt.executeQuery(limitedSql)) {
                    ResultSetMetaData meta = rs.getMetaData();
                    int columnCount = meta.getColumnCount();
                    List<Map<String, Object>> rows = new ArrayList<>();
                    int estimatedBytes = 0;

                    while (rs.next() && rows.size() < NL2SQL_MAX_ROWS) {
                        Map<String, Object> row = new LinkedHashMap<>();
                        for (int i = 1; i <= columnCount; i++) {
                            Object val = rs.getObject(i);
                            row.put(meta.getColumnName(i), val);
                            if (val != null) {
                                estimatedBytes += val.toString().length() * 2;
                            }
                        }
                        rows.add(row);

                        if (estimatedBytes > NL2SQL_MAX_RESULT_BYTES) {
                            result.put("truncated", true);
                            result.put("truncatedReason", "结果集超过 10MB 内存上限");
                            break;
                        }
                    }

                    boolean truncated = rs.next() || result.containsKey("truncated");
                    result.put("executed", true);
                    result.put("data", rows);
                    result.put("rowCount", rows.size());
                    result.put("truncated", truncated);
                    result.put("columnNames", columnCount > 0
                            ? java.util.stream.IntStream.range(1, columnCount + 1)
                                    .mapToObj(i -> {
                                        try { return meta.getColumnName(i); }
                                        catch (Exception e) { return "col" + i; }
                                    }).toList()
                            : List.of());
                }
            }
        } catch (Exception e) {
            log.error("NL2SQL execution failed: {}", e.getMessage());
            result.put("executed", false);
            result.put("error", "SQL 执行失败: " + e.getMessage());
            return result;
        }
        return result;
    }

    /**
     * 校验 SQL 中字符串等值过滤条件使用的值是否真实存在于数据库中。
     * 如果发现不存在的值，返回实际枚举值供 LLM 修正。
     */
    private Map<String, Object> validateStringEqualityFilters(String sql,
            List<ConceptMapping> mappings, java.sql.Connection conn, Set<String> knownValues) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("valid", true);

        java.util.regex.Pattern eqPattern = java.util.regex.Pattern.compile(
                "(?:\\w+\\.)?(\\w+)\\s*=\\s*'([^']+)'");
        java.util.regex.Matcher eqMatcher = eqPattern.matcher(sql);

        java.util.Set<String> checkedColumns = new java.util.HashSet<>();
        java.util.List<Map<String, Object>> mismatches = new java.util.ArrayList<>();

        while (eqMatcher.find()) {
            String colName = eqMatcher.group(1);
            String value = eqMatcher.group(2);

            if (value.matches("[-+]?\\d+(\\.\\d+)?")) continue;
            if (checkedColumns.contains(colName.toLowerCase())) continue;
            checkedColumns.add(colName.toLowerCase());

            String tableName = findTableForColumn(colName, mappings);
            if (tableName == null) continue;

            // 如果该值在历史 SQL 结果中出现过，说明是真实数据值（如姓名、日期），跳过校验
            if (knownValues != null && knownValues.contains(value)) continue;

            try {
                String checkSql = "SELECT DISTINCT `" + colName + "` FROM `" + tableName + "` LIMIT 50";
                try (java.sql.Statement stmt = conn.createStatement()) {
                    stmt.setQueryTimeout(5);
                    try (java.sql.ResultSet rs = stmt.executeQuery(checkSql)) {
                        java.util.List<String> distinctValues = new java.util.ArrayList<>();
                        while (rs.next()) {
                            String val = rs.getString(1);
                            if (val != null) distinctValues.add(val);
                        }

                        if (distinctValues.isEmpty()) continue;

                        if (!distinctValues.contains(value)) {
                            Map<String, Object> mismatch = new LinkedHashMap<>();
                            mismatch.put("column", colName);
                            mismatch.put("table", tableName);
                            mismatch.put("usedValue", value);
                            mismatch.put("actualValues", distinctValues);
                            mismatches.add(mismatch);
                        }
                    }
                }
            } catch (Exception ignored) {
                // 校验失败不影响主流程
            }
        }

        if (!mismatches.isEmpty()) {
            result.put("valid", false);
            result.put("mismatches", mismatches);
        }

        return result;
    }

    private String findTableForColumn(String colName, List<ConceptMapping> mappings) {
        for (ConceptMapping mapping : mappings) {
            if (colName.equalsIgnoreCase(mapping.getColumnName())) {
                return mapping.getTableName();
            }
        }
        return null;
    }

    private List<String> extractTableNames(String sql) {
        List<String> tables = new ArrayList<>();
        java.util.regex.Pattern pattern = java.util.regex.Pattern.compile(
                "\\b(FROM|JOIN|INTO|UPDATE)\\s+([a-zA-Z_][a-zA-Z0-9_]*)",
                java.util.regex.Pattern.CASE_INSENSITIVE);
        java.util.regex.Matcher matcher = pattern.matcher(sql);
        while (matcher.find()) {
            String tableName = matcher.group(2).toLowerCase();
            if (!tables.contains(tableName)) {
                tables.add(tableName);
            }
        }
        return tables;
    }

    private String formatNl2sqlResult(Map<String, Object> queryResult) {
        Boolean executed = (Boolean) queryResult.get("executed");
        if (executed != null && executed) {
            String sql = (String) queryResult.get("sql");
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> data = (List<Map<String, Object>>) queryResult.get("data");
            if (data != null && !data.isEmpty()) {
                return "SQL 查询成功: " + sql + "\n结果: " + data.toString();
            }
            return "SQL 查询成功但返回 0 行。如果数据确实不满足条件，请直接输出 final_answer 告知用户，不要反复重试。SQL: " + sql;
        }
        return "SQL 查询失败: " + queryResult.getOrDefault("error", "未知错误");
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

    private String inferEntityType(String operation) {
        if (operation == null) return "UNKNOWN";
        String upper = operation.toUpperCase();
        if (upper.contains("CONCEPT") && !upper.contains("JOIN") && !upper.contains("MAPPING") && !upper.contains("RELATION")) return "CONCEPT";
        if (upper.contains("JOIN")) return "JOIN_MAPPING";
        if (upper.contains("MAPPING")) return "MAPPING";
        if (upper.contains("RELATION")) return "RELATION";
        return "UNKNOWN";
    }

    private Map<String, Object> parseSelectedDatasources(List<Map<String, Object>> messages) {
        if (messages == null) return null;
        for (int i = messages.size() - 1; i >= 0; i--) {
            Map<String, Object> msg = messages.get(i);
            if ("user".equals(msg.get("role"))) {
                String content = (String) msg.get("content");
                if (content != null && content.contains("已选择数据源")) {
                    Map<String, Object> prevAssistant = i > 0 ? messages.get(i - 1) : null;
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> selectDatasources = prevAssistant != null
                            ? (List<Map<String, Object>>) prevAssistant.get("selectDatasources")
                            : null;
                    log.info("parseSelectedDatasources: found '已选择数据源' user msg at index {}, prevAssistant role={}, selectDatasources={}",
                            i, prevAssistant != null ? prevAssistant.get("role") : "null",
                            selectDatasources != null ? selectDatasources.size() + " items" : "null");

                    List<Map<String, Object>> selected = new ArrayList<>();
                    String[] lines = content.split("\n");
                    for (int j = 1; j < lines.length; j++) {
                        String line = lines[j].trim();
                        java.util.regex.Matcher m = java.util.regex.Pattern
                                .compile("^-\\s+(.+?)\\s+\\[表:\\s*(.+?)\\]$")
                                .matcher(line);
                        if (m.find()) {
                            String dsName = m.group(1).trim();
                            String tablesStr = m.group(2).trim();
                            List<String> tables = List.of(tablesStr.split("\\s*,\\s*"));
                            Object dsId = null;
                            if (selectDatasources != null) {
                                for (Map<String, Object> ds : selectDatasources) {
                                    if (dsName.equals(ds.get("name"))) {
                                        dsId = ds.get("id");
                                        break;
                                    }
                                }
                            }
                            Map<String, Object> sel = new java.util.LinkedHashMap<>();
                            sel.put("name", dsName);
                            sel.put("tables", tables);
                            if (dsId != null) {
                                sel.put("id", dsId);
                            }
                            selected.add(sel);
                        }
                    }
                    if (!selected.isEmpty()) {
                        log.info("parseSelectedDatasources: parsed {} datasources, ids={}",
                                selected.size(),
                                selected.stream().map(s -> s.get("id")).toList());
                        return Map.of("selected", selected);
                    }
                }
                break;
            }
        }
        return null;
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

            Set<String> knownConcepts = collectKnownConceptNames(changes);
            for (Map<String, Object> change : changes) {
                String operation = (String) change.getOrDefault("operation", "UNKNOWN");

                if (!validateConceptReference(operation, change, knownConcepts, validationErrors)) {
                    continue;
                }
                if (!validateMappingField(operation, change, tableColumnCache, validationErrors)) {
                    continue;
                }

                String entityType = (String) change.getOrDefault("entity_type", inferEntityType(operation));
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

            String summary;
            if (!validationErrors.isEmpty()) {
                summary = "本体变更校验失败，以下映射的字段在数据库中不存在，请修正后重试：\n"
                        + String.join("\n", validationErrors);
                if (!recorded.isEmpty()) {
                    summary += "\n\n已成功记录 " + recorded.size() + " 条有效变更。";
                }
            } else {
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

    private Set<String> collectKnownConceptNames(List<Map<String, Object>> changes) {
        Set<String> names = new HashSet<>();
        for (Map<String, Object> change : changes) {
            String operation = (String) change.getOrDefault("operation", "UNKNOWN");
            if ("ADD_CONCEPT".equals(operation)) {
                @SuppressWarnings("unchecked")
                Map<String, Object> conceptData = (Map<String, Object>) change.get("concept");
                if (conceptData != null) {
                    String name = (String) conceptData.get("name");
                    if (name != null && !name.isEmpty()) {
                        names.add(name);
                    }
                }
            }
        }
        return names;
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
                                          List<String> errors) {
        if (!"ADD_MAPPING".equals(operation) && !"UPDATE_MAPPING".equals(operation)) {
            return true;
        }

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
                            return objectMapper.writeValueAsString(Map.of(
                                    "id", mapping.getId(),
                                    "tableName", mapping.getTableName(),
                                    "columnName", mapping.getColumnName(),
                                    "mappingType", mapping.getMappingType() != null ? mapping.getMappingType() : "",
                                    "datasourceId", mapping.getDatasourceId()
                            ));
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

    private AsyncNodeAction<AgentState> buildSelectDatasourcesNode() {
        return (state) -> {
            Map<String, Object> data = new LinkedHashMap<>(state.data());
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> available = (List<Map<String, Object>>) data.get("availableDatasources");
            log.info("select_datasources node: availableDatasources={}",
                    available != null ? available.size() : "null");
            data.put("select_datasources", available != null ? available : List.of());
            data.put("final_answer", "请选择需要使用的数据源和表：");
            data.put("next_action", "final_answer");

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> messages = (List<Map<String, Object>>) data.get("messages");
            if (messages != null && !messages.isEmpty() && available != null && !available.isEmpty()) {
                Map<String, Object> lastMsg = messages.get(messages.size() - 1);
                log.info("select_datasources node: lastMsg role={}, isMutable={}, hasSelectDatasources={}",
                        lastMsg.get("role"), lastMsg.getClass().getName(), lastMsg.containsKey("selectDatasources"));
                if ("assistant".equals(lastMsg.get("role")) && !lastMsg.containsKey("selectDatasources")) {
                    try {
                        lastMsg.put("selectDatasources", available);
                        log.info("select_datasources node: successfully injected selectDatasources into messages");
                    } catch (Exception e) {
                        log.error("select_datasources node: failed to inject selectDatasources - {}", e.getMessage());
                    }
                }
            }

            return CompletableFuture.completedFuture(data);
        };
    }

    private AsyncNodeAction<AgentState> buildFinalAnswerNode() {
        return (state) -> {
            Map<String, Object> data = new LinkedHashMap<>(state.data());
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> finalMessages = (List<Map<String, Object>>) data.get("messages");
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

            String chatUrl = normalizeChatUrl(config.getModelEndpoint());
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
                                                    onReasoning.accept(reasoningContent);
                                                }
                                            }
                                            if (content != null && !content.isEmpty()) {
                                                if (!firstTokenLogged.getAndSet(true)) {
                                                    long ttft = System.currentTimeMillis() - startTime;
                                                    log.info("LLM TTFT: {}ms", ttft);
                                                }
                                                fullContent.append(content);
                                                if (onChunk != null) {
                                                    onChunk.accept(content);
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
            sb.append("你有六种方式回答用户问题：\n");
            sb.append("1. 调用 API 工具获取数据\n");
            sb.append("2. 生成 SQL 查询数据库（仅限 SELECT）\n");
            sb.append("3. 执行 Python 代码分析数据（code_mode）\n");
            sb.append("4. 选择数据源（select_datasources，本体管理前置步骤，在生成本体变更前必须执行）\n");
            sb.append("5. 生成本体管理建议（ontology_action，仅超管可用，必须在 select_datasources 之后）\n");
            sb.append("6. 直接回答（final_answer）\n\n");
        } else {
            sb.append("你有四种方式回答用户问题：\n");
            sb.append("1. 调用 API 工具获取数据\n");
            sb.append("2. 生成 SQL 查询数据库（仅限 SELECT）\n");
            sb.append("3. 执行 Python 代码分析数据（code_mode）\n");
            sb.append("4. 直接回答（final_answer）\n\n");
        }

        sb.append("请根据上下文信息选择最合适的方式，并在 reasoning 中说明你的推理过程。\n");
        sb.append("所有回复必须严格按照 JSON 格式，不要添加额外文本。\n");
        sb.append("如果需要执行多个步骤，可以一次输出多个 JSON 对象（系统会按顺序逐个执行）。\n\n");
        sb.append("## 表格格式规范（重要）\n");
        sb.append("在 final_answer 的 answer 字段或 ontology_action 的 reasoning 中需要展示表格数据时，必须使用标准 Markdown 表格格式（管道符 | 分隔），禁止使用 Tab 字符分隔列。\n");
        sb.append("正确格式示例：\n");
        sb.append("| 表头1 | 表头2 | 表头3 |\n");
        sb.append("|-------|-------|-------|\n");
        sb.append("| 数据1 | 数据2 | 数据3 |\n");
        sb.append("| 数据4 | 数据5 | 数据6 |\n");
        sb.append("规则：\n");
        sb.append("- 表头行和分隔行必须完整，列数与表头一致\n");
        sb.append("- 每行必须以 | 开头，以 | 结尾\n");
        sb.append("- 禁止使用 Tab 字符分隔列，禁止在表格中使用 Tab\n");
        sb.append("- 多个表格之间必须空一行\n\n");
        sb.append("## 下钻分析规则\n");
        sb.append("上文中出现「可下钻维度」表格时，说明当前查询结果可进一步按子维度拆解分析。\n");
        sb.append("**重要：请自动继续下钻，不要停在 final_answer 给建议。**\n");
        sb.append("每次 SQL 查询得到结果后，如果发现数据异常（超过阈值）或值得深入分析，\n");
        sb.append("应立即生成下一个 nl2sql 继续下钻到子维度，而不是输出 final_answer。\n");
        sb.append("**下钻必须严格按照「可下钻维度」表格中列出的维度链依次进行，不要跳到表格中未列出的其他维度。**\n");
        sb.append("只有当所有可下钻维度都已分析完毕、数据无明显异常无需继续、或 SQL 连续返回 0 行无法继续时，才使用 final_answer 总结根因。\n");
        sb.append("final_answer 中如需总结已分析的下钻路径，以 `[drill_suggestions]` 为标记。\n");
        sb.append("如果维度有异常阈值，且当前查询结果触发了阈值，必须在 reasoning 中明确指出异常。\n");
        sb.append("例如：「订单量环比下降15%，超过10%阈值，继续按渠道下钻分析」。\n\n");
        sb.append("## 关联维度交叉验证规则\n");
        sb.append("上文中出现「关联维度（交叉验证）」表格时，说明存在与当前概念相关联的维度，需要交叉验证以排除干扰因素。\n");
        sb.append("**在完成所有下钻维度分析后、输出 final_answer 之前，必须对每个关联维度生成一个 nl2sql 进行交叉验证。**\n");
        sb.append("关联维度的用途是确认根因是否由该维度变化导致，例如：\n");
        sb.append("- 客诉率上升 → 检查订单量是否暴涨（如果是，则客诉率的上升可能是分母变大导致，而非真实客诉变多）\n");
        sb.append("- 退货率上升 → 检查销量是否暴涨（如果是，则退货率的上升可能是分母变大导致）\n");
        sb.append("关联维度验证完毕后，在 final_answer 的 evidence 中包含关联维度的验证结果，并标注 anomaly 为 false（除非关联维度本身也异常）。\n\n");
        sb.append("## 异常阈值检测规则\n");
        sb.append("如果「可下钻维度」表格中某个维度标注了异常阈值，且当前查询结果显示该维度值触发了阈值：\n");
        sb.append("1. 在 nl2sql 的 reasoning 中说明异常：「⚠️ 异常：维度名 当前值 X%，超过阈值 Y%，继续下钻」\n");
        sb.append("2. 自动生成下一个 nl2sql 按该维度下钻，不要停在 final_answer\n");
        sb.append("3. 如果阈值是「< 80% 计划值」等下限阈值，数值低于阈值视为异常\n\n");
        sb.append("## 根因分析输出规范\n");
        sb.append("当经过多轮下钻分析确定根因后，final_answer 必须包含 evidence 证据链和 root_cause 根因总结。\n");
        sb.append("**所有下钻维度分析完毕后，必须输出 final_answer JSON 格式的总结，不要输出自然语言文本。**\n");
        sb.append("如果还需要继续分析，必须输出对应类型的 JSON（nl2sql/code_mode），不要只输出自然语言思考。\n");
        if (isAdmin) {
            sb.append("\n");
            sb.append("## 本体管理规则\n");
            sb.append("当用户明确要求管理本体，或分析过程中发现概念缺失/关系不完整/映射错误时，可使用 ontology_action。\n");
            sb.append("支持操作：ADD_CONCEPT、UPDATE_CONCEPT、DELETE_CONCEPT、ADD_RELATION、DELETE_RELATION、ADD_MAPPING、UPDATE_MAPPING、DELETE_MAPPING、ADD_JOIN_MAPPING、UPDATE_JOIN_MAPPING、DELETE_JOIN_MAPPING。\n");
            sb.append("变更不会自动生效，需管理员审核确认。变更数量不做限制，按实际需求完整配置。");
        }
        return sb.toString();
    }

    /**
     * 规范化 chat completions URL。
     * 如果已包含 /chat/completions 则直接使用，否则拼接 /chat/completions。
     */
    private String normalizeChatUrl(String endpoint) {
        String url = endpoint.replaceAll("/+$", "");
        if (url.endsWith("/chat/completions")) {
            return url;
        }
        if (!url.matches(".*/v\\d+$")) {
            url += "/v1";
        }
        return url + "/chat/completions";
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

    private String buildFullOntologyContext() {
        StringBuilder sb = new StringBuilder();

        List<com.luban.entity.Industry> industries = industryService.list();
        if (!industries.isEmpty()) {
            sb.append("## 可用行业（只能选择已有行业，不能新建）\n");
            sb.append("| 行业ID | 行业名 | 显示名 |\n");
            sb.append("|--------|--------|--------|\n");
            for (com.luban.entity.Industry ind : industries) {
                sb.append("| ").append(ind.getId())
                        .append(" | ").append(ind.getName())
                        .append(" | ").append(ind.getDisplayName())
                        .append(" |\n");
            }
            sb.append("\n");
        }

        List<OntologyGroup> allGroups = ontologyGroupRepository.findAll();
        if (!allGroups.isEmpty()) {
            sb.append("## 可用领域（域/分组，可选择已有或新建）\n");
            sb.append("| 域ID | 域名 | 显示名 | 所属行业ID |\n");
            sb.append("|------|------|--------|-----------|\n");
            for (OntologyGroup g : allGroups) {
                sb.append("| ").append(g.getId())
                        .append(" | ").append(g.getName())
                        .append(" | ").append(g.getDisplayName())
                        .append(" | ").append(g.getIndustryId() != null ? g.getIndustryId() : "-")
                        .append(" |\n");
            }
            sb.append("\n");
        } else {
            sb.append("## 可用领域\n");
            sb.append("（暂无领域，可新建。新建时指定 groupName 和 industryId，系统会自动创建）\n\n");
        }

        List<Concept> allConcepts = conceptRepository.findAll();
        if (!allConcepts.isEmpty()) {
            sb.append("## 已有概念列表（避免重复创建）\n");
            sb.append("| 概念ID | 概念名 | 域ID | 描述 | 异常阈值 | 父概念ID |\n");
            sb.append("|--------|--------|------|------|----------|----------|\n");
            for (Concept c : allConcepts) {
                sb.append("| ").append(c.getId())
                        .append(" | ").append(c.getName())
                        .append(" | ").append(c.getGroupId() != null ? c.getGroupId() : "-")
                        .append(" | ").append(c.getDescription() != null ? c.getDescription() : "-")
                        .append(" | ").append(c.getAnomalyThresholdExpr() != null ? c.getAnomalyThresholdExpr() : "-")
                        .append(" | ").append(c.getParentId() != null ? c.getParentId() : "-")
                        .append(" |\n");
            }
            sb.append("\n");
        }

        List<ConceptRelation> allRelations = conceptRelationRepository.findAll();
        if (!allRelations.isEmpty()) {
            sb.append("## 已有关系列表（避免重复创建）\n");
            sb.append("| 源概念 | 目标概念 | 关系类型 |\n");
            sb.append("|--------|----------|----------|\n");
            Set<String> seen = new HashSet<>();
            for (ConceptRelation r : allRelations) {
                String key = r.getSourceConceptId() + "->" + r.getTargetConceptId() + ":" + r.getRelationType();
                if (seen.add(key)) {
                    String src = conceptRepository.findById(r.getSourceConceptId()).map(Concept::getName).orElse("?");
                    String tgt = conceptRepository.findById(r.getTargetConceptId()).map(Concept::getName).orElse("?");
                    sb.append("| ").append(src).append(" | ").append(tgt).append(" | ").append(r.getRelationType()).append(" |\n");
                }
            }
            sb.append("\n");
        }

        List<ConceptMapping> allMappings = conceptMappingRepository.findAll();
        if (!allMappings.isEmpty()) {
            sb.append("## 已有映射列表（避免重复创建）\n");
            sb.append("| 概念 | 表名 | 列名 | 映射类型 | 数据源ID |\n");
            sb.append("|------|------|------|----------|----------|\n");
            for (ConceptMapping m : allMappings) {
                String cname = conceptRepository.findById(m.getConceptId()).map(Concept::getName).orElse("?");
                sb.append("| ").append(cname).append(" | ").append(m.getTableName())
                        .append(" | ").append(m.getColumnName())
                        .append(" | ").append(m.getMappingType() != null ? m.getMappingType() : "-")
                        .append(" | ").append(m.getDatasourceId())
                        .append(" |\n");
            }
            sb.append("\n");
        }

        List<ConceptJoinMapping> allJoinMappings = conceptJoinMappingRepository.findAll();
        if (!allJoinMappings.isEmpty()) {
            sb.append("## 已有表连接列表（避免重复创建）\n");
            sb.append("| 概念 | 连接表 | 连接条件 | 连接类型 | 目标概念 | 数据源ID |\n");
            sb.append("|------|--------|----------|----------|----------|----------|\n");
            for (ConceptJoinMapping j : allJoinMappings) {
                String cname = conceptRepository.findById(j.getConceptId()).map(Concept::getName).orElse("?");
                sb.append("| ").append(cname).append(" | ").append(j.getJoinTable())
                        .append(" | ").append(j.getJoinCondition())
                        .append(" | ").append(j.getRelationType() != null ? j.getRelationType() : "-")
                        .append(" | ").append(j.getTargetConcept() != null ? j.getTargetConcept() : "-")
                        .append(" | ").append(j.getDatasourceId())
                        .append(" |\n");
            }
            sb.append("\n");
        }
        return sb.toString();
    }

    private String buildMappingsForConcepts(List<String> conceptNames, String requestType) {
        StringBuilder sb = new StringBuilder();
        Set<Long> conceptIds = new HashSet<>();
        for (String name : conceptNames) {
            List<Concept> found = conceptRepository.findByName(name);
            for (Concept c : found) {
                conceptIds.add(c.getId());
            }
        }
        if (conceptIds.isEmpty()) {
            return "未找到指定概念的映射信息。";
        }
        boolean needMappings = "all".equals(requestType) || "mappings".equals(requestType);
        boolean needJoins = "all".equals(requestType) || "join_mappings".equals(requestType);
        if (needMappings) {
            List<ConceptMapping> mappings = conceptMappingRepository.findByConceptIdIn(new ArrayList<>(conceptIds));
            if (!mappings.isEmpty()) {
                sb.append("## 映射详情\n");
                sb.append("| 概念 | 表名 | 列名 | 映射类型 |\n");
                sb.append("|------|------|------|----------|\n");
                for (ConceptMapping m : mappings) {
                    String cname = conceptRepository.findById(m.getConceptId()).map(Concept::getName).orElse("?");
                    sb.append("| ").append(cname).append(" | ").append(m.getTableName())
                            .append(" | ").append(m.getColumnName())
                            .append(" | ").append(m.getMappingType() != null ? m.getMappingType() : "-").append(" |\n");
                }
                sb.append("\n");
            } else {
                sb.append("## 映射详情\n暂无映射。\n\n");
            }
        }
        if (needJoins) {
            List<ConceptJoinMapping> joins = conceptJoinMappingRepository.findByConceptIdIn(new ArrayList<>(conceptIds));
            if (!joins.isEmpty()) {
                sb.append("## 表连接详情\n");
                sb.append("| 概念 | 连接表 | 连接条件 | 连接类型 |\n");
                sb.append("|------|--------|----------|----------|\n");
                for (ConceptJoinMapping j : joins) {
                    String cname = conceptRepository.findById(j.getConceptId()).map(Concept::getName).orElse("?");
                    sb.append("| ").append(cname).append(" | ").append(j.getJoinTable())
                            .append(" | ").append(j.getJoinCondition())
                            .append(" | ").append(j.getRelationType() != null ? j.getRelationType() : "LEFT JOIN").append(" |\n");
                }
                sb.append("\n");
            } else {
                sb.append("## 表连接详情\n暂无表连接。\n\n");
            }
        }
        return sb.toString();
    }

    private String buildOntologyThinkingChain() {
        return "## 本体创建思维链（必须严格遵守）\n\n"
                + "请严格按照以下步骤逐条思考，每步验证通过后再进入下一步：\n\n"
                + "**第一步：解析用户需求**\n"
                + "- 用户提到的概念名是其需求描述，不是创建指令，必须与已有概念做语义等价判断后再决定新增还是复用\n"
                + "- 列出所有需要的概念（根概念、维度概念、关联概念）\n"
                + "- 列出所有需要的关系（下钻、关联）\n"
                + "- 列出所有需要的映射（概念→表字段）\n"
                + "- 列出所有需要的表连接\n\n"
                + "**第二步：检查已有概念、映射和表连接（必须执行，避免重复）**\n"
                + "- 逐一对照上方「已有概念列表」，判断是否已有语义相同的概念（简称/全称/同义表述均可能为同一概念），不要仅凭字面是否完全一致判断。注意：同一张物理表可能对应多个不同语义的概念（如订单和订单量），不能仅凭表名相同就合并\n"
                + "- 已存在的概念：使用 UPDATE_CONCEPT 更新描述/阈值，不要重复 ADD_CONCEPT。**必须带上已有概念的 id（从上方「已有概念列表」中获取），name 填写新名称**\n"
                + "- **名称不同时**：如果已有概念与用户需求语义相同但名称不同，直接用 UPDATE_CONCEPT 将名称改为用户指定的名称，不用纠结\n"
                + "- 判断原则：语义相同 = 同一个概念，名称只是标签，用户指定了更好的名称就更新名称\n"
                + "- 不存在的概念：加入待创建列表\n"
                + "- 逐一对照上方「已有映射列表」，相同概念+表名+列名的映射已存在则跳过，不要重复 ADD_MAPPING\n"
                + "- 逐一对照上方「已有表连接列表」，相同概念+连接表+连接条件的连接已存在则跳过，不要重复 ADD_JOIN_MAPPING\n\n"
                + "**第三步：选择行业和领域**\n"
                + "- 每个概念必须指定 industryId（从上方「可用行业」中选择，不能新建行业）\n"
                + "- 每个概念必须指定领域：优先使用已有领域（指定 groupId），如果现有领域不匹配可新建（指定 groupName 和 industryId）\n"
                + "- 新建领域时 groupName 填写领域显示名，系统会自动创建\n\n"
                + "**第四步：规划概念**\n"
                + "- 先创建根概念，再创建子概念\n"
                + "- 每个概念必须有 name、description\n"
                + "- 根概念可设置异常阈值（如 >5%）\n"
                + "- 父概念创建后，子概念才能引用\n\n"
                + "**第五步：规划关系**\n"
                + "- 下钻维度用 DRILLS_INTO\n"
                + "- 关联维度用 CORRELATED 或其他已注册的关系类型\n"
                + "- 每个关系必须有 sourceConceptName、targetConceptName、relationType\n\n"
                + "**第六步：规划映射**\n"
                + "- 每个概念需映射到数据库表字段\n"
                + "- **上方「数据源」章节已自动提供可用数据源和表结构，直接使用其中的数据源ID和表名**\n"
                + "- 映射时 dataSourceId 必须使用上方数据源表格中提供的 数据源ID\n"
                + "- 概念名映射到表名，columnName 是具体字段\n"
                + "- mappingType：direct（直接映射）、computed（计算字段）、derived（派生字段）。如果是计算值，没有直接的表字段对应，则用 computed 并写计算表达式。禁止将 computed 概念映射到不存在的列\n"
                + "- **对照上方「已有映射列表」，已存在的映射不要重复 ADD_MAPPING，直接跳过**\n\n"
                + "**第七步：规划表连接**\n"
                + "- 多表查询需 JOIN 条件\n"
                + "- leftTable=主表，rightTable=关联表，leftColumn/rightColumn=关联字段，joinType=LEFT/RIGHT/INNER\n"
                + "- **dataSourceId 必须使用上方数据源表格中提供的 数据源ID**\n"
                + "- **对照上方「已有表连接列表」，已存在的连接不要重复 ADD_JOIN_MAPPING，直接跳过**\n"
                + "- **JOIN 路径选择规则（按优先级）**：\n"
                + "  1. **业务优先**：维度表应连接到与它有直接业务语义关联的事实表。例如客诉率分析中，销售渠道和物流商是客诉维度的下级概念，应通过 complaints 表连接，不是 orders\n"
                + "  2. **字段优先**：同名列出现在多张表时，优先选约束为 NOT NULL 的列做 JOIN（NOT NULL 说明该表一定有数据，NULL 的列可能为空导致查询结果缺失）\n"
                + "  3. **全建原则**：如果多条路径的列都是 NOT NULL（或都有实际数据），则全部建立 JOIN 映射，查询时可根据需要选择不同路径\n\n"
                + "**第八步：自检清单**\n"
                + "- 逐一核对：概念是否完整？关系是否闭环？映射是否覆盖所有概念？\n"
                + "- 确认无重复创建（对照上方已有列表）\n"
                + "- 确认每个操作都有 reasoning 说明原因\n"
                + "确认变更数量合理（通常 15-25 条为正常范围，超过 40 条需检查是否有重复）\n\n";
    }

    private String executeTool(String toolName, Map<String, Object> arguments) {
        ToolDefinition tool = toolDefinitionRepository.findByName(toolName).orElse(null);
        if (tool == null) {
            return "{\"error\": \"Tool not found: " + toolName + "\"}";
        }
        try {
            String toolType = tool.getToolType();
            switch (toolType) {
                case "HTTP":
                    return httpExecutor.execute(tool, arguments, "agent");
                case "MCP_PASSTHROUGH":
                    return mcpExecutor.execute(tool, arguments);
                default:
                    return "{\"error\": \"Unsupported tool type: " + toolType + "\"}";
            }
        } catch (Exception e) {
            log.error("Tool execution failed: {}", toolName, e);
            return "{\"error\": \"" + e.getMessage() + "\"}";
        }
    }
}