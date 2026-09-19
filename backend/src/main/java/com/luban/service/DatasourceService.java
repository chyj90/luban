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
import com.luban.security.RsaKeyProvider;
import com.luban.util.CryptoUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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

@Slf4j
@Service
@Transactional
public class DatasourceService {

    private final DatasourceRepository datasourceRepository;
    private final ApplicationRepository applicationRepository;
    private final com.luban.repository.SystemPermissionRepository systemPermissionRepository;
    private final com.luban.security.appaccess.AppAccessService appAccessService;
    private final com.luban.repository.DatasourceSchemaRepository datasourceSchemaRepository;
    private final ObjectMapper objectMapper;
    private final JdbcDriverService jdbcDriverService;
    private final CryptoUtil cryptoUtil;
    private final RsaKeyProvider rsaKeyProvider;

    /** 表结构缓存 TTL（秒）：问数/自动映射/校验读缓存，过期后首个访问者触发刷新 */
    @Value("${luban.schema-cache-ttl-seconds:600}")
    private long schemaCacheTtlSeconds;

    /** 每个 datasource 一把锁，避免并发问数对同一数据源的 schema 刷新风暴 */
    private final Map<Long, Object> schemaLocks = new java.util.concurrent.ConcurrentHashMap<>();

    @Value("${spring.datasource.url}")
    private String systemDbUrl;

    @Value("${spring.datasource.username}")
    private String systemDbUser;

    @Value("${spring.datasource.password}")
    private String systemDbPassword;

