package com.luban.service;

import com.luban.dto.CreateDatasourceRequest;
import com.luban.dto.TestDatasourceResponse;
import com.luban.entity.Application;
import com.luban.entity.Datasource;
import com.luban.entity.User;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.DatasourceRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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
import java.sql.Statement;
import java.time.Duration;
import java.util.*;

import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Service
@Transactional
public class DatasourceService {

    private final DatasourceRepository datasourceRepository;
    private final ApplicationRepository applicationRepository;
    private final ObjectMapper objectMapper;

    public DatasourceService(DatasourceRepository datasourceRepository,
                             ApplicationRepository applicationRepository,
                             ObjectMapper objectMapper) {
        this.datasourceRepository = datasourceRepository;
        this.applicationRepository = applicationRepository;
        this.objectMapper = objectMapper;
    }

    private void verifyApplicationOwnership(Long applicationId) {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof User user)) {
            throw new RuntimeException("未登录或无权访问");
        }
        Application app = applicationRepository.findById(applicationId)
                .orElseThrow(() -> new IllegalArgumentException("应用不存在"));
        if (!app.getCreatedBy().equals(user.getId())) {
            throw new RuntimeException("无权访问该应用的数据源");
        }
    }

    public List<Map<String, Object>> listBySlug(String slug, Long ownerId) {
        if ("APPLICATION".equals(slug) && ownerId != null) {
            verifyApplicationOwnership(ownerId);
        }
        List<Datasource> datasources = ownerId != null
                ? datasourceRepository.findBySlugAndOwnerId(slug, ownerId)
                : datasourceRepository.findBySlug(slug);
        return buildDatasourceList(datasources);
    }

    private List<Map<String, Object>> buildDatasourceList(List<Datasource> datasources) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Datasource ds : datasources) {
            result.add(buildDatasourceMap(ds));
        }
        return result;
    }

    public Map<String, Object> create(CreateDatasourceRequest request) {
        if ("APPLICATION".equals(request.getSlug()) && request.getOwnerId() != null) {
            verifyApplicationOwnership(request.getOwnerId());
        }
        Datasource ds = new Datasource();
        ds.setOwnerId(request.getOwnerId());
        ds.setSlug(request.getSlug());
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
            boolean ok = switch (ds.getType().toLowerCase()) {
                case "mysql", "postgresql" -> testJdbc(ds.getType(), config);
                case "rest_api" -> testApi(config);
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

        return switch (ds.getType().toLowerCase()) {
            case "mysql", "postgresql" -> getJdbcStructure(ds.getType(), config);
            case "rest_api" -> getApiStructure(config);
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
                                String remarks = colRs.getString("REMARKS");
                                col.put("comment", remarks != null && !remarks.isEmpty() ? remarks : "");
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

    public Set<String> queryDistinctValues(Long datasourceId, String tableName, String columnName) {
        Datasource ds = datasourceRepository.findById(datasourceId)
                .orElseThrow(() -> new IllegalArgumentException("数据源不存在"));
        Map<String, Object> config = fromJsonMap(ds.getConfig());
        String type = ds.getType().toLowerCase();

        if (!"mysql".equals(type) && !"postgresql".equals(type)) {
            return Set.of();
        }

        String url = buildJdbcUrl(type, config);
        String sql = "SELECT DISTINCT " + columnName + " FROM " + tableName + " LIMIT 1000";
        Set<String> values = new HashSet<>();
        try (Connection conn = DriverManager.getConnection(url,
                String.valueOf(config.get("username")),
                String.valueOf(config.get("password")));
             Statement stmt = conn.createStatement()) {
            stmt.setQueryTimeout(10);
            try (ResultSet rs = stmt.executeQuery(sql)) {
                while (rs.next()) {
                    String val = rs.getString(1);
                    if (val != null) {
                        values.add(val);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("queryDistinctValues failed: datasourceId={}, table={}, column={}, error={}",
                    datasourceId, tableName, columnName, e.getMessage());
        }
        return values;
    }

    public Datasource getById(Long id) {
        return datasourceRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("数据源不存在: " + id));
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
        map.put("ownerId", ds.getOwnerId());
        map.put("slug", ds.getSlug());
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
    public Map<String, Object> fromJsonMap(String json) {
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

    public String buildJdbcUrl(String type, Map<String, Object> config) {
        if (config.containsKey("jdbcUrl") && config.get("jdbcUrl") != null) {
            return String.valueOf(config.get("jdbcUrl"));
        }
        String host = String.valueOf(config.get("host"));
        Object portObj = config.get("port");
        String port = portObj != null ? String.valueOf(portObj) : "3306";
        String database = String.valueOf(config.get("database"));
        return switch (type.toLowerCase()) {
            case "mysql" -> "jdbc:mysql://" + host + ":" + port + "/" + database + "?useSSL=false&allowPublicKeyRetrieval=true";
            case "postgresql" -> "jdbc:postgresql://" + host + ":" + port + "/" + database;
            default -> throw new IllegalArgumentException("不支持的数据源类型: " + type);
        };
    }

    public List<Map<String, Object>> getAvailableDatasources() {
        List<Datasource> all = datasourceRepository.findAll();
        List<Map<String, Object>> result = new ArrayList<>();
        for (Datasource ds : all) {
            Map<String, Object> info = new LinkedHashMap<>();
            info.put("id", ds.getId());
            info.put("name", ds.getName());
            info.put("type", ds.getType());
            info.put("slug", ds.getSlug());
            try {
                Map<String, Object> structure = getStructure(ds.getId());
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> tables = (List<Map<String, Object>>) structure.get("tables");
                if (tables != null) {
                    List<Map<String, Object>> simplified = new ArrayList<>();
                    for (Map<String, Object> table : tables) {
                        Map<String, Object> t = new LinkedHashMap<>();
                        t.put("name", table.get("name"));
                        @SuppressWarnings("unchecked")
                        List<Map<String, Object>> columns = (List<Map<String, Object>>) table.get("columns");
                        if (columns != null) {
                            List<Map<String, Object>> cols = new ArrayList<>();
                            for (Map<String, Object> col : columns) {
                                Map<String, Object> c = new LinkedHashMap<>();
                                c.put("name", col.get("name"));
                                c.put("type", col.getOrDefault("type", "UNKNOWN"));
                                c.put("nullable", col.getOrDefault("nullable", true));
                                c.put("comment", col.getOrDefault("comment", ""));
                                cols.add(c);
                            }
                            t.put("columns", cols);
                        }
                        simplified.add(t);
                    }
                    info.put("tables", simplified);
                }
            } catch (Exception e) {
                log.warn("获取数据源 {} 结构失败: {}", ds.getName(), e.getMessage());
                info.put("tables", List.of());
            }
            result.add(info);
        }
        return result;
    }
}