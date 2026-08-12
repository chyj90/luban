package com.luban.service;

import com.luban.dto.CreateDatasourceRequest;
import com.luban.dto.TestDatasourceResponse;
import com.luban.entity.Application;
import com.luban.entity.Datasource;
import com.luban.entity.User;
import com.luban.entity.Workspace;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.DatasourceRepository;
import com.luban.repository.WorkspaceRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.time.Duration;
import java.util.*;

import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class DatasourceService {

    private final DatasourceRepository datasourceRepository;
    private final ApplicationRepository applicationRepository;
    private final WorkspaceRepository workspaceRepository;
    private final ObjectMapper objectMapper;

    public DatasourceService(DatasourceRepository datasourceRepository,
                             ApplicationRepository applicationRepository,
                             WorkspaceRepository workspaceRepository,
                             ObjectMapper objectMapper) {
        this.datasourceRepository = datasourceRepository;
        this.applicationRepository = applicationRepository;
        this.workspaceRepository = workspaceRepository;
        this.objectMapper = objectMapper;
    }

    private void verifyApplicationOwnership(Long applicationId) {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof User user)) {
            throw new RuntimeException("未登录或无权访问");
        }
        Application app = applicationRepository.findById(applicationId)
                .orElseThrow(() -> new IllegalArgumentException("应用不存在"));
        Workspace workspace = workspaceRepository.findById(app.getWorkspaceId())
                .orElseThrow(() -> new IllegalArgumentException("工作区不存在"));
        if (!workspace.getOwnerId().equals(user.getId())) {
            throw new RuntimeException("无权访问该应用的数据源");
        }
    }

    public List<Map<String, Object>> listByApplication(Long applicationId) {
        verifyApplicationOwnership(applicationId);
        List<Datasource> datasources = datasourceRepository.findByApplicationId(applicationId);
        List<Map<String, Object>> result = new ArrayList<>();
        for (Datasource ds : datasources) {
            result.add(buildDatasourceMap(ds));
        }
        return result;
    }

    public Map<String, Object> create(CreateDatasourceRequest request) {
        verifyApplicationOwnership(request.getApplicationId());
        Datasource ds = new Datasource();
        ds.setApplicationId(request.getApplicationId());
        ds.setName(request.getName());
        ds.setType(request.getType());
        ds.setConfig(toJson(request.getConfig()));
        ds.setStatus("pending");
        ds = datasourceRepository.save(ds);
        return buildDatasourceMap(ds);
    }

    public TestDatasourceResponse test(Long id) {
        Datasource ds = datasourceRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("数据源不存在"));
        try {
            Map<String, Object> config = fromJsonMap(ds.getConfig());
            boolean ok = switch (ds.getType()) {
                case "MySQL", "PostgreSQL" -> testJdbc(ds.getType(), config);
                case "REST_API" -> testApi(config);
                default -> throw new IllegalArgumentException("不支持的数据源类型: " + ds.getType());
            };
            if (ok) {
                ds.setStatus("connected");
                datasourceRepository.save(ds);
                return new TestDatasourceResponse(true, "连接成功");
            } else {
                ds.setStatus("error");
                datasourceRepository.save(ds);
                return new TestDatasourceResponse(false, "连接失败");
            }
        } catch (Exception e) {
            ds.setStatus("error");
            datasourceRepository.save(ds);
            return new TestDatasourceResponse(false, "连接失败: " + e.getMessage());
        }
    }

    private boolean testJdbc(String type, Map<String, Object> config) {
        String url = buildJdbcUrl(type, config);
        try (Connection conn = DriverManager.getConnection(url,
                String.valueOf(config.get("username")),
                String.valueOf(config.get("password")))) {
            return conn.isValid(5);
        } catch (Exception e) {
            throw new RuntimeException(e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private boolean testApi(Map<String, Object> config) {
        String baseUrl = String.valueOf(config.get("baseUrl"));
        try (HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build()) {
            HttpRequest.Builder requestBuilder = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl))
                    .timeout(Duration.ofSeconds(10))
                    .GET();
            Map<String, Object> dsHeaders = (Map<String, Object>) config.get("headers");
            if (dsHeaders != null) {
                dsHeaders.forEach((k, v) -> requestBuilder.header(k, String.valueOf(v)));
            }
            HttpResponse<String> response = client.send(requestBuilder.build(), HttpResponse.BodyHandlers.ofString());
            return response.statusCode() >= 200 && response.statusCode() < 500;
        } catch (Exception e) {
            throw new RuntimeException("API 连接失败: " + e.getMessage());
        }
    }

    public Map<String, Object> getStructure(Long id) {
        Datasource ds = datasourceRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("数据源不存在"));
        Map<String, Object> config = fromJsonMap(ds.getConfig());

        return switch (ds.getType()) {
            case "MySQL", "PostgreSQL" -> getJdbcStructure(ds.getType(), config);
            case "REST_API" -> getApiStructure(config);
            default -> throw new IllegalArgumentException("不支持的数据源类型: " + ds.getType());
        };
    }

    private Map<String, Object> getJdbcStructure(String type, Map<String, Object> config) {
        List<Map<String, Object>> tables = new ArrayList<>();

        try {
            String url = buildJdbcUrl(type, config);
            try (Connection conn = DriverManager.getConnection(url,
                    String.valueOf(config.get("username")),
                    String.valueOf(config.get("password")))) {
                DatabaseMetaData meta = conn.getMetaData();
                String catalog = conn.getCatalog();
                try (ResultSet rs = meta.getTables(catalog, null, "%", new String[]{"TABLE"})) {
                    while (rs.next()) {
                        String tableName = rs.getString("TABLE_NAME");
                        List<Map<String, Object>> columns = new ArrayList<>();
                        try (ResultSet colRs = meta.getColumns(catalog, null, tableName, "%")) {
                            while (colRs.next()) {
                                Map<String, Object> col = new LinkedHashMap<>();
                                col.put("name", colRs.getString("COLUMN_NAME"));
                                col.put("type", colRs.getString("TYPE_NAME"));
                                col.put("nullable", colRs.getInt("NULLABLE") == DatabaseMetaData.columnNullable);
                                col.put("primaryKey", false);
                                columns.add(col);
                            }
                        }
                        Map<String, Object> table = new LinkedHashMap<>();
                        table.put("name", tableName);
                        table.put("columns", columns);
                        tables.add(table);
                    }
                }
            }
        } catch (Exception e) {
            throw new RuntimeException("获取数据库结构失败: " + e.getMessage());
        }

        return Map.of("tables", tables);
    }

    private Map<String, Object> getApiStructure(Map<String, Object> config) {
        String baseUrl = String.valueOf(config.get("baseUrl"));
        String method = String.valueOf(config.getOrDefault("method", "GET"));
        return Map.of("tables", List.of(
                Map.of("name", "API Endpoint",
                        "columns", List.of(
                                Map.of("name", "baseUrl", "type", baseUrl),
                                Map.of("name", "method", "type", method),
                                Map.of("name", "headers", "type", "Object"),
                                Map.of("name", "body", "type", "Object"),
                                Map.of("name", "queryParams", "type", "Object")
                        ))
        ));
    }

    public void delete(Long id) {
        datasourceRepository.deleteById(id);
    }

    public Map<String, Object> update(Long id, CreateDatasourceRequest request) {
        Datasource ds = datasourceRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("数据源不存在"));
        ds.setName(request.getName());
        ds.setType(request.getType());
        if (request.getConfig() != null) {
            ds.setConfig(toJson(request.getConfig()));
        }
        ds.setStatus("pending");
        ds = datasourceRepository.save(ds);
        return buildDatasourceMap(ds);
    }

    private Map<String, Object> buildDatasourceMap(Datasource ds) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", ds.getId());
        map.put("applicationId", ds.getApplicationId());
        map.put("name", ds.getName());
        map.put("type", ds.getType());
        Map<String, Object> config = fromJsonMap(ds.getConfig());
        config.remove("password");
        map.put("config", config);
        map.put("status", ds.getStatus());
        map.put("createdAt", ds.getCreatedAt());
        return map;
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
        } catch (JsonProcessingException e) {
            return "{}";
        }
    }

    private String buildJdbcUrl(String type, Map<String, Object> config) {
        String host = String.valueOf(config.get("host"));
        Object portObj = config.get("port");
        String port = portObj != null ? String.valueOf(portObj) : "3306";
        String database = String.valueOf(config.get("database"));
        return switch (type) {
            case "MySQL" -> "jdbc:mysql://" + host + ":" + port + "/" + database + "?useSSL=false&allowPublicKeyRetrieval=true";
            case "PostgreSQL" -> "jdbc:postgresql://" + host + ":" + port + "/" + database;
            default -> throw new IllegalArgumentException("不支持的数据源类型: " + type);
        };
    }
}