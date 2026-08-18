package com.luban.executor;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.dto.RunQueryRequest;
import com.luban.dto.RunQueryResponse;
import com.luban.entity.ToolDefinition;
import com.luban.service.QueryService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Map;

@Component
public class SqlExecutor {

    private static final Logger log = LoggerFactory.getLogger(SqlExecutor.class);
    private static final int DEFAULT_MAX_ROWS = 1000;

    private final QueryService queryService;
    private final ObjectMapper objectMapper;

    public SqlExecutor(QueryService queryService, ObjectMapper objectMapper) {
        this.queryService = queryService;
        this.objectMapper = objectMapper;
    }

    public String execute(ToolDefinition tool, Map<String, Object> arguments) {
        try {
            Map<String, Object> config = objectMapper.readValue(tool.getConfig(), Map.class);
            Long queryId = config.containsKey("queryId") ? ((Number) config.get("queryId")).longValue() : null;
            Long datasourceId = config.containsKey("datasourceId") ? ((Number) config.get("datasourceId")).longValue() : null;
            String sql = (String) config.get("sql");
            int maxRows = config.containsKey("maxRows") ? ((Number) config.get("maxRows")).intValue() : DEFAULT_MAX_ROWS;

            if (sql != null && !sql.isEmpty()) {
                String upperSql = sql.trim().toUpperCase();
                if (!upperSql.startsWith("SELECT") && !upperSql.startsWith("SHOW")
                        && !upperSql.startsWith("DESCRIBE") && !upperSql.startsWith("DESC")
                        && !upperSql.startsWith("EXPLAIN") && !upperSql.startsWith("WITH")) {
                    return errorJson("SQL tool only supports read-only queries (SELECT)");
                }
            }

            RunQueryResponse result;
            if (queryId != null) {
                RunQueryRequest request = new RunQueryRequest();
                request.setParams(arguments);
                result = queryService.run(queryId, request);
            } else if (datasourceId != null && sql != null) {
                result = queryService.executeSql(datasourceId, sql);
            } else {
                return errorJson("SQL tool config requires queryId or (datasourceId + sql)");
            }

            if (result.getTotalCount() > maxRows) {
                return errorJson("Query returned " + result.getTotalCount() + " rows, exceeds limit of " + maxRows);
            }

            return objectMapper.writeValueAsString(result);
        } catch (Exception e) {
            log.error("SQL executor failed for tool: {}", tool.getName(), e);
            return errorJson("SQL execution failed: " + e.getMessage());
        }
    }

    private String errorJson(String message) {
        return "{\"error\": \"" + message.replace("\"", "\\\"") + "\"}";
    }
}