    public DatasourceService(DatasourceRepository datasourceRepository,
                             ApplicationRepository applicationRepository,
                             com.luban.repository.SystemPermissionRepository systemPermissionRepository,
                             com.luban.security.appaccess.AppAccessService appAccessService,
                             com.luban.repository.DatasourceSchemaRepository datasourceSchemaRepository,
                             ObjectMapper objectMapper,
                             JdbcDriverService jdbcDriverService,
                             CryptoUtil cryptoUtil,
                             RsaKeyProvider rsaKeyProvider) {
        this.datasourceRepository = datasourceRepository;
        this.applicationRepository = applicationRepository;
        this.systemPermissionRepository = systemPermissionRepository;
        this.appAccessService = appAccessService;
        this.datasourceSchemaRepository = datasourceSchemaRepository;
        this.objectMapper = objectMapper;
        this.jdbcDriverService = jdbcDriverService;
        this.cryptoUtil = cryptoUtil;
        this.rsaKeyProvider = rsaKeyProvider;
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

    /**
     * 一个平台一套 · 应用侧视图：应用自建数据源 + 已授权的平台数据源。
     * 平台数据源按"所属系统的系统权限（SystemPermission）"授权：
     * APPROVED 可用（SQL 控制台/测试）；includePending 时附带申请中的（accessStatus=PENDING，不可用）。
     * 平台管理员（connect:systems / 超管）可见全部平台数据源。
     */
    public List<Map<String, Object>> listAccessible(Long applicationId, Long userId, boolean includePending) {
        List<Map<String, Object>> result = new ArrayList<>();

        Set<Long> approvedGroups = new HashSet<>();
        Set<Long> pendingGroups = new HashSet<>();
        for (com.luban.entity.SystemPermission p : systemPermissionRepository.findByUserId(userId)) {
            if ("APPROVED".equals(p.getStatus())) approvedGroups.add(p.getGroupId());
            else if ("PENDING".equals(p.getStatus())) pendingGroups.add(p.getGroupId());
        }
        boolean platformAdmin = appAccessService.isSuperAdmin(userId);
        if (!platformAdmin) {
            try {
                appAccessService.assertPlatformPermission(userId, com.luban.constant.Permissions.CONNECT_SYSTEMS);
                platformAdmin = true;
            } catch (Exception ignored) {
            }
        }

        for (Datasource ds : datasourceRepository.findBySlug("PLATFORM")) {
            Long groupId = ds.getOwnerId();
            if (groupId == null) continue;
            String accessStatus;
            if (platformAdmin || approvedGroups.contains(groupId)) {
                accessStatus = "APPROVED";
            } else if (includePending && pendingGroups.contains(groupId)) {
                accessStatus = "PENDING";
            } else {
                continue;
            }
            Map<String, Object> map = buildDatasourceMap(ds);
            map.put("accessStatus", accessStatus);
            result.add(map);
        }

        if (applicationId != null) {
            try {
                appAccessService.assertAccess(userId, applicationId, com.luban.security.appaccess.AppAction.VIEW);
            } catch (Exception e) {
                throw new RuntimeException("无权访问该应用的数据源");
            }
            for (Datasource ds : datasourceRepository.findBySlugAndOwnerId("APPLICATION", applicationId)) {
                result.add(buildDatasourceMap(ds));
            }
        }
        return result;
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
        Map<String, Object> config = new HashMap<>(request.getConfig() != null ? request.getConfig() : Map.of());
        decryptRsaSecrets(config);
        encryptPasswordInConfig(config);

        Datasource ds = new Datasource();
        ds.setOwnerId(request.getOwnerId());
        ds.setSlug(request.getSlug());
        ds.setScope(request.getSlug());
        ds.setName(request.getName());
        ds.setType(request.getType());
        ds.setConfig(toJson(config));
        ds.setStatus("pending");
        ds = datasourceRepository.save(ds);
        return buildDatasourceMap(ds);
    }

    public Map<String, Object> syncLubanTestSource(Long applicationId) {
        if (!"allinone".equalsIgnoreCase(System.getenv("DEPLOY_MODE"))) {
            throw new RuntimeException("此功能仅在 All-in-One 版本中可用");
        }
        verifyApplicationOwnership(applicationId);

        var hostPort = parseHostPort(systemDbUrl);
        String host = hostPort[0];
        String port = hostPort[1];
        String adminUrl = String.format("jdbc:mysql://%s:%s?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC", host, port);

        try (Connection conn = DriverManager.getConnection(adminUrl, systemDbUser, systemDbPassword);
             Statement stmt = conn.createStatement()) {
            stmt.executeUpdate("CREATE DATABASE IF NOT EXISTS luban_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        } catch (Exception e) {
            throw new RuntimeException("同步测试源失败: " + e.getMessage(), e);
        }

        Datasource existing = datasourceRepository.findBySlugAndOwnerId("APPLICATION", applicationId)
                .stream()
                .filter(d -> "luban_test".equals(d.getName()))
                .findFirst()
                .orElse(null);
        if (existing != null) {
            return buildDatasourceMap(existing);
        }

        Map<String, Object> config = new LinkedHashMap<>();
        config.put("host", host);
        config.put("port", Integer.parseInt(port));
        config.put("database", "luban_test");
        config.put("username", systemDbUser);
        config.put("password", systemDbPassword);
        encryptPasswordInConfig(config);

        Datasource ds = new Datasource();
        ds.setOwnerId(applicationId);
        ds.setSlug("APPLICATION");
        ds.setScope("APPLICATION");
        ds.setName("luban_test");
        ds.setType("MySQL");
        ds.setConfig(toJson(config));
        ds.setStatus("connected");
        ds = datasourceRepository.save(ds);

        return buildDatasourceMap(ds);
    }

    private String[] parseHostPort(String jdbcUrl) {
        String host = "127.0.0.1";
        String port = "3306";
        try {
            String body = jdbcUrl.replaceFirst("^jdbc:mysql://", "");
            int slash = body.indexOf('/');
            if (slash > 0) body = body.substring(0, slash);
            int q = body.indexOf('?');
            if (q > 0) body = body.substring(0, q);
            int colon = body.lastIndexOf(':');
            if (colon > 0) {
                host = body.substring(0, colon);
                port = body.substring(colon + 1);
            } else {
                host = body;
            }
        } catch (Exception ignored) {
        }
        return new String[]{host, port};
    }

    public TestDatasourceResponse test(Long id) {
        Datasource ds = datasourceRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("数据源不存在"));
        try {
            Map<String, Object> config = fromJsonMap(ds.getConfig());
            String type = ds.getType().toLowerCase();
            if ("rest_api".equals(type)) {
                boolean ok = testApi(config);
                return ok ? new TestDatasourceResponse(true, "连接成功") : new TestDatasourceResponse(false, "连接失败");
            }
            boolean ok = testJdbc(type, config);
            if (ok) {
                ds.setStatus("connected");
                datasourceRepository.save(ds);
                return new TestDatasourceResponse(true, "连接成功");
            } else {
                ds.setStatus("error");
                datasourceRepository.save(ds);
                return new TestDatasourceResponse(false, "连接失败");
            }
        } catch (Throwable e) {
            ds.setStatus("error");
            datasourceRepository.save(ds);
            return new TestDatasourceResponse(false, "连接失败: " + e.getMessage());
        }
    }

    private boolean testJdbc(String type, Map<String, Object> config) {
        String url = jdbcDriverService.buildJdbcUrl(type, config);
        String username = String.valueOf(config.get("username"));
        String password = decryptPassword(config);
        try (Connection conn = DriverManager.getConnection(url, username, password)) {
            return conn.isValid(5);
        } catch (Throwable e) {
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

    /**
     * 表结构读取入口：优先返回缓存（datasource_schema），TTL 内直接命中；
     * 过期/缺失时实时拉取并回写。实时拉取失败时降级返回过期缓存（带 stale 标记），
     * 避免单个数据源故障拖垮整轮问数。
     */
    public Map<String, Object> getStructure(Long id) {
        return loadStructure(id, false);
    }

    /** 强制刷新表结构（数据源配置变更或管理端手动触发） */
    public Map<String, Object> refreshStructure(Long id) {
        return loadStructure(id, true);
    }

    private Map<String, Object> loadStructure(Long id, boolean force) {
        Datasource ds = datasourceRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("数据源不存在"));
        synchronized (schemaLocks.computeIfAbsent(id, k -> new Object())) {
            com.luban.entity.DatasourceSchema cached = datasourceSchemaRepository.findByDatasourceId(id).orElse(null);
            boolean fresh = cached != null
                    && Boolean.TRUE.equals(cached.getSyncOk())
                    && cached.getSyncedAt() != null
                    && cached.getSyncedAt().isAfter(java.time.LocalDateTime.now().minusSeconds(schemaCacheTtlSeconds));
            if (!force && fresh) {
                return parseSchemaJson(cached.getTablesJson());
            }
            try {
                Map<String, Object> structure = fetchStructureLive(ds);
                int tableCount = structure.get("tables") instanceof List<?> l ? l.size() : 0;
                com.luban.entity.DatasourceSchema row = cached != null ? cached : new com.luban.entity.DatasourceSchema();
                row.setDatasourceId(id);
                row.setTablesJson(toJson(structure));
                row.setTableCount(tableCount);
                row.setSyncedAt(java.time.LocalDateTime.now());
                row.setSyncOk(true);
                row.setSyncError(null);
                datasourceSchemaRepository.save(row);
                return structure;
            } catch (Exception e) {
                if (cached != null) {
                    log.warn("Schema refresh failed for datasource {}, falling back to stale cache (syncedAt={}): {}",
                            id, cached.getSyncedAt(), e.getMessage());
                    Map<String, Object> stale = parseSchemaJson(cached.getTablesJson());
                    stale.put("stale", true);
                    stale.put("error", "实时刷新失败，返回缓存结构: " + e.getMessage());
                    return stale;
                }
                throw e;
            }
        }
    }

    private Map<String, Object> fetchStructureLive(Datasource ds) {
        Map<String, Object> config = fromJsonMap(ds.getConfig());
        String type = ds.getType().toLowerCase();
        if ("rest_api".equals(type)) {
            return getApiStructure(config);
        }
        return getJdbcStructure(type, config);
    }

    private Map<String, Object> parseSchemaJson(String json) {
        try {
            return objectMapper.readValue(json, Map.class);
        } catch (Exception e) {
            return Map.of("tables", List.of());
        }
    }

    private Map<String, Object> getJdbcStructure(String type, Map<String, Object> config) {
        List<Map<String, Object>> tables = new ArrayList<>();
        try {
            String url = jdbcDriverService.buildJdbcUrl(type, config);
            String username = String.valueOf(config.get("username"));
            String password = decryptPassword(config);
            try (Connection conn = DriverManager.getConnection(url, username, password)) {
                DatabaseMetaData meta = conn.getMetaData();
                String catalog = conn.getCatalog();
                try (ResultSet rs = meta.getTables(catalog, null, "%", new String[]{"TABLE"})) {
                    while (rs.next()) {
                        String tableName = rs.getString("TABLE_NAME");
                        String tableRemarks = rs.getString("REMARKS");
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
                        table.put("comment", tableRemarks != null && !tableRemarks.isEmpty() ? tableRemarks : "");
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

        if ("rest_api".equals(type)) {
            return Set.of();
        }

        String url = jdbcDriverService.buildJdbcUrl(type, config);
        String sql = "SELECT DISTINCT " + columnName + " FROM " + tableName + " LIMIT 1000";
        Set<String> values = new HashSet<>();
        try (Connection conn = DriverManager.getConnection(url,
                String.valueOf(config.get("username")),
                decryptPassword(config));
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
            throw new RuntimeException("查询枚举值失败: " + e.getMessage(), e);
        }
        return values;
    }

    public Datasource getById(Long id) {
        return datasourceRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("数据源不存在: " + id));
    }

    public void delete(Long id) {
        datasourceRepository.deleteById(id);
        datasourceSchemaRepository.deleteByDatasourceId(id);
    }

    public Map<String, Object> update(Long id, CreateDatasourceRequest request) {
        Datasource ds = datasourceRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("数据源不存在"));
        ds.setName(request.getName());
        ds.setType(request.getType());
        if (request.getConfig() != null) {
            Map<String, Object> newConfig = new HashMap<>(request.getConfig());
            decryptRsaSecrets(newConfig);
            String newPassword = String.valueOf(newConfig.getOrDefault("password", ""));
            if (newPassword.isBlank() || "••••••••".equals(newPassword)) {
                Map<String, Object> oldConfig = fromJsonMap(ds.getConfig());
                if (oldConfig.containsKey("password")) {
                    newConfig.put("password", oldConfig.get("password"));
                }
            } else {
                encryptPasswordInConfig(newConfig);
            }
            ds.setConfig(toJson(newConfig));
        }
        ds.setStatus("pending");
        ds = datasourceRepository.save(ds);
        // 连接配置已变更，旧的表结构缓存作废
        datasourceSchemaRepository.deleteByDatasourceId(id);
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
        return jdbcDriverService.buildJdbcUrl(type, config);
    }

    /**
     * 平台系统库数据源（内置组织/人员语义包的数据底座）。
     * 指向平台自身的 users/user_dept/departments，幂等：按 slug=PLATFORM + name 查找，存在即返回。
     */
    @Transactional
    public Datasource ensurePlatformSystemDatasource() {
        return datasourceRepository.findBySlug("PLATFORM").stream()
                .filter(d -> PLATFORM_DS_NAME.equals(d.getName()))
                .findFirst()
                .orElseGet(() -> {
                    String[] hostPort = parseHostPort(systemDbUrl);
                    String database = parseDatabaseName(systemDbUrl);
                    Map<String, Object> config = new LinkedHashMap<>();
                    config.put("host", hostPort[0]);
                    config.put("port", Integer.parseInt(hostPort[1]));
                    config.put("database", database);
                    config.put("username", systemDbUser);
                    config.put("password", systemDbPassword);
                    encryptPasswordInConfig(config);

                    Datasource ds = new Datasource();
                    ds.setOwnerId(null);
                    ds.setSlug("PLATFORM");
                    ds.setScope("PLATFORM");
                    ds.setName(PLATFORM_DS_NAME);
                    ds.setType("MySQL");
                    ds.setConfig(toJson(config));
                    ds.setStatus("connected");
                    return datasourceRepository.save(ds);
                });
    }

    /**
     * 幂等注册内置演示数据源（如运营商演示库）：在平台 MySQL 实例上创建独立的演示库并指向它。
     * 业务数据（哪怕是演示数据）与平台系统库物理隔离——平台库只存平台元数据，
     * 删除演示库不影响平台；且演示接入形态与真实外部库接入完全同构（连接 → 绑定映射）。
     * 数据库账号需有建库权限；无权限时抛出异常，由调用方降级跳过行业语义包。
     */
    public Datasource ensureBuiltinDemoDatasource(String slug, String name, String database) {
        var hostPort = parseHostPort(systemDbUrl);
        String host = hostPort[0];
        String port = hostPort[1];
        String adminUrl = String.format("jdbc:mysql://%s:%s?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC", host, port);
        try (Connection conn = DriverManager.getConnection(adminUrl, systemDbUser, systemDbPassword);
             Statement stmt = conn.createStatement()) {
            stmt.executeUpdate("CREATE DATABASE IF NOT EXISTS " + database + " CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        } catch (Exception e) {
            throw new RuntimeException("创建演示库 " + database + " 失败（需要建库权限，或配置关闭对应语义包）: " + e.getMessage(), e);
        }

        return datasourceRepository.findBySlug(slug).stream()
                .filter(d -> name.equals(d.getName()))
                .findFirst()
                .map(existing -> {
                    // 内置演示数据源的连接信息始终跟随平台当前配置重写（含重新加密的密码）：
                    // 换 LUBAN_DATASOURCE_SECRET 后无需手工修复，启动即自愈
                    Map<String, Object> config = new LinkedHashMap<>();
                    config.put("host", host);
                    config.put("port", Integer.parseInt(port));
                    config.put("database", database);
                    config.put("username", systemDbUser);
                    config.put("password", systemDbPassword);
                    encryptPasswordInConfig(config);
                    existing.setConfig(toJson(config));
                    existing.setStatus("connected");
                    return datasourceRepository.save(existing);
                })
                .orElseGet(() -> {
                    Map<String, Object> config = new LinkedHashMap<>();
                    config.put("host", host);
                    config.put("port", Integer.parseInt(port));
                    config.put("database", database);
                    config.put("username", systemDbUser);
                    config.put("password", systemDbPassword);
                    encryptPasswordInConfig(config);

                    Datasource ds = new Datasource();
                    ds.setOwnerId(null);
                    ds.setSlug(slug);
                    ds.setScope("PLATFORM");
                    ds.setName(name);
                    ds.setType("MySQL");
                    ds.setConfig(toJson(config));
                    ds.setStatus("connected");
                    return datasourceRepository.save(ds);
                });
    }

    public static final String PLATFORM_DS_NAME = "平台系统库";

    /** jdbc:mysql://host:port/db?params → db */
    private String parseDatabaseName(String jdbcUrl) {
        try {
            String rest = jdbcUrl.substring(jdbcUrl.indexOf("://") + 3);
            int slash = rest.indexOf('/');
            int question = rest.indexOf('?');
            if (slash >= 0) {
                return question > slash ? rest.substring(slash + 1, question) : rest.substring(slash + 1);
            }
        } catch (Exception ignored) {
        }
        return "luban";
    }

    /** 传输层信封解密：rsa: 前缀字段用私钥解密回明文（随后由 encryptPasswordInConfig 做 AES 落库） */
    private void decryptRsaSecrets(Map<String, Object> config) {
        if (config == null) return;
        config.replaceAll((k, v) -> {
            if (v instanceof String str && str.startsWith(RsaKeyProvider.PREFIX)) {
                return rsaKeyProvider.decrypt(str.substring(RsaKeyProvider.PREFIX.length()));
            }
            return v;
        });
    }

    private void encryptPasswordInConfig(Map<String, Object> config) {
        if (config.containsKey("password") && config.get("password") != null) {
            String pwd = String.valueOf(config.get("password"));
            if (!pwd.isBlank() && !cryptoUtil.isEncrypted(pwd)) {
                config.put("password", cryptoUtil.encrypt(pwd));
            }
        }
    }

    public String decryptPassword(Map<String, Object> config) {
        if (!config.containsKey("password") || config.get("password") == null) {
            return "";
        }
        String pwd = String.valueOf(config.get("password"));
        if (pwd.isBlank()) {
            return "";
        }
        if (cryptoUtil.isEncrypted(pwd)) {
            return cryptoUtil.decrypt(pwd);
        }
        return pwd;
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
                } else {
                    info.put("tables", List.of());
                }
            } catch (Exception e) {
                info.put("tables", List.of());
                info.put("error", e.getMessage());
            }
            result.add(info);
        }
        return result;
    }
}