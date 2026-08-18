package com.luban.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.AgentConfig;
import com.luban.entity.ToolDefinition;
import com.luban.entity.ToolGroup;
import com.luban.executor.HttpExecutor;
import com.luban.executor.McpExecutor;
import com.luban.executor.SqlExecutor;
import com.luban.repository.AgentConfigRepository;
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

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

@Slf4j
@Service
public class AgentService {

    private final AgentConfigRepository agentConfigRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final ToolGroupRepository toolGroupRepository;
    private final HttpExecutor httpExecutor;
    private final SqlExecutor sqlExecutor;
    private final McpExecutor mcpExecutor;
    private final ToolEmbeddingService toolEmbeddingService;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private final ConcurrentHashMap<String, List<Map<String, Object>>> conversationHistories = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompiledGraph<AgentState>> compiledGraphs = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Deque<Long>> rateLimitBuckets = new ConcurrentHashMap<>();
    private final AtomicInteger totalCallCount = new AtomicInteger(0);
    private final AtomicInteger totalToolCallCount = new AtomicInteger(0);

    private static final int MAX_ITERATIONS = 10;
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(60);

    @Value("${luban.agent.rate-limit.max-requests}")
    private int rateLimitMaxRequests;

    @Value("${luban.agent.rate-limit.window-minutes}")
    private int rateLimitWindowMinutes;

    public AgentService(AgentConfigRepository agentConfigRepository,
                        ToolDefinitionRepository toolDefinitionRepository,
                        ToolGroupRepository toolGroupRepository,
                        HttpExecutor httpExecutor,
                        SqlExecutor sqlExecutor,
                        McpExecutor mcpExecutor,
                        ToolEmbeddingService toolEmbeddingService) {
        this.agentConfigRepository = agentConfigRepository;
        this.toolDefinitionRepository = toolDefinitionRepository;
        this.toolGroupRepository = toolGroupRepository;
        this.httpExecutor = httpExecutor;
        this.sqlExecutor = sqlExecutor;
        this.mcpExecutor = mcpExecutor;
        this.toolEmbeddingService = toolEmbeddingService;
    }

