package com.luban.service;

import com.luban.dto.CreateQueryRequest;
import com.luban.dto.RunQueryRequest;
import com.luban.dto.RunQueryResponse;
import com.luban.dto.UpdateQueryRequest;
import com.luban.entity.Datasource;
import com.luban.entity.Query;
import com.luban.entity.User;
import com.luban.repository.DatasourceRepository;
import com.luban.repository.QueryRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.util.stream.Collectors;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.*;
import java.time.Duration;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import ognl.Ognl;
import ognl.OgnlContext;

@Service
public class QueryService {

    private final QueryRepository queryRepository;
    private final DatasourceRepository datasourceRepository;
    private final ObjectMapper objectMapper;

    public QueryService(QueryRepository queryRepository,
                        DatasourceRepository datasourceRepository,
                        ObjectMapper objectMapper) {
        this.queryRepository = queryRepository;
        this.datasourceRepository = datasourceRepository;
        this.objectMapper = objectMapper;
    }

    public List<Map<String, Object>> listByApplication(Long applicationId) {
        List<Query> queries = queryRepository.findByApplicationId(applicationId);
        List<Map<String, Object>> result = new ArrayList<>();
        for (Query q : queries) {
            result.add(buildQueryMap(q));
        }
        return result;
    }

    public Map<String, Object> create(CreateQueryRequest request) {
        Query query = new Query();
        query.setApplicationId(request.getApplicationId());
        query.setDatasourceId(request.getDatasourceId());
        query.setName(request.getName());
        query.setBody(request.getBody());
        query.setParams(toJson(request.getParams()));
        query = queryRepository.save(query);
        return buildQueryMap(query);
    }

