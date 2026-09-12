package com.luban.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.AgentConfig;
import com.luban.repository.AgentConfigRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 统一的 chat-completion 客户端：默认 AgentConfig 解析、密钥解密、URL 归一、
 * 请求构造、响应解析与 ```json 围栏剥离。
 * 替代此前散落在 ConceptMappingService / ConceptFeedbackService / ConceptImportService
 * 的 5 份手写实现（各自 new ObjectMapper、重复解密与剥围栏逻辑）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LlmChatClient {

    private final AgentConfigRepository agentConfigRepository;
    private final AgentConfigService agentConfigService;
    private final ObjectMapper objectMapper;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    /**
     * @param temperature 采样温度，null 用服务端默认
     * @param maxTokens    输出 token 上限
     * @param jsonMode     是否带 response_format=json_object（仅部分模型支持）
     * @param timeout      请求超时
     */
    public record Options(Double temperature, Integer maxTokens, boolean jsonMode, Duration timeout) {

        public static Options of(double temperature, int maxTokens, Duration timeout) {
            return new Options(temperature, maxTokens, false, timeout);
        }
    }

    /**
     * 用默认 AgentConfig 调用，失败抛 RuntimeException（原 feedback 链路语义）。
     */
    public String chat(List<Map<String, Object>> messages, Options options) {
        AgentConfig config = agentConfigRepository.findByIsDefaultTrue().orElse(null);
        if (config == null) {
            throw new RuntimeException("未配置默认 Agent");
        }
        return chat(config, messages, options);
    }

    /**
     * 失败返回 null 并告警（auto-match / import 链路原语义）。
     */
    public String chatQuietly(List<Map<String, Object>> messages, Options options) {
        try {
            return chat(messages, options);
        } catch (Exception e) {
            log.warn("LLM 调用失败（容错返回 null）: {}", e.getMessage());
            return null;
        }
    }

    public String chat(AgentConfig config, List<Map<String, Object>> messages, Options options) {
        return chat(config, messages, options, false);
    }

    /**
     * @param allowReasoningFallback content 为空时回退读 reasoning_content
     *                               （推理模型在 content 中不回正文的情况，import 链路依赖此行为）
     */
    public String chat(AgentConfig config, List<Map<String, Object>> messages, Options options,
            boolean allowReasoningFallback) {
        try {
            String apiKey = agentConfigService.decrypt(config.getSecretKeyEnc());
            String chatUrl = agentConfigService.normalizeChatUrl(config.getModelEndpoint());

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", config.getModelName());
            body.put("messages", messages);
            if (options.temperature() != null) body.put("temperature", options.temperature());
            if (options.maxTokens() != null) body.put("max_tokens", options.maxTokens());
            if (options.jsonMode()) body.put("response_format", Map.of("type", "json_object"));

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(chatUrl))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + apiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                    .timeout(options.timeout() != null ? options.timeout() : Duration.ofSeconds(60))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                log.error("LLM API error: status={}, url={}, model={}, body={}",
                        response.statusCode(), chatUrl, config.getModelName(),
                        abbreviate(response.body()));
                throw new RuntimeException("LLM API 返回状态码: " + response.statusCode());
            }

            Map<String, Object> respBody = objectMapper.readValue(response.body(), Map.class);
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> choices = (List<Map<String, Object>>) respBody.get("choices");
            if (choices == null || choices.isEmpty()) {
                throw new RuntimeException("LLM API 响应缺少 choices");
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
            String content = (String) message.get("content");
            if ((content == null || content.isEmpty()) && allowReasoningFallback) {
                content = (String) message.get("reasoning_content");
            }
            if (content == null || content.isEmpty()) {
                throw new RuntimeException("LLM API 响应内容为空");
            }
            return stripFences(content);
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("LLM 调用失败: " + e.getMessage(), e);
        }
    }

    /** 剥离 ```json ... ``` 围栏与首尾空白 */
    public static String stripFences(String content) {
        String s = content.trim();
        if (s.startsWith("```")) {
            s = s.replaceAll("```json\\s*", "").replaceAll("```\\s*", "").trim();
        }
        return s;
    }

    private String abbreviate(String s) {
        if (s == null) return "";
        return s.length() > 500 ? s.substring(0, 500) + "..." : s;
    }
}