    public Map<String, Object> chat(String sessionId, String userMessage) {
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

            Optional<AgentState> result = graph.invoke(initialState);

            Map<String, Object> finalData = result.map(AgentState::data).orElse(Map.of());
            llmCalls = (int) finalData.getOrDefault("llm_call_count", 0);
            toolCalls = (int) finalData.getOrDefault("tool_call_count", 0);

            Map<String, Object> finalAnswer = new LinkedHashMap<>();
            finalAnswer.put("answer", finalData.getOrDefault("final_answer", "处理完成"));
            finalAnswer.put("iterations", finalData.getOrDefault("iteration", 0));
            finalAnswer.put("history", history);

            long duration = System.currentTimeMillis() - startTime;
            totalCallCount.incrementAndGet();
            log.info("Agent call completed: session={}, duration={}ms, llmCalls={}, toolCalls={}, iterations={}",
                    rateLimitKey, duration, llmCalls, toolCalls, finalData.getOrDefault("iteration", 0));

            return finalAnswer;
        } catch (Exception e) {
            long duration = System.currentTimeMillis() - startTime;
            log.error("Agent execution failed: session={}, duration={}ms, error={}", rateLimitKey, duration, e.getMessage());
            Map<String, Object> errorResult = new LinkedHashMap<>();
            errorResult.put("answer", "处理请求时出错: " + e.getMessage());
            errorResult.put("error", true);
            return errorResult;
        }
    }

    public void clearSession(String sessionId) {
        conversationHistories.remove(sessionId);
        compiledGraphs.remove(sessionId);
    }

    public int getActiveSessionCount() {
        return conversationHistories.size();
    }

    public String executeToolByName(String toolName, Map<String, Object> arguments) {
        long startTime = System.currentTimeMillis();
        String result = executeTool(toolName, arguments);
        long duration = System.currentTimeMillis() - startTime;
        totalToolCallCount.incrementAndGet();
        log.info("Tool call: name={}, duration={}ms, success={}", toolName, duration, !result.contains("\"error\""));
        return result;
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
        graph.addNode("final_answer", buildFinalAnswerNode());

        graph.addEdge("__START__", "agent");

        graph.addConditionalEdges("agent", buildRouterEdge(), Map.of(
                "tool_call", "tool_executor",
                "final_answer", "final_answer",
                "continue", "agent"
        ));

        graph.addEdge("tool_executor", "agent");

        graph.addEdge("final_answer", "__END__");

        return graph.compile();
    }

    private AsyncNodeAction<AgentState> buildAgentNode(AgentConfig config) {
        return (state) -> {
            Map<String, Object> data = new LinkedHashMap<>(state.data());
            int iteration = (int) data.getOrDefault("iteration", 0);
            int tier = (int) data.getOrDefault("tier", 1);
            int llmCallCount = (int) data.getOrDefault("llm_call_count", 0);
            data.put("llm_call_count", llmCallCount + 1);

            if (iteration >= MAX_ITERATIONS) {
                data.put("next_action", "final_answer");
                data.put("final_answer", "已达到最大迭代次数，请重试。");
                return CompletableFuture.completedFuture(data);
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> messages = (List<Map<String, Object>>) data.get("messages");

            String toolPrompt = buildProgressiveToolsPrompt(tier, messages);
            String llmResponse = callLlm(config, messages, toolPrompt);
            data.put("last_llm_response", llmResponse);
            data.put("iteration", iteration + 1);

            Map<String, Object> parsed = parseResponse(llmResponse);
            String type = (String) parsed.get("type");

            if ("final_answer".equals(type)) {
                String answer = (String) parsed.get("answer");
                data.put("next_action", "final_answer");
                data.put("final_answer", answer);
                messages.add(Map.of("role", "assistant", "content", answer));
            } else if ("tool_call".equals(type)) {
                @SuppressWarnings("unchecked")
                Map<String, Object> toolCall = (Map<String, Object>) parsed.get("tool_call");
                data.put("next_action", "tool_call");
                data.put("pending_tool_call", toolCall);
                data.put("tier", Math.min(tier + 1, 3));
                messages.add(Map.of("role", "assistant", "content", llmResponse));
            } else if ("select_system".equals(type)) {
                @SuppressWarnings("unchecked")
                String selectedSystem = (String) parsed.get("system");
                data.put("selected_system", selectedSystem);
                data.put("tier", 2);
                data.put("next_action", "continue");
                messages.add(Map.of("role", "assistant", "content", "已选择系统: " + selectedSystem));
            } else {
                data.put("next_action", "final_answer");
                data.put("final_answer", llmResponse);
                messages.add(Map.of("role", "assistant", "content", llmResponse));
            }

            return CompletableFuture.completedFuture(data);
        };
    }

    private String buildProgressiveToolsPrompt(int tier, List<Map<String, Object>> messages) {
        switch (tier) {
            case 1: {
                List<ToolGroup> groups = toolGroupRepository.findByStatusOrderBySortOrderAsc("ENABLED");
                if (groups.isEmpty()) return "";
                StringBuilder sb = new StringBuilder();
                sb.append("可用系统：\n");
                for (ToolGroup g : groups) {
                    sb.append("- ").append(g.getCode()).append(": ").append(g.getName());
                    if (g.getSystemPromptHint() != null && !g.getSystemPromptHint().isEmpty()) {
                        sb.append(" (").append(g.getSystemPromptHint()).append(")");
                    }
                    sb.append("\n");
                }
                sb.append("请先选择要查询的系统，以 JSON 格式回复：\n");
                sb.append("{\"type\": \"select_system\", \"system\": \"系统编码\"}\n");
                sb.append("或者直接回答用户问题。");
                return sb.toString();
            }
            case 2: {
                String selectedSystem = extractSelectedSystem(messages);
                if (selectedSystem == null) {
                    return buildAllToolsJson();
                }
                ToolGroup group = toolGroupRepository.findByCode(selectedSystem).orElse(null);
                if (group == null) {
                    return buildAllToolsJson();
                }
                String userQuery = extractUserQuery(messages);
                List<ToolDefinition> topTools = toolEmbeddingService.search(group.getId(), userQuery, 5);
                if (topTools.isEmpty()) {
                    return "该系统暂无匹配的工具。请直接回答用户问题。";
                }
                return buildToolsJson(topTools);
            }
            case 3:
            default:
                return buildAllToolsJson();
        }
    }

    private String extractSelectedSystem(List<Map<String, Object>> messages) {
        for (int i = messages.size() - 1; i >= 0; i--) {
            Map<String, Object> msg = messages.get(i);
            String content = (String) msg.get("content");
            if (content != null && content.startsWith("已选择系统: ")) {
                return content.substring("已选择系统: ".length()).trim();
            }
        }
        return null;
    }

    private String extractUserQuery(List<Map<String, Object>> messages) {
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

    private String buildToolsForSystem(String systemCode) {
        ToolGroup group = toolGroupRepository.findByCode(systemCode).orElse(null);
        if (group == null) {
            return buildAllToolsJson();
        }
        List<ToolDefinition> tools = toolDefinitionRepository.findByGroupIdAndStatus(group.getId(), "ENABLED");
        if (tools.isEmpty()) {
            return "该系统暂无可用工具。请直接回答用户问题。";
        }
        return buildToolsJson(tools);
    }

    private String buildAllToolsJson() {
        List<ToolDefinition> tools = toolDefinitionRepository.findByStatus("ENABLED");
        return buildToolsJson(tools);
    }

    private String buildToolsJson(List<ToolDefinition> tools) {
        if (tools.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < tools.size(); i++) {
            ToolDefinition tool = tools.get(i);
            sb.append("{\"name\":\"").append(tool.getName())
                    .append("\",\"description\":\"").append(tool.getDescription())
                    .append("\",\"input_schema\":")
                    .append(tool.getInputSchema() != null ? tool.getInputSchema() : "{}")
                    .append("}");
            if (i < tools.size() - 1) sb.append(",");
        }
        sb.append("]");
        return sb.toString();
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
        try {
            List<Map<String, Object>> fullMessages = new ArrayList<>();
            fullMessages.add(Map.of("role", "system", "content", buildSystemPrompt()));

            if (toolsPrompt != null && !toolsPrompt.isEmpty()) {
                fullMessages.add(Map.of("role", "system", "content",
                        toolsPrompt + "\n当需要使用工具时，请以 JSON 格式回复：\n" +
                        "{\"type\": \"tool_call\", \"tool_call\": {\"name\": \"工具名\", \"arguments\": {...}}}\n" +
                        "当可以给出最终答案时，请以 JSON 格式回复：\n" +
                        "{\"type\": \"final_answer\", \"answer\": \"你的回答\"}\n" +
                        "请务必严格按照上述 JSON 格式回复，不要添加额外文本。"));
            } else {
                fullMessages.add(Map.of("role", "system", "content", "请直接回答用户的问题。"));
            }

            fullMessages.addAll(messages);

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", config.getModelName());
            body.put("messages", fullMessages);
            body.put("temperature", 0.3);
            body.put("max_tokens", 4096);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(config.getModelEndpoint()))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + config.getSecretKeyEnc())
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                    .timeout(REQUEST_TIMEOUT)
                    .build();

            int retries = 3;
            for (int attempt = 0; attempt < retries; attempt++) {
                try {
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
                    if (attempt < retries - 1) {
                        long waitMs = (long) Math.pow(2, attempt) * 1000;
                        Thread.sleep(waitMs);
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw e;
                }
            }
            throw new RuntimeException("LLM API 调用失败，已重试 " + retries + " 次");
        } catch (Exception e) {
            log.error("LLM call failed", e);
            throw new RuntimeException("LLM 调用失败: " + e.getMessage());
        }
    }

    private String buildSystemPrompt() {
        return "你是鲁班核心 Agent，一个企业数据查询助手。\n" +
                "你的职责是帮助用户查询企业数据，通过调用工具获取信息。\n" +
                "请用中文回答。回答要简洁、准确、专业。\n" +
                "对于数据查询，请给出具体的数字和结论。";
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
            return response.substring(start, end + 1);
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
                case "SQL":
                    return sqlExecutor.execute(tool, arguments);
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