    public Map<String, Object> update(Long id, UpdateQueryRequest request) {
        Query query = queryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("查询不存在"));
        if (request.getName() != null) query.setName(request.getName());
        if (request.getBody() != null) query.setBody(request.getBody());
        if (request.getParams() != null) query.setParams(toJson(request.getParams()));
        query = queryRepository.save(query);
        return buildQueryMap(query);
    }

    public void delete(Long id) {
        queryRepository.deleteById(id);
    }

    @SuppressWarnings("unchecked")
    public RunQueryResponse run(Long id, RunQueryRequest request) {
        Query query = queryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("查询不存在"));
        Datasource ds = datasourceRepository.findById(query.getDatasourceId())
                .orElseThrow(() -> new IllegalArgumentException("数据源不存在"));

        Map<String, Object> mergedParams = new HashMap<>();
        Map<String, Object> defaultParams = fromJsonMap(query.getParams());
        if (defaultParams != null) mergedParams.putAll(defaultParams);
        if (request.getParams() != null) mergedParams.putAll(request.getParams());

        Map<String, Object> authParams = new HashMap<>();
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof User user) {
            authParams.put("userId", user.getId());
            authParams.put("userName", user.getName());
            authParams.put("userEmail", user.getEmail());
        }

        String finalBody = resolveTemplate(query.getBody(), mergedParams, authParams);
        Map<String, Object> config = fromJsonMap(ds.getConfig());

        return switch (ds.getType()) {
            case "MySQL", "PostgreSQL" -> runJdbcQuery(ds.getType(), config, finalBody);
            case "REST_API" -> runRestApiQuery(config, finalBody, mergedParams);
            default -> throw new IllegalArgumentException("不支持的数据源类型: " + ds.getType());
        };
    }

    private RunQueryResponse runJdbcQuery(String type, Map<String, Object> config, String sql) {
        String url = buildJdbcUrl(type, config);
        long startTime = System.currentTimeMillis();

        String trimmedSql = sql.trim();
        String upperSql = trimmedSql.toUpperCase();

        boolean isQuery = upperSql.startsWith("SELECT")
                || upperSql.startsWith("SHOW")
                || upperSql.startsWith("DESCRIBE")
                || upperSql.startsWith("DESC")
                || upperSql.startsWith("EXPLAIN")
                || upperSql.startsWith("WITH");

        try (Connection conn = DriverManager.getConnection(url,
                String.valueOf(config.get("username")),
                String.valueOf(config.get("password")));
             Statement stmt = conn.createStatement()) {

            if (isQuery) {
                try (ResultSet rs = stmt.executeQuery(trimmedSql)) {
                    ResultSetMetaData meta = rs.getMetaData();
                    int colCount = meta.getColumnCount();

                    List<String> columns = new ArrayList<>();
                    for (int i = 1; i <= colCount; i++) {
                        columns.add(meta.getColumnName(i));
                    }

                    List<List<Object>> rows = new ArrayList<>();
                    while (rs.next()) {
                        List<Object> row = new ArrayList<>();
                        for (int i = 1; i <= colCount; i++) {
                            row.add(rs.getObject(i));
                        }
                        rows.add(row);
                    }

                    long executionTime = System.currentTimeMillis() - startTime;
                    return new RunQueryResponse(columns, rows, rows.size(), executionTime);
                }
            } else {
                int affectedRows = stmt.executeUpdate(trimmedSql);
                long executionTime = System.currentTimeMillis() - startTime;
                return new RunQueryResponse(Collections.emptyList(), Collections.emptyList(), affectedRows, executionTime);
            }
        } catch (Exception e) {
            throw new RuntimeException("SQL 查询执行失败: " + e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private RunQueryResponse runRestApiQuery(Map<String, Object> config, String body, Map<String, Object> params) {
        long startTime = System.currentTimeMillis();
        try {
            String baseUrl = String.valueOf(config.get("baseUrl"));
            String method = String.valueOf(config.getOrDefault("method", "GET")).toUpperCase();
            String endpoint = body != null && !body.isEmpty() ? body : String.valueOf(config.getOrDefault("endpoint", ""));

            String fullUrl = baseUrl;
            if (endpoint != null && !endpoint.isEmpty()) {
                fullUrl = baseUrl.endsWith("/") ? baseUrl + endpoint : baseUrl + "/" + endpoint;
            }
            if (endpoint != null && endpoint.startsWith("/")) {
                fullUrl = baseUrl.endsWith("/") ? baseUrl + endpoint.substring(1) : baseUrl + endpoint;
            }

            if (endpoint != null && endpoint.startsWith("http")) {
                fullUrl = endpoint;
            }

            HttpRequest.Builder requestBuilder = HttpRequest.newBuilder()
                    .uri(URI.create(fullUrl))
                    .timeout(Duration.ofSeconds(30));

            Map<String, Object> dsHeaders = (Map<String, Object>) config.get("headers");
            if (dsHeaders != null) {
                dsHeaders.forEach((k, v) -> requestBuilder.header(k, String.valueOf(v)));
            }

            String requestBody = null;
            Map<String, Object> queryParams = new HashMap<>();

            if (params.containsKey("queryParams") && params.get("queryParams") instanceof Map) {
                queryParams = (Map<String, Object>) params.get("queryParams");
            }
            if (params.containsKey("headers") && params.get("headers") instanceof Map) {
                Map<String, Object> extraHeaders = (Map<String, Object>) params.get("headers");
                extraHeaders.forEach((k, v) -> requestBuilder.header(k, String.valueOf(v)));
            }
            if (params.containsKey("body")) {
                requestBody = toJson(params.get("body"));
            }

            if (!queryParams.isEmpty() && !fullUrl.contains("?")) {
                StringBuilder qs = new StringBuilder("?");
                queryParams.forEach((k, v) -> qs.append(k).append("=").append(v).append("&"));
                fullUrl = fullUrl + qs.substring(0, qs.length() - 1);
                requestBuilder.uri(URI.create(fullUrl));
            }

            switch (method) {
                case "GET" -> requestBuilder.GET();
                case "DELETE" -> requestBuilder.DELETE();
                case "POST", "PUT", "PATCH" -> {
                    String payload = requestBody != null ? requestBody : "{}";
                    requestBuilder.method(method, HttpRequest.BodyPublishers.ofString(payload));
                    requestBuilder.header("Content-Type", "application/json");
                }
                default -> requestBuilder.GET();
            }

            try (HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(10))
                    .build()) {

                HttpResponse<String> response = client.send(requestBuilder.build(), HttpResponse.BodyHandlers.ofString());

                long executionTime = System.currentTimeMillis() - startTime;

                try {
                    Map<String, Object> responseMap = objectMapper.readValue(response.body(),
                            new TypeReference<Map<String, Object>>() {});
                    List<String> columns = new ArrayList<>(responseMap.keySet());
                    List<List<Object>> rows = new ArrayList<>();
                    rows.add(new ArrayList<>(responseMap.values()));
                    return new RunQueryResponse(columns, rows, 1, executionTime);
                } catch (Exception e) {
                    try {
                        List<Map<String, Object>> list = objectMapper.readValue(response.body(),
                                new TypeReference<List<Map<String, Object>>>() {});
                        List<String> columns = list.isEmpty() ? List.of("result") : new ArrayList<>(list.get(0).keySet());
                        List<List<Object>> rows = list.stream()
                                .map(m -> columns.stream().map(m::get).toList())
                                .collect(Collectors.toList());
                        return new RunQueryResponse(columns, new ArrayList<>(rows), rows.size(), executionTime);
                    } catch (Exception e2) {
                        return new RunQueryResponse(
                                List.of("status", "body"),
                                List.of(List.of(response.statusCode(), response.body())),
                                1, executionTime);
                    }
                }
            }

        } catch (Exception e) {
            throw new RuntimeException("REST API 调用失败: " + e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> fromJsonMap(String json) {
        if (json == null || json.isEmpty()) return Map.of();
        try {
            return objectMapper.readValue(json, Map.class);
        } catch (Exception e) {
            return Map.of();
        }
    }

    private String toJson(Object obj) {
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (Exception e) {
            return "{}";
        }
    }

    private String resolveTemplate(String body, Map<String, Object> params, Map<String, Object> authParams) {
        if (body == null) return "";
        String resolved = resolveDynamicTags(body, params);
        resolved = resolveAuthVariables(resolved, authParams);
        return resolveVariables(resolved, params);
    }

    // ── 动态 SQL 标签解析 ────────────────────────────────────────

    private String resolveDynamicTags(String body, Map<String, Object> params) {
        String result = body;
        int maxIterations = 30;
        for (int i = 0; i < maxIterations; i++) {
            String processed = resolveInnermostTag(result, params);
            if (processed.equals(result)) break;
            result = processed;
        }
        return result;
    }

    private String resolveInnermostTag(String body, Map<String, Object> params) {
        String inner = "(?:(?!<(?:if|foreach|where|set)[\\s>]).)*?";

        // <if test="...">content</if>
        Pattern ifPattern = Pattern.compile(
            "<if\\s+test=\"([^\"]+)\">(" + inner + ")</if>",
            Pattern.DOTALL | Pattern.CASE_INSENSITIVE
        );
        Matcher m = ifPattern.matcher(body);
        if (m.find()) {
            String condition = m.group(1).trim();
            String content = m.group(2);
            String replacement = evaluateCondition(condition, params) ? content : "";
            StringBuffer sb = new StringBuffer();
            m.appendReplacement(sb, Matcher.quoteReplacement(replacement));
            m.appendTail(sb);
            return sb.toString();
        }

        // <foreach collection="..." item="..." open="..." separator="..." close="...">content</foreach>
        Pattern foreachPattern = Pattern.compile(
            "<foreach\\s+([^>]+)>(" + inner + ")</foreach>",
            Pattern.DOTALL | Pattern.CASE_INSENSITIVE
        );
        m = foreachPattern.matcher(body);
        if (m.find()) {
            String attrsStr = m.group(1).trim();
            String content = m.group(2);
            Map<String, String> attrs = parseAttributes(attrsStr);
            String replacement = resolveForeach(content, attrs, params);
            StringBuffer sb = new StringBuffer();
            m.appendReplacement(sb, Matcher.quoteReplacement(replacement));
            m.appendTail(sb);
            return sb.toString();
        }

        // <where>content</where>
        Pattern wherePattern = Pattern.compile(
            "<where>(" + inner + ")</where>",
            Pattern.DOTALL | Pattern.CASE_INSENSITIVE
        );
        m = wherePattern.matcher(body);
        if (m.find()) {
            String content = m.group(1).trim();
            String replacement = resolveWhere(content);
            StringBuffer sb = new StringBuffer();
            m.appendReplacement(sb, Matcher.quoteReplacement(replacement));
            m.appendTail(sb);
            return sb.toString();
        }

        // <set>content</set>
        Pattern setPattern = Pattern.compile(
            "<set>(" + inner + ")</set>",
            Pattern.DOTALL | Pattern.CASE_INSENSITIVE
        );
        m = setPattern.matcher(body);
        if (m.find()) {
            String content = m.group(1).trim();
            String replacement = resolveSet(content);
            StringBuffer sb = new StringBuffer();
            m.appendReplacement(sb, Matcher.quoteReplacement(replacement));
            m.appendTail(sb);
            return sb.toString();
        }

        return body;
    }

    private boolean evaluateCondition(String condition, Map<String, Object> params) {
        try {
            OgnlContext ctx = new OgnlContext(null, null, null);
            ctx.setValues(params);
            Object result = Ognl.getValue(Ognl.parseExpression(condition), ctx, params);
            return result instanceof Boolean ? (Boolean) result : false;
        } catch (Exception e) {
            return false;
        }
    }

    private String resolveWhere(String content) {
        if (content.isEmpty()) return "";
        content = content.replaceFirst("^(?i)(AND|OR)\\s+", "");
        if (content.isEmpty()) return "";
        return "WHERE " + content;
    }

    private String resolveSet(String content) {
        if (content.isEmpty()) return "";
        content = content.replaceFirst(",\\s*$", "");
        if (content.isEmpty()) return "";
        return "SET " + content;
    }

    private String resolveForeach(String content, Map<String, String> attrs, Map<String, Object> params) {
        String collection = attrs.getOrDefault("collection", "");
        String item = attrs.getOrDefault("item", "item");
        String open = attrs.getOrDefault("open", "");
        String separator = attrs.getOrDefault("separator", ",");
        String close = attrs.getOrDefault("close", "");

        Object col = params.get(collection);
        if (col == null || !(col instanceof List)) return "";
        List<?> list = (List<?>) col;
        if (list.isEmpty()) return "";

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < list.size(); i++) {
            if (i > 0) sb.append(separator);
            Object val = list.get(i);
            String part = content.replace("{{ this.params." + item + " }}", formatSqlValue(val));
            sb.append(part);
        }
        return open + sb + close;
    }

    private Map<String, String> parseAttributes(String attrs) {
        Map<String, String> map = new LinkedHashMap<>();
        Pattern p = Pattern.compile("(\\w+)=\"([^\"]*)\"");
        Matcher m = p.matcher(attrs);
        while (m.find()) {
            map.put(m.group(1), m.group(2));
        }
        return map;
    }

    // ── 变量替换 ────────────────────────────────────────────────

    private String resolveAuthVariables(String body, Map<String, Object> authParams) {
        if (authParams == null || authParams.isEmpty()) return body;
        Pattern pattern = Pattern.compile("\\{\\{\\s*this\\.auth\\.(\\w+)\\s*\\}\\}");
        Matcher matcher = pattern.matcher(body);
        StringBuilder sb = new StringBuilder();
        while (matcher.find()) {
            String key = matcher.group(1);
            Object value = authParams.get(key);
            String replacement = value != null ? formatSqlValue(value) : "NULL";
            matcher.appendReplacement(sb, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(sb);
        return sb.toString();
    }

    private String resolveVariables(String body, Map<String, Object> params) {
        Pattern pattern = Pattern.compile("\\{\\{\\s*this\\.params\\.(\\w+)\\s*\\}\\}");
        Matcher matcher = pattern.matcher(body);
        StringBuilder sb = new StringBuilder();
        while (matcher.find()) {
            String key = matcher.group(1);
            Object value = params.get(key);
            String replacement = value != null ? formatSqlValue(value) : "NULL";
            matcher.appendReplacement(sb, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(sb);
        return sb.toString();
    }

    private String formatSqlValue(Object value) {
        if (value instanceof Number) return value.toString();
        if (value instanceof Boolean) return ((Boolean) value) ? "1" : "0";
        return value.toString().replace("'", "''");
    }

    private String buildJdbcUrl(String type, Map<String, Object> config) {
        String host = String.valueOf(config.get("host"));
        String port = String.valueOf(config.getOrDefault("port", "3306"));
        String database = String.valueOf(config.get("database"));
        return switch (type) {
            case "MySQL" -> "jdbc:mysql://" + host + ":" + port + "/" + database + "?useSSL=false&allowPublicKeyRetrieval=true";
            case "PostgreSQL" -> "jdbc:postgresql://" + host + ":" + port + "/" + database;
            default -> throw new IllegalArgumentException("不支持的数据源类型: " + type);
        };
    }

    private Map<String, Object> buildQueryMap(Query q) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", q.getId());
        map.put("applicationId", q.getApplicationId());
        map.put("datasourceId", q.getDatasourceId());
        map.put("name", q.getName());
        map.put("body", q.getBody());
        map.put("params", fromJsonMap(q.getParams()));
        map.put("createdAt", q.getCreatedAt());
        return map;
    }
}