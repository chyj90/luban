package com.luban.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.AgentConfig;
import com.luban.entity.AgentQueryLog;
import com.luban.entity.ChatMessage;
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
import com.luban.repository.ConceptJoinMappingRepository;
import com.luban.repository.ConceptMappingRepository;
import com.luban.repository.ConceptRepository;
import com.luban.entity.ConceptRelation;
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
    private final OntologyGroupRepository ontologyGroupRepository;
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

    private static final int MAX_ITERATIONS = 10;
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(60);
    private static final Duration LLM_IDLE_TIMEOUT = Duration.ofSeconds(60);
    private static final Duration LLM_HARD_TIMEOUT = Duration.ofSeconds(300);

    private static final int MAX_CONCEPT_EXPAND = 20;
    private static final int MAX_CONCEPT_IDS = 6;
    private static final int MAX_API_TOOLS = 15;
    private static final int NL2SQL_TIMEOUT_SECONDS = 30;
    private static final int NL2SQL_MAX_ROWS = 1000;
    private static final int NL2SQL_MAX_RESULT_BYTES = 10 * 1024 * 1024;
    private static final int NL2SQL_MAX_RETRIES = 2;
    private static final double CONCEPT_INTERSECTION_THRESHOLD = 0.5;

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
                        OntologyGroupRepository ontologyGroupRepository) {
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
        this.ontologyGroupRepository = ontologyGroupRepository;
    }

    public Map<String, Object> chat(String sessionId, String userMessage, Long userId) {
        return chat(sessionId, userMessage, userId, null, null);
    }

    public Map<String, Object> chat(String sessionId, String userMessage, Long userId,
                                    java.util.function.Consumer<String> onProgress) {
        return chat(sessionId, userMessage, userId, onProgress, null);
    }

    public Map<String, Object> chat(String sessionId, String userMessage, Long userId,
                                    java.util.function.Consumer<String> onProgress,
                                    java.util.function.Consumer<String> onChunk) {
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

            Optional<AgentState> result;
            try {
                PROGRESS_CALLBACK.set(onProgress);
                STREAM_CALLBACK.set(onChunk);
                result = graph.invoke(initialState);
            } finally {
                PROGRESS_CALLBACK.remove();
                STREAM_CALLBACK.remove();
            }

            Map<String, Object> finalData = result.map(AgentState::data).orElse(Map.of());
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
            finalAnswer.put("iterations", finalData.getOrDefault("iteration", 0));
            finalAnswer.put("history", history);
            finalAnswer.put("conceptTrace", usedConceptTrace != null ? usedConceptTrace : finalData.getOrDefault("concept_trace", List.of()));
            finalAnswer.put("reasoning", finalData.getOrDefault("reasoning", ""));
            finalAnswer.put("nl2sql", finalData.getOrDefault("nl2sql", null));
            finalAnswer.put("queryResult", finalData.getOrDefault("query_result", null));
            finalAnswer.put("sqlExecCount", finalData.getOrDefault("sql_exec_count", 0));
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
        }
    }

    public void clearSession(String sessionId) {
        conversationHistories.remove(sessionId);
        compiledGraphs.remove(sessionId);
        try {
            chatMessageRepository.deleteBySessionId(sessionId);
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
                    .nl2sql(nl2sqlJson)
                    .build();
            chatMessageRepository.save(assistantMsg);
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
            List<Map<String, Object>> history = new ArrayList<>();
            for (ChatMessage msg : messages) {
                history.add(Map.of("role", msg.getRole(), "content", msg.getContent()));
            }
            return history;
        } catch (Exception e) {
            log.warn("Failed to load chat history from DB for session={}: {}", sessionId, e.getMessage());
            return null;
        }
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
        graph.addNode("final_answer", buildFinalAnswerNode());

        graph.addEdge("__START__", "agent");

        graph.addConditionalEdges("agent", buildRouterEdge(), Map.of(
                "tool_call", "tool_executor",
                "nl2sql", "nl2sql_executor",
                "final_answer", "final_answer",
                "continue", "agent"
        ));

        graph.addEdge("tool_executor", "agent");
        graph.addEdge("nl2sql_executor", "agent");

        graph.addEdge("final_answer", "__END__");

        return graph.compile();
    }

    private AsyncNodeAction<AgentState> buildAgentNode(AgentConfig config) {
        return (state) -> {
            Map<String, Object> data = new LinkedHashMap<>(state.data());
            int iteration = (int) data.getOrDefault("iteration", 0);
            int llmCallCount = (int) data.getOrDefault("llm_call_count", 0);
            data.put("llm_call_count", llmCallCount + 1);

            if (iteration >= MAX_ITERATIONS) {
                data.put("next_action", "final_answer");
                data.put("final_answer", "已达到最大迭代次数，请重试。");
                return CompletableFuture.completedFuture(data);
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> messages = (List<Map<String, Object>>) data.get("messages");
            String sessionId = (String) data.get("session_id");
            Long userId = data.get("user_id") instanceof Number ? ((Number) data.get("user_id")).longValue() : null;

            String userQuery = extractLatestUserQuery(messages);
            if (iteration == 0) {
                sendProgress("正在检索相关概念和数据库表...");
            }
            Map<String, Object> unifiedContext = buildUnifiedContext(sessionId, userQuery, messages, userId);

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> conceptTrace = (List<Map<String, Object>>) unifiedContext.get("conceptTrace");
            String unifiedPrompt = (String) unifiedContext.get("prompt");
            @SuppressWarnings("unchecked")
            List<Long> conceptIds = (List<Long>) unifiedContext.get("conceptIds");

            data.put("concept_trace", conceptTrace);
            data.put("concept_ids", conceptIds);

            long tLlm = System.currentTimeMillis();
            String llmResponse = callLlm(config, messages, unifiedPrompt);
            log.info("Agent iteration {}: LLM call completed in {}ms",
                    iteration, System.currentTimeMillis() - tLlm);
            data.put("last_llm_response", llmResponse);
            data.put("iteration", iteration + 1);

            Map<String, Object> parsed = parseResponse(llmResponse);
            String type = (String) parsed.get("type");
            log.info("Agent iteration {}: LLM decided type={}, preview={}",
                    iteration, type, llmResponse.length() > 200 ? llmResponse.substring(0, 200) : llmResponse);

            if ("final_answer".equals(type)) {
                String answer = (String) parsed.get("answer");
                String reasoning = (String) parsed.getOrDefault("reasoning", "");
                String prevReasoning = (String) data.getOrDefault("reasoning", "");
                data.put("next_action", "final_answer");
                data.put("final_answer", answer);
                data.put("reasoning", prevReasoning.isEmpty() ? reasoning : prevReasoning + "\n\n---\n\n" + reasoning);
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
                String reasoning = (String) parsed.getOrDefault("reasoning", "");
                String prevReasoning = (String) data.getOrDefault("reasoning", "");
                data.put("next_action", "tool_call");
                data.put("pending_tool_call", toolCall);
                data.put("reasoning", prevReasoning.isEmpty() ? reasoning : prevReasoning + "\n\n---\n\n" + reasoning);
                messages.add(Map.of("role", "assistant", "content", llmResponse));
            } else if ("nl2sql".equals(type)) {
                String sql = (String) parsed.get("sql");
                String reasoning = (String) parsed.getOrDefault("reasoning", "");
                String prevReasoning = (String) data.getOrDefault("reasoning", "");
                data.put("next_action", "nl2sql");
                data.put("pending_nl2sql", parsed);
                data.put("reasoning", prevReasoning.isEmpty() ? reasoning : prevReasoning + "\n\n---\n\n" + reasoning);
                messages.add(Map.of("role", "assistant", "content", llmResponse));
            } else {
                data.put("next_action", "final_answer");
                data.put("final_answer", llmResponse);
                messages.add(Map.of("role", "assistant", "content", llmResponse));
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

        String prompt = buildUnifiedContextPrompt(userQuery, conceptTrace, apiTools,
                tableMappings, joinMappings, authorizedConceptIds, groupNameMap);

        log.info("buildUnifiedContext TOTAL: {}ms, concepts={}, tools={}, tables={}",
                System.currentTimeMillis() - t0, conceptIds.size(), apiTools.size(), tableMappings.size());

        result.put("conceptIds", conceptIds.stream().distinct().collect(Collectors.toList()));
        result.put("conceptTrace", conceptTrace);
        result.put("apiTools", apiTools);
        result.put("tableMappings", tableMappings);
        result.put("joinMappings", joinMappings);
        result.put("prompt", prompt);
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

    private String buildUnifiedContextPrompt(String userQuery,
                                             List<Map<String, Object>> conceptTrace,
                                             List<ToolDefinition> apiTools,
                                             List<ConceptMapping> tableMappings,
                                             List<ConceptJoinMapping> joinMappings,
                                             Set<Long> authorizedConceptIds,
                                             Map<Long, String> groupNameMap) {
        StringBuilder sb = new StringBuilder();

        sb.append("## 用户问题\n");
        sb.append(userQuery).append("\n\n");

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
                        .append(" | ").append(authorized ? "✅ 可用" : "🔒 无权限")
                        .append(" |\n");
            }
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
        sb.append("**情况 3 - 信息不足**：如果匹配的概念无法回答用户问题，请直接告知用户需要补充哪些信息。\n\n");
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
        sb.append("   - 如有 JOIN 条件，请使用提供的 JOIN 条件\n");
        sb.append("   - 如果没有合适的表和字段，不要生成 SQL\n\n");
        sb.append("3. **直接回答**：如果无法通过工具或 SQL 回答，请直接回复：\n");
        sb.append("   ```json\n");
        sb.append("   {\"type\": \"final_answer\", \"reasoning\": \"你的推理过程\", \"answer\": \"你的回答\", \"concept_ids\": [匹配的概念ID列表]}\n");
        sb.append("   ```\n");
        sb.append("   - concept_ids 必须填写：从上方语义层匹配概念表格中，列出你认为回答此问题所涉及的概念ID\n");
        sb.append("## 回答规范\n\n");
        sb.append("当 SQL 查询成功返回结果后，在 final_answer 中必须遵守以下规范：\n");
        sb.append("- 在答案开头明确写出本次查询的具体条件，让用户能验证证据链\n");
        sb.append("- 如果结果以表格呈现，表格中必须包含与查询条件直接相关的字段，不能只展示 ID\n");
        sb.append("请务必严格按照上述 JSON 格式回复，不要添加额外文本。");

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
            data.put("sql_exec_count", sqlExecCount + 1);
            Long userId = data.get("user_id") instanceof Number
                    ? ((Number) data.get("user_id")).longValue() : null;
            log.info("NL2SQL executor #{}: executing SQL={}", sqlExecCount + 1, sql.length() > 200 ? sql.substring(0, 200) : sql);
            Map<String, Object> queryResult = executeNl2sql(sql, conceptIds, userId);
            data.put("query_result", queryResult);

            Boolean executed = (Boolean) queryResult.get("executed");
            int retryCount = (int) data.getOrDefault("nl2sql_retry_count", 0);
            String error = (String) queryResult.get("error");

            // 授权错误不重试：提示用户申请对应域的概念权限
            boolean isAuthError = error != null && error.contains("未授权");

            if (executed != null && !executed && retryCount < NL2SQL_MAX_RETRIES && !isAuthError) {
                data.put("nl2sql_retry_count", retryCount + 1);
                data.put("nl2sql_last_error", error);
                messages.add(Map.of("role", "tool", "content",
                        "SQL 验证失败: " + error + "。请根据错误信息修正 SQL 并重试（第 " + (retryCount + 1) + "/" + NL2SQL_MAX_RETRIES + " 次重试）。",
                        "tool_name", "nl2sql_executor"));
                data.put("next_action", "continue");
            } else {
                data.put("nl2sql_retry_count", 0);
                data.remove("nl2sql_last_error");
                if (isAuthError) {
                    // 授权错误：直接提示用户申请权限，不让 LLM 继续尝试
                    String authMsg = "SQL 执行失败: " + error + "。请申请对应域的概念查询权限后再试。";
                    messages.add(Map.of("role", "tool", "content", authMsg, "tool_name", "nl2sql_executor"));
                } else {
                    String resultSummary = formatNl2sqlResult(queryResult);
                    messages.add(Map.of("role", "tool", "content", resultSummary, "tool_name", "nl2sql_executor"));
                }
                data.put("next_action", "continue");
            }

            data.remove("pending_nl2sql");
            return CompletableFuture.completedFuture(data);
        };
    }

    private Map<String, Object> executeNl2sql(String sql, List<Long> conceptIds, Long userId) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sql", sql);

        if (conceptIds != null && !conceptIds.isEmpty() && userId != null) {
            try {
                Map<Long, Boolean> perms = roleConceptPermissionService.batchCheckQueryPermission(
                        userId, new ArrayList<>(conceptIds));
                List<Long> unauthorizedIds = conceptIds.stream()
                        .filter(id -> !perms.getOrDefault(id, true))
                        .collect(Collectors.toList());
                if (!unauthorizedIds.isEmpty()) {
                    List<String> unauthorizedNames = conceptRepository.findAllById(unauthorizedIds).stream()
                            .map(c -> c.getName()).collect(Collectors.toList());
                    result.put("executed", false);
                    result.put("error", "权限不足：以下概念未授权 —— " + String.join(", ", unauthorizedNames));
                    log.warn("NL2SQL permission denied: userId={}, unauthorized concepts={}", userId, unauthorizedNames);
                    return result;
                }
            } catch (Exception e) {
                log.error("NL2SQL permission check failed: {}", e.getMessage());
                result.put("executed", false);
                result.put("error", "权限校验失败: " + e.getMessage());
                return result;
            }
        }

        List<ConceptMapping> allowedMappings = new ArrayList<>();
        if (conceptIds != null && !conceptIds.isEmpty()) {
            for (Long conceptId : conceptIds) {
                allowedMappings.addAll(conceptMappingRepository.findByConceptId(conceptId));
            }
        }
        if (allowedMappings.isEmpty()) {
            List<String> tableNames = extractTableNames(sql);
            if (!tableNames.isEmpty()) {
                allowedMappings = conceptMappingRepository.findByTableNameIn(tableNames);
                log.info("NL2SQL: 从SQL提取表名 {} 匹配到 {} 条映射",
                        tableNames, allowedMappings.size());
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

                String limitedSql = sql;
                if (!sql.toUpperCase().contains("LIMIT")) {
                    limitedSql = sql + " LIMIT " + NL2SQL_MAX_ROWS;
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
            return "SQL 查询成功: " + sql + "\n结果: " + (data != null ? data.toString() : "无数据");
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

            String toolResult = executeTool(toolName, toolArgs);

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> messages = (List<Map<String, Object>>) data.get("messages");
            messages.add(Map.of("role", "tool", "content", toolResult, "tool_name", toolName));

            data.put("next_action", "continue");
            data.remove("pending_tool_call");

            return CompletableFuture.completedFuture(data);
        };
    }

    private AsyncNodeAction<AgentState> buildFinalAnswerNode() {
        return (state) -> {
            Map<String, Object> data = new LinkedHashMap<>(state.data());
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

    private String callLlm(AgentConfig config, List<Map<String, Object>> messages, String toolsPrompt) {
        java.util.function.Consumer<String> onChunk = STREAM_CALLBACK.get();
        int maxRetries = 3;
        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            try {
            List<Map<String, Object>> fullMessages = new ArrayList<>();
            fullMessages.add(Map.of("role", "system", "content", buildSystemPrompt()));

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
                                resultFuture.completeExceptionally(
                                        new RuntimeException("LLM streaming API 返回 " + response.statusCode()));
                                return;
                            }
                            resetIdleTimer.run();
                            StringBuilder fullContent = new StringBuilder();
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
                                            if (content != null) {
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
                            log.info("LLM streaming completed: total={}ms, contentLen={}", total, fullContent.length());
                            resultFuture.complete(fullContent.toString());
                        } catch (Exception e) {
                            resultFuture.completeExceptionally(e);
                        }
                    })
                    .exceptionally(ex -> {
                        resultFuture.completeExceptionally(ex);
                        return null;
                    });

            try {
                return resultFuture.join();
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

    private String buildSystemPrompt() {
        return "你是鲁班核心 Agent，一个企业数据查询助手。\n" +
                "你的职责是帮助用户查询企业数据。\n" +
                "请用中文回答。回答要简洁、准确、专业。\n\n" +
                "你有三种方式回答用户问题：\n" +
                "1. 调用 API 工具获取数据\n" +
                "2. 生成 SQL 查询数据库（仅限 SELECT）\n" +
                "3. 直接回答（如果无法通过工具或 SQL 回答）\n\n" +
                "请根据上下文信息选择最合适的方式，并在 reasoning 中说明你的推理过程。";
    }

    /**
     * 规范化 chat completions URL。
     * 如果已包含 /chat/completions 则直接使用，否则拼接 /v1/chat/completions。
     */
    private String normalizeChatUrl(String endpoint) {
        String url = endpoint.replaceAll("/+$", "");
        if (url.endsWith("/chat/completions")) {
            return url;
        }
        if (!url.endsWith("/v1")) {
            url += "/v1";
        }
        return url + "/chat/completions";
    }

    private Map<String, Object> parseResponse(String response) {
        try {
            String json = extractJson(response);
            return objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return Map.of("type", "final_answer", "answer", response);
        }
    }

    private String extractJson(String response) {
        response = response.trim();
        int start = response.indexOf('{');
        int end = response.lastIndexOf('}');
        if (start >= 0 && end > start) {
            String json = response.substring(start, end + 1);
            try {
                objectMapper.readValue(json, new TypeReference<Map<String, Object>>() {});
                return json;
            } catch (Exception e) {
                // 多个 JSON 对象拼接，取最后一个
                int lastStart = response.lastIndexOf('{');
                if (lastStart > start && lastStart < end) {
                    return response.substring(lastStart, end + 1);
                }
            }
        }
        return response;
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