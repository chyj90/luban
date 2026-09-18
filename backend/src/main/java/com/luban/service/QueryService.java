package com.luban.service;

import com.luban.dto.CreateQueryRequest;
import com.luban.dto.RunQueryRequest;
import com.luban.dto.RunQueryResponse;
import com.luban.dto.UpdateQueryRequest;
import com.luban.constant.Permissions;
import com.luban.constant.ToolType;
import com.luban.entity.Datasource;
import com.luban.entity.Query;
import com.luban.entity.SystemPermission;
import com.luban.entity.ToolDefinition;
import com.luban.entity.User;
import com.luban.entity.ApiKey;
import com.luban.entity.ApiKeyDatasource;
import com.luban.entity.Application;
import com.luban.repository.ApiKeyDatasourceRepository;
import com.luban.repository.ApiKeyRepository;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.DatasourceRepository;
import com.luban.repository.QueryRepository;
import com.luban.repository.SystemPermissionRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.repository.UserDeptRepository;
import com.luban.repository.UserRepository;
import com.luban.util.SqlUtils;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.net.URI;
import java.util.stream.Collectors;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import ognl.Ognl;
import ognl.OgnlContext;
import ognl.MemberAccess;

import java.lang.reflect.Member;

import net.sf.jsqlparser.JSQLParserException;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;
import net.sf.jsqlparser.statement.update.Update;
import net.sf.jsqlparser.statement.delete.Delete;
import net.sf.jsqlparser.expression.operators.relational.EqualsTo;
import net.sf.jsqlparser.expression.NullValue;
import net.sf.jsqlparser.expression.Expression;
import net.sf.jsqlparser.expression.operators.conditional.AndExpression;
import net.sf.jsqlparser.expression.operators.conditional.OrExpression;
import net.sf.jsqlparser.expression.Parenthesis;

import com.luban.security.appaccess.AppAccessService;
import com.luban.security.appaccess.AppAction;
import com.luban.util.CryptoUtil;
import com.luban.util.AgentLogger;

@Service
public class QueryService {

    /**
     * 模板表达式求值的沙箱。原 ALLOW_ALL 实现允许 @java.lang.Runtime@getRuntime().exec()
     * 这类静态调用，模板又可经 create/update API 写入，构成认证后 RCE。
     * 防线一：assertSafeOgnlExpression 在解析前拒绝 OGNL 的类引用（@...@）、
     * 构造调用（new X）、上下文变量（#var）语法。
     * 防线二：MemberAccess 方法白名单——属性 getter 之外仅放行模板常用的无副作用方法，
     * 显式封死 getClass/getRuntime/exec/forName/invoke 等反射与运行时入口。
     */
    private static final MemberAccess RESTRICTED = new MemberAccess() {
        private static final Set<String> ALLOWED_METHODS = Set.of(
                "size", "isEmpty", "contains", "containsKey", "containsValue", "length", "trim",
                "toString", "equals", "equalsIgnoreCase", "startsWith", "endsWith",
                "toUpperCase", "toLowerCase", "intValue", "longValue", "doubleValue",
                "floatValue", "booleanValue", "getKey", "getValue");

        private boolean isSafe(Member member) {
            if (member instanceof java.lang.reflect.Constructor) return false;
            if (member instanceof java.lang.reflect.Method m) {
                String name = m.getName();
                switch (name) {
                    case "getClass", "getClassLoader", "forName", "newInstance",
                         "getRuntime", "exec", "loadClass", "invoke",
                         "wait", "notify", "notifyAll", "getMethod", "getMethods",
                         "getDeclaredMethod", "getConstructor", "getConstructors":
                        return false;
                    default:
                }
                if (ALLOWED_METHODS.contains(name)) return true;
                return (name.startsWith("get") || name.startsWith("is")) && m.getParameterCount() == 0;
            }
            return true;
        }

        public Object setup(Map context, Object target, Member member, String propertyName) {
            return null;
        }
        public void restore(Map context, Object target, Member member, String propertyName, Object state) {}
        public boolean isAccessible(Map context, Object target, Member member, String propertyName) {
            return isSafe(member);
        }
    };

    private static final Pattern FORBIDDEN_OGNL_SYNTAX = Pattern.compile(
            "@[A-Za-z_]|\\bnew\\s+[A-Za-z_]|#[A-Za-z_]");

    private static void assertSafeOgnlExpression(String expr) {
        if (FORBIDDEN_OGNL_SYNTAX.matcher(expr).find()) {
            throw new IllegalArgumentException(
                    "模板表达式包含被禁止的 OGNL 语法（类引用/构造调用/上下文变量）: " + expr);
        }
    }

    private final QueryRepository queryRepository;
    private final DatasourceRepository datasourceRepository;
    private final ApplicationRepository applicationRepository;
    private final ApiKeyRepository apiKeyRepository;
    private final ApiKeyDatasourceRepository apiKeyDatasourceRepository;
    private final UserDeptRepository userDeptRepository;
    private final UserRepository userRepository;
    private final ObjectMapper objectMapper;
    private final DatasourceService datasourceService;
    private final AppAccessService appAccessService;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final SystemPermissionRepository systemPermissionRepository;

    public QueryService(QueryRepository queryRepository,
                        DatasourceRepository datasourceRepository,
                        ApplicationRepository applicationRepository,
                        ApiKeyRepository apiKeyRepository,
                        ApiKeyDatasourceRepository apiKeyDatasourceRepository,
                        UserDeptRepository userDeptRepository,
                        UserRepository userRepository,
                        ObjectMapper objectMapper,
                        DatasourceService datasourceService,
                        AppAccessService appAccessService,
                        ToolDefinitionRepository toolDefinitionRepository,
                        SystemPermissionRepository systemPermissionRepository) {
        this.queryRepository = queryRepository;
        this.datasourceRepository = datasourceRepository;
        this.applicationRepository = applicationRepository;
        this.apiKeyRepository = apiKeyRepository;
        this.apiKeyDatasourceRepository = apiKeyDatasourceRepository;
        this.userDeptRepository = userDeptRepository;
        this.userRepository = userRepository;
        this.objectMapper = objectMapper;
        this.datasourceService = datasourceService;
        this.appAccessService = appAccessService;
        this.toolDefinitionRepository = toolDefinitionRepository;
        this.systemPermissionRepository = systemPermissionRepository;
    }

    public List<Map<String, Object>> listByApplication(Long applicationId) {
        List<Query> queries = queryRepository.findByApplicationId(applicationId);
        List<Map<String, Object>> result = new ArrayList<>();
        for (Query q : queries) {
            result.add(buildQueryMap(q));
        }
        return result;
    }

    /**
     * 工作中心数据看板：列出洞察沉淀的查询（source=INSIGHT），
     * 仅返回当前用户可访问应用（owner/成员/超管）下的记录。
     */
    public List<Map<String, Object>> listInsightSaved(Long userId) {
        List<Query> queries = queryRepository.findBySourceOrderByCreatedAtDesc("INSIGHT");
        List<Map<String, Object>> result = new ArrayList<>();
        for (Query q : queries) {
            try {
                appAccessService.assertAccess(userId, q.getApplicationId(), AppAction.VIEW);
            } catch (Exception e) {
                continue;
            }
            result.add(buildQueryMap(q));
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> create(CreateQueryRequest request) {
        Query query = new Query();
        query.setApplicationId(request.getApplicationId());
        query.setDatasourceId(request.getDatasourceId());
        query.setName(request.getName());
        query.setBody(request.getBody());
        query.setParams(toJson(request.getParams()));
        query.setDescription(request.getDescription());
        query.setSource(request.getSource());

        String tableWarning = validateSqlSyntax(request.getDatasourceId(), request.getBody(), request.getParams());

        query = queryRepository.save(query);
        Map<String, Object> result = buildQueryMap(query);
        if (tableWarning != null) result.put("validationWarning", tableWarning);
        return result;
    }

    /**
     * 创建时校验 SQL；返回 null 表示校验通过，非 null 为降级警告（目前仅"目标表尚不存在"）。
     * 缺表不再阻断创建：建表（DDL 需人工/确认门）与查询创建被迫串行，曾导致介入前
     * 全部查询创建失败、人工建表后又整批重试（2026-09-16 DAU 看板案例）。缺表查询
     * 照常保存，真正校验发生在 run_query / 页面运行时。
     */
    private String validateSqlSyntax(Long datasourceId, String body, Map<String, Object> paramsDef) {
        if (body == null || body.isBlank()) return null;

        Datasource ds = datasourceRepository.findById(datasourceId)
                .orElseThrow(() -> new IllegalArgumentException("数据源不存在"));
        if (!"mysql".equalsIgnoreCase(ds.getType()) && !"postgresql".equalsIgnoreCase(ds.getType())) return null;

        Map<String, Object> validationParams = buildValidationParams(paramsDef);
        Map<String, Object> authParams = new HashMap<>();
        authParams.put("userId", 0);
        authParams.put("userName", "validation");
        authParams.put("userEmail", "validation@local");
        authParams.put("userDisplayName", "validation");
        authParams.put("userMobile", "validation");
        authParams.put("userEmployeeNo", "validation");

        String resolved = resolveTemplate(body, validationParams, authParams);
        String upperSql = resolved.trim().toUpperCase();

        boolean isDdl = upperSql.startsWith("CREATE") || upperSql.startsWith("ALTER")
                || upperSql.startsWith("DROP") || upperSql.startsWith("TRUNCATE")
                || upperSql.startsWith("RENAME");
        if (isDdl) return null;

        // 校验 UPDATE <set> 中的 <if> 条件必须同时检查 != null 和 != ''
        if (body.contains("<set>") || body.contains("<set ")) {
            Pattern ifPattern = Pattern.compile("<if\\s+test=\"([^\"]*)\"", Pattern.CASE_INSENSITIVE);
            Matcher ifMatcher = ifPattern.matcher(body);
            while (ifMatcher.find()) {
                String condition = ifMatcher.group(1);
                if (condition.contains("!= null") && !condition.contains("!= ''")) {
                    throw new IllegalArgumentException(
                        "UPDATE <set> 的 <if test=\"" + condition + "\"> 只检查了 != null，缺少 != '' 检查。"
                        + "前端可能传空字符串，只检查 != null 会导致原值被覆盖为空。"
                        + "请改为：test=\"" + condition + " and " + condition.replace("!= null", "").trim() + " != ''\""
                    );
                }
            }
        }

        Map<String, Object> config = datasourceService.fromJsonMap(ds.getConfig());
        String url = datasourceService.buildJdbcUrl(ds.getType(), config);

        try (Connection conn = DriverManager.getConnection(url,
                String.valueOf(config.get("username")),
                datasourceService.decryptPassword(config));
             Statement stmt = conn.createStatement()) {
            stmt.execute("EXPLAIN " + resolved);
            try (ResultSet rs = stmt.getResultSet()) {
                while (rs.next()) { /* consume result */ }
            }
        } catch (SQLException e) {
            if (isTableMissing(e)) {
                return "目标表尚不存在（缺表降级，查询已保存）：" + e.getMessage()
                        + "。表创建后无需重建查询，run_query / 页面运行时即生效";
            }
            throw new IllegalArgumentException("SQL 校验失败: " + e.getMessage());
        } catch (Exception e) {
            throw new IllegalArgumentException("SQL 校验失败: " + e.getMessage());
        }
        return null;
    }

    /** 缺表判定（不阻断创建的唯一例外）：沿异常链找 MySQL ER_NO_SUCH_TABLE / SQLState 42S02、42P01，消息兜底 */
    private static boolean isTableMissing(SQLException e) {
        for (SQLException cur = e; cur != null; cur = cur.getNextException()) {
            if (cur.getErrorCode() == 1146) return true; // MySQL ER_NO_SUCH_TABLE
            String state = cur.getSQLState();
            if ("42S02".equals(state) || "42P01".equals(state)) return true;
            String msg = cur.getMessage();
            if (msg != null) {
                String lower = msg.toLowerCase();
                if (lower.contains("doesn't exist") && lower.contains("table")) return true;
                if (lower.contains("does not exist") && lower.contains("relation")) return true;
            }
        }
        return false;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> buildValidationParams(Map<String, Object> paramsDef) {
        Map<String, Object> result = new HashMap<>();
        if (paramsDef == null) return result;
        for (Map.Entry<String, Object> entry : paramsDef.entrySet()) {
            String name = entry.getKey();
            Object def = entry.getValue();
            if (def instanceof Map) {
                Map<String, Object> defMap = (Map<String, Object>) def;
                if (defMap.containsKey("default")) {
                    result.put(name, defMap.get("default"));
                } else {
                    result.put(name, getDummyValueForType(String.valueOf(defMap.getOrDefault("type", "string"))));
                }
            } else {
                result.put(name, def);
            }
        }
        return result;
    }

    private Object getDummyValueForType(String type) {
        return switch (type.toLowerCase()) {
            case "integer", "int", "number" -> 1;
            case "boolean" -> true;
            case "float", "double" -> 1.0;
            case "date", "datetime" -> "2024-01-01";
            default -> "x";
        };
    }

    /**
     * 声明为 required 的参数缺失时直接报错，而不是把 NULL 拼进 SQL。
     * 否则触发器场景 paramsMapping 解析为 null（如 form.data.id 缺失）会生成
     * WHERE id = NULL，命中 0 行还被当成派发成功——最难排查的静默断链。
     */
    private void assertRequiredParams(Query query, Map<String, Object> mergedParams) {
        List<String> missing = findMissingRequiredParams(query, mergedParams);
        if (!missing.isEmpty()) {
            throw new IllegalArgumentException("必填参数缺失: " + String.join(", ", missing)
                    + "。页面调用请检查传参；触发器/编排场景通常是 paramsMapping 解析为 null"
                    + "（如 form.data.<字段> 缺失，检查发起侧 startWorkflow 的 formData 是否携带该字段）");
        }
    }

    /** 声明为 required 且当前值为 null 的参数清单（预演场景只报告不抛错） */
    private List<String> findMissingRequiredParams(Query query, Map<String, Object> mergedParams) {
        Map<String, Object> defs = fromJsonMap(query.getParams());
        List<String> missing = new ArrayList<>();
        if (defs == null || defs.isEmpty()) return missing;
        for (Map.Entry<String, Object> entry : defs.entrySet()) {
            if (!(entry.getValue() instanceof Map)) continue;
            Object required = ((Map<?, ?>) entry.getValue()).get("required");
            if (!Boolean.TRUE.equals(required) && !"true".equalsIgnoreCase(String.valueOf(required))) continue;
            if (mergedParams.get(entry.getKey()) == null) missing.add(entry.getKey());
        }
        return missing;
    }

    /**
     * 触发器预演用：渲染查询模板（{{ this.auth.* }} 按样例用户身份解析），不执行。
     * sampleUserId 为空或用户不存在时用占位身份渲染，并在结果中标记 placeholderIdentity，
     * 提醒预演方"真实运行时身份由流程发起人决定"。
     */
    public Map<String, Object> previewRenderedSql(Long queryId, Map<String, Object> params, Long sampleUserId) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("queryId", queryId);
        Query query = queryRepository.findById(queryId).orElse(null);
        if (query == null) {
            out.put("error", "查询不存在: " + queryId);
            return out;
        }
        Map<String, Object> mergedParams = new HashMap<>();
        Map<String, Object> defaultParams = fromJsonMap(query.getParams());
        if (defaultParams != null) mergedParams.putAll(defaultParams);
        if (params != null) mergedParams.putAll(params);
        for (Map.Entry<String, Object> entry : mergedParams.entrySet()) {
            if (entry.getValue() instanceof Map) entry.setValue(null);
        }
        Map<String, Object> authParams = new HashMap<>();
        if (sampleUserId != null) {
            userRepository.findById(sampleUserId).ifPresent(user -> fillAuthParams(authParams, user));
        }
        boolean placeholderIdentity = authParams.isEmpty();
        if (placeholderIdentity) {
            authParams.put("userId", 0);
            authParams.put("userName", "rehearsal");
            authParams.put("userEmail", "rehearsal@local");
            authParams.put("userDisplayName", "rehearsal");
            authParams.put("userMobile", "rehearsal");
            authParams.put("userEmployeeNo", "rehearsal");
        }
        try {
            out.put("renderedSql", resolveTemplate(query.getBody(), mergedParams, authParams));
        } catch (Exception e) {
            out.put("error", e.getMessage());
            return out;
        }
        out.put("name", query.getName());
        out.put("datasourceId", query.getDatasourceId());
        out.put("resolvedParams", mergedParams);
        out.put("placeholderIdentity", placeholderIdentity);
        out.put("missingRequiredParams", findMissingRequiredParams(query, mergedParams));
        return out;
    }

    public Map<String, Object> update(Long id, UpdateQueryRequest request) {
        Query query = queryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("查询不存在"));
        if (request.getName() != null) query.setName(request.getName());
        String tableWarning = null;
        if (request.getBody() != null) {
            // 与 create 同等校验：坏 SQL（语法错误、多语句、模板占位无法解析）不允许保存，
            // 否则页面/触发器引用的查询会到执行时才失败
            Map<String, Object> paramsDef = request.getParams() != null
                    ? request.getParams()
                    : fromJsonMap(query.getParams());
            tableWarning = validateSqlSyntax(query.getDatasourceId(), request.getBody(), paramsDef);
            query.setBody(request.getBody());
        }
        if (request.getParams() != null) query.setParams(toJson(request.getParams()));
        query = queryRepository.save(query);
        // 已发布查询的名称/参数变化同步平台工具定义（body 经引用即时生效，无需重发布）
        if (query.getPublishedGroupId() != null) {
            syncPublishedTool(query);
        }
        Map<String, Object> result = buildQueryMap(query);
        if (tableWarning != null) result.put("validationWarning", tableWarning);
        return result;
    }

    public void delete(Long id) {
        // 已发布的查询先摘除平台身份（工具定义），避免外调目录与订阅视图悬挂
        deletePublishedTool(id);
        queryRepository.deleteById(id);
    }

    // ==================== 平台发布（Query 作为第三类平台资产） ====================

    /**
     * 发布：挂到目标系统 + 注册 QUERY 型 ToolDefinition（照编排发布注册工具的同款模式）。
     * 发布不复制查询行——平台身份只是 publishedGroupId 标记 + 工具定义里的 queryId 引用，
     * 发布方修改 SQL 平台侧即时生效；取消发布/删除查询时同步清理工具定义。
     * 应用侧使用按系统权限（SystemPermission）授权，KEY 侧订阅走 api_key_tool，与平台工具同模型。
     */
    @Transactional
    public Map<String, Object> publish(Long id, Long groupId, Long userId) {
        Query query = queryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("查询不存在"));
        if (!appAccessService.canUseSystemAsset(userId, groupId)) {
            throw new IllegalArgumentException("无权向该系统发布查询：请先取得所属系统的数据访问权限");
        }
        String toolName = publishedToolName(id);
        ToolDefinition tool = toolDefinitionRepository.findAll().stream()
                .filter(t -> toolName.equals(t.getName()))
                .findFirst().orElseGet(() -> {
                    ToolDefinition t = new ToolDefinition();
                    t.setName(toolName);
                    t.setScope("PLATFORM");
                    t.setToolType(ToolType.QUERY);
                    t.setConfig(toJson(Map.of("queryId", id)));
                    return t;
                });
        tool.setGroupId(groupId);
        tool.setDisplayName(query.getName());
        tool.setDescription("数据查询: " + query.getName()
                + (query.getDescription() == null || query.getDescription().isBlank()
                        ? "" : " — " + query.getDescription()));
        tool.setInputSchema(toJson(inputSchemaFromParams(query)));
        toolDefinitionRepository.save(tool);

        query.setPublishedGroupId(groupId);
        query = queryRepository.save(query);
        return buildQueryMap(query);
    }

    /** 取消发布：清发布标记 + 删除 QUERY 型工具定义 */
    @Transactional
    public void unpublish(Long id) {
        Query query = queryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("查询不存在"));
        deletePublishedTool(id);
        query.setPublishedGroupId(null);
        queryRepository.save(query);
    }

    private String publishedToolName(Long queryId) {
        return "qry_" + queryId;
    }

    private void deletePublishedTool(Long queryId) {
        String toolName = publishedToolName(queryId);
        toolDefinitionRepository.findAll().stream()
                .filter(t -> toolName.equals(t.getName()))
                .findFirst()
                .ifPresent(toolDefinitionRepository::delete);
    }

    private void syncPublishedTool(Query query) {
        String toolName = publishedToolName(query.getId());
        toolDefinitionRepository.findAll().stream()
                .filter(t -> toolName.equals(t.getName()))
                .findFirst()
                .ifPresent(tool -> {
                    tool.setDisplayName(query.getName());
                    tool.setInputSchema(toJson(inputSchemaFromParams(query)));
                    toolDefinitionRepository.save(tool);
                });
    }

    /** 从查询参数定义推导工具入参 schema（key=参数名，value 含 required/type 等声明） */
    private Map<String, Object> inputSchemaFromParams(Query query) {
        Map<String, Object> defs = fromJsonMap(query.getParams());
        Map<String, Object> properties = new LinkedHashMap<>();
        List<String> required = new ArrayList<>();
        if (defs != null) {
            for (Map.Entry<String, Object> entry : defs.entrySet()) {
                Map<?, ?> def = entry.getValue() instanceof Map<?, ?> m ? m : Map.of();
                Map<String, Object> prop = new LinkedHashMap<>();
                Object type = def.get("type");
                prop.put("type", type != null ? String.valueOf(type) : "string");
                Object desc = def.get("description");
                if (desc != null) prop.put("description", desc);
                properties.put(entry.getKey(), prop);
                Object req = def.get("required");
                if (Boolean.TRUE.equals(req) || "true".equalsIgnoreCase(String.valueOf(req))) {
                    required.add(entry.getKey());
                }
            }
        }
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");
        schema.put("properties", properties);
        if (!required.isEmpty()) schema.put("required", required);
        return schema;
    }

    /**
     * 一个平台一套 · 应用侧视图：应用自有查询 + 已授权系统的平台发布查询。
     * 平台查询按"所属系统的系统权限（SystemPermission）"授权：APPROVED 可运行；
     * includePending 时附带申请中的（accessStatus=PENDING，不可运行）。
     * 平台管理员（connect:systems / 超管）可见全部。
     */
    public List<Map<String, Object>> listAccessible(Long applicationId, Long userId, boolean includePending) {
        Set<Long> approvedGroups = new HashSet<>();
        Set<Long> pendingGroups = new HashSet<>();
        for (SystemPermission p : systemPermissionRepository.findByUserId(userId)) {
            if ("APPROVED".equals(p.getStatus())) approvedGroups.add(p.getGroupId());
            else if ("PENDING".equals(p.getStatus())) pendingGroups.add(p.getGroupId());
        }
        boolean platformAdmin = appAccessService.isSuperAdmin(userId);
        if (!platformAdmin) {
            try {
                appAccessService.assertPlatformPermission(userId, Permissions.CONNECT_SYSTEMS);
                platformAdmin = true;
            } catch (Exception ignored) {
            }
        }

        List<Map<String, Object>> result = new ArrayList<>();
        for (Query q : queryRepository.findByPublishedGroupIdIsNotNull()) {
            // 发布方应用自己的已发布查询在下方自有分段出现，避免重复
            if (applicationId != null && applicationId.equals(q.getApplicationId())) continue;
            Long groupId = q.getPublishedGroupId();
            String accessStatus;
            if (platformAdmin || approvedGroups.contains(groupId)) {
                accessStatus = "APPROVED";
            } else if (includePending && pendingGroups.contains(groupId)) {
                accessStatus = "PENDING";
            } else {
                continue;
            }
            Map<String, Object> map = buildQueryMap(q);
            map.put("accessStatus", accessStatus);
            result.add(map);
        }

        if (applicationId != null) {
            for (Query q : queryRepository.findByApplicationId(applicationId)) {
                result.add(buildQueryMap(q));
            }
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    public RunQueryResponse run(Long id, RunQueryRequest request) {
        return executeQuery(id, request, null);
    }

    /**
     * 以指定平台用户身份执行：this.auth 取该用户的账号与主部门，而非 HTTP 会话。
     * 供触发器派发等无会话上下文的系统调用使用（on-behalf-of 流程发起人），
     * 让回写类查询也能安全使用 {{ this.auth.* }} 做数据归属。
     * userId 对应的用户不存在时按无身份执行；此时模板若引用 this.auth 会被硬失败拦截。
     */
    @SuppressWarnings("unchecked")
    public RunQueryResponse runAsUser(Long id, RunQueryRequest request, Long onBehalfOfUserId) {
        return executeQuery(id, request, onBehalfOfUserId);
    }

    @SuppressWarnings("unchecked")
    private RunQueryResponse executeQuery(Long id, RunQueryRequest request, Long onBehalfOfUserId) {
        Query query = queryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("查询不存在"));
        Datasource ds = datasourceRepository.findById(query.getDatasourceId())
                .orElseThrow(() -> new IllegalArgumentException("数据源不存在"));

        Map<String, Object> mergedParams = new HashMap<>();
        Map<String, Object> defaultParams = fromJsonMap(query.getParams());
        if (defaultParams != null) mergedParams.putAll(defaultParams);
        if (request.getParams() != null) mergedParams.putAll(request.getParams());

        for (Map.Entry<String, Object> entry : mergedParams.entrySet()) {
            if (entry.getValue() instanceof Map) {
                entry.setValue(null);
            }
        }

        assertRequiredParams(query, mergedParams);

        Map<String, Object> authParams = new HashMap<>();
        if (onBehalfOfUserId != null) {
            userRepository.findById(onBehalfOfUserId).ifPresent(user -> fillAuthParams(authParams, user));
        } else {
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.getPrincipal() instanceof User user) {
                fillAuthParams(authParams, user);
            }
        }

        String finalBody = resolveTemplate(query.getBody(), mergedParams, authParams);
        Map<String, Object> config = fromJsonMap(ds.getConfig());

        return switch (ds.getType().toLowerCase()) {
            case "mysql", "postgresql" -> runJdbcQuery(ds.getType(), config, finalBody);
            case "rest_api" -> runRestApiQuery(config, finalBody, mergedParams);
            default -> throw new IllegalArgumentException("不支持的数据源类型: " + ds.getType());
        };
    }

    /** 平台用户 → this.auth 字段（账号 8 件套 + 主部门，组织资产见 /platform/assets） */
    private void fillAuthParams(Map<String, Object> authParams, User user) {
        authParams.put("userId", user.getId());
        authParams.put("userName", user.getAccount());
        authParams.put("userEmail", user.getEmail());
        authParams.put("userDisplayName", user.getName());
        authParams.put("userMobile", user.getMobile());
        authParams.put("userEmployeeNo", user.getEmployeeNo());
        // 组织资产：登录人主部门，org 维度过滤/展示可直接引用
        authParams.put("userDepartmentId", userDeptRepository.findPrimaryDeptIdByUserId(user.getId()).orElse(null));
        authParams.put("userDepartment", userDeptRepository.findPrimaryDeptNameByUserId(user.getId()).orElse(null));
    }

    /**
     * 预览身份切换（preview-as）：设计者以指定平台用户身份执行查询（this.auth 取该用户），
     * 用于验证"我的数据"类查询的数据隔离——不同账号预览必须得到不同结果集。
     * 仅限应用所有者使用：预览是设计期能力，不向普通使用者开放身份代理。
     */
    public RunQueryResponse runPreviewAs(Long id, RunQueryRequest request, Long targetUserId, Long operatorId) {
        Query query = queryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("查询不存在"));
        Application app = applicationRepository.findById(query.getApplicationId())
                .orElseThrow(() -> new IllegalArgumentException("查询所属应用不存在"));
        if (!app.getCreatedBy().equals(operatorId)) {
            throw new IllegalArgumentException("仅应用所有者可使用预览身份切换");
        }
        return executeQuery(id, request, targetUserId);
    }

    public RunQueryResponse executeSql(Long datasourceId, String sql) {
        Datasource ds = datasourceRepository.findById(datasourceId)
                .orElseThrow(() -> new IllegalArgumentException("数据源不存在"));

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof User user)) {
            throw new IllegalArgumentException("未登录或登录已过期");
        }

        // 按数据源 scope 分流：平台数据源走"用户系统权限"判定（Key 授权是外部机器调用的事，不管人）；
        // 应用自建数据源保持原归属校验
        if ("PLATFORM".equals(ds.getEffectiveScope())) {
            if (!appAccessService.canRunPlatformDatasource(user.getId(), ds.getOwnerId())) {
                throw new IllegalArgumentException("无权访问该平台数据源：请先申请所属系统的数据访问权限");
            }
        } else {
            Application app = applicationRepository.findById(ds.getOwnerId())
                    .orElseThrow(() -> new IllegalArgumentException("数据源所属应用不存在"));
            if (!app.getCreatedBy().equals(user.getId())) {
                throw new IllegalArgumentException("无权操作该数据源：数据源不属于当前用户创建的应用");
            }
        }

        assertApiKeyDatasourcePermission(datasourceId);

        Map<String, Object> config = fromJsonMap(ds.getConfig());
        return runJdbcQuery(ds.getType(), config, sql);
    }

    /**
     * X-API-Key 数据源审批校验：请求携带了有效 Key（ApiKeyAuthFilter 已验签并挂 api_key_id）
     * 时，该 Key 必须对本数据源持有 APPROVED 权限；未携带 Key 的普通用户流程不受影响。
     */
    private void assertApiKeyDatasourcePermission(Long datasourceId) {
        ServletRequestAttributes attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attrs == null) return;
        Object keyIdAttr = attrs.getRequest().getAttribute("api_key_id");
        if (!(keyIdAttr instanceof Long apiKeyId)) return;

        boolean hasPermission = apiKeyDatasourceRepository
                .findByApiKeyIdAndStatus(apiKeyId, "APPROVED").stream()
                .anyMatch(p -> p.getDatasourceId().equals(datasourceId));
        if (!hasPermission) {
            throw new IllegalArgumentException("该 API KEY 未获此数据源访问授权");
        }
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> executeSqlBatch(Long datasourceId, String sql) {
        return executeSqlBatch(datasourceId, sql, false);
    }

    /**
     * 批量 SQL：默认同一事务提交；rollback=true 时执行后回滚——测试写 SQL（触发器回写、
     * 状态守卫、扣减语义）不污染数据，替代"直接改演示数据"的测试方式。
     */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> executeSqlBatch(Long datasourceId, String sql, boolean rollback) {
        Datasource ds = datasourceRepository.findById(datasourceId)
                .orElseThrow(() -> new IllegalArgumentException("数据源不存在"));

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof User user)) {
            throw new IllegalArgumentException("未登录或登录已过期");
        }

        // 按数据源 scope 分流：平台数据源走"用户系统权限"判定（Key 授权是外部机器调用的事，不管人）；
        // 应用自建数据源保持原归属校验
        if ("PLATFORM".equals(ds.getEffectiveScope())) {
            if (!appAccessService.canRunPlatformDatasource(user.getId(), ds.getOwnerId())) {
                throw new IllegalArgumentException("无权访问该平台数据源：请先申请所属系统的数据访问权限");
            }
        } else {
            Application app = applicationRepository.findById(ds.getOwnerId())
                    .orElseThrow(() -> new IllegalArgumentException("数据源所属应用不存在"));
            if (!app.getCreatedBy().equals(user.getId())) {
                throw new IllegalArgumentException("无权操作该数据源：数据源不属于当前用户创建的应用");
            }
        }

        assertApiKeyDatasourcePermission(datasourceId);

        // 引号/注释感知分句：字符串值中的分号、语句前的注释都不会被误切
        List<String> statements = SqlUtils.splitStatements(sql);
        List<Map<String, Object>> results = new ArrayList<>();
        Map<String, Object> config = fromJsonMap(ds.getConfig());
        String url = datasourceService.buildJdbcUrl(ds.getType(), config);

        try (Connection conn = DriverManager.getConnection(url,
                String.valueOf(config.get("username")),
                datasourceService.decryptPassword(config))) {
            conn.setAutoCommit(false);
            try {
                for (String stmt : statements) {
                    RunQueryResponse resp = runJdbcQueryWithConn(conn, stmt);
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("sql", stmt.length() > 200 ? stmt.substring(0, 200) + "..." : stmt);
                    item.put("columns", resp.getColumns());
                    item.put("rows", resp.getRows());
                    item.put("totalCount", resp.getTotalCount());
                    item.put("executionTime", resp.getExecutionTime());
                    item.put("insertId", resp.getInsertId());
                    results.add(item);
                }
                if (rollback) {
                    conn.rollback();
                } else {
                    conn.commit();
                }
            } catch (Exception e) {
                conn.rollback();
                throw e;
            }
        } catch (Exception e) {
            throw new RuntimeException((rollback ? "回滚模式 SQL 执行失败: " : "批量 SQL 执行失败: ") + e.getMessage());
        }

        if (rollback) {
            results.forEach(item -> item.put("rolledBack", true));
        }
        return results;
    }

    private RunQueryResponse runJdbcQueryWithConn(Connection conn, String sql) throws SQLException {
        long startTime = System.currentTimeMillis();
        String trimmedSql = sql.trim();

        boolean isQuery = isQueryStatement(trimmedSql);

        try (Statement stmt = conn.createStatement()) {
            if (isQuery) {
                try (ResultSet rs = stmt.executeQuery(trimmedSql)) {
                    ResultSetMetaData meta = rs.getMetaData();
                    int colCount = meta.getColumnCount();

                    List<String> columns = new ArrayList<>();
                    for (int i = 1; i <= colCount; i++) {
                        columns.add(meta.getColumnLabel(i));
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
                    return new RunQueryResponse(columns, rows, rows.size(), executionTime, trimmedSql);
                }
            } else {
                UpdateOutcome outcome = executeUpdateReturningKey(conn, trimmedSql);
                long executionTime = System.currentTimeMillis() - startTime;
                return new RunQueryResponse(Collections.emptyList(), Collections.emptyList(),
                        outcome.affectedRows(), executionTime, trimmedSql, outcome.insertId());
            }
        }
    }

    /** 按首关键词判断是否为查询语句（跳过前导注释，注释开头的 SELECT 不会被误判为写语句）。 */
    private boolean isQueryStatement(String sql) {
        return switch (SqlUtils.firstKeyword(sql)) {
            case "SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "WITH" -> true;
            default -> false;
        };
    }

    /** 写执行结果：受影响行数 + 自增主键（非自增/无主键时 insertId 为 null） */
    private record UpdateOutcome(long affectedRows, Long insertId) {}

    /**
     * 执行写 SQL 并取回自增主键。审批回写场景依赖 insertId：
     * 页面拿到主键后放进 startWorkflow 的 formData，触发器才能定位业务记录。
     */
    private UpdateOutcome executeUpdateReturningKey(Connection conn, String sql) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            long affectedRows = ps.executeUpdate();
            Long insertId = null;
            try (ResultSet keys = ps.getGeneratedKeys()) {
                if (keys.next()) {
                    insertId = keys.getLong(1);
                    if (keys.wasNull()) {
                        insertId = null;
                    }
                }
            }
            return new UpdateOutcome(affectedRows, insertId);
        }
    }

    private void validateResolvedSql(String sql) {
        if (sql == null || sql.trim().isEmpty()) {
            throw new IllegalArgumentException("解析后的 SQL 为空，请检查查询模板和参数");
        }
        // 清理模板解析后残留的连续空行，避免 jsqlparser 解析失败
        sql = sql.replaceAll("\\n{2,}", "\n").trim();
        try {
            net.sf.jsqlparser.statement.Statement stmt = CCJSqlParserUtil.parse(sql);
            if (stmt instanceof Update update) {
                if (update.getUpdateSets() == null || update.getUpdateSets().isEmpty()) {
                    throw new IllegalArgumentException("UPDATE 语句缺少 SET 子句（所有更新字段条件不满足），请检查参数是否为空");
                }
                if (update.getWhere() == null) {
                    throw new IllegalArgumentException("UPDATE 语句缺少 WHERE 条件，禁止全表更新");
                }
                checkEqualsNull(update.getWhere(), "UPDATE WHERE");
            } else if (stmt instanceof Delete delete) {
                if (delete.getWhere() == null) {
                    throw new IllegalArgumentException("DELETE 语句缺少 WHERE 条件，禁止全表删除");
                }
                checkEqualsNull(delete.getWhere(), "DELETE WHERE");
            }
        } catch (JSQLParserException e) {
            AgentLogger.bug("bug-sql-parse.log", "SQL 解析失败: " + sql + " | " + e.getMessage());
            throw new IllegalArgumentException("SQL 语法解析失败，请检查生成的 SQL: " + e.getMessage());
        }
    }

    private void checkEqualsNull(Expression expr, String context) {
        if (expr instanceof EqualsTo eq) {
            if (eq.getRightExpression() instanceof NullValue || eq.getLeftExpression() instanceof NullValue) {
                throw new IllegalArgumentException(
                    context + " 中包含 = NULL，这永远为 false。如需判断 NULL 请使用 IS NULL，如需确保参数非空请在查询模板中用 <if> 标签保护");
            }
        }
        if (expr instanceof AndExpression and) {
            checkEqualsNull(and.getLeftExpression(), context);
            checkEqualsNull(and.getRightExpression(), context);
        } else if (expr instanceof OrExpression or) {
            checkEqualsNull(or.getLeftExpression(), context);
            checkEqualsNull(or.getRightExpression(), context);
        } else if (expr instanceof Parenthesis paren) {
            checkEqualsNull(paren.getExpression(), context);
        }
    }

    private RunQueryResponse runJdbcQuery(String type, Map<String, Object> config, String sql) {
        validateResolvedSql(sql);
        String url = datasourceService.buildJdbcUrl(type, config);
        long startTime = System.currentTimeMillis();

        String trimmedSql = sql.trim();

        boolean isQuery = isQueryStatement(trimmedSql);

        try (Connection conn = DriverManager.getConnection(url,
                String.valueOf(config.get("username")),
                datasourceService.decryptPassword(config));
             Statement stmt = conn.createStatement()) {

            if (isQuery) {
                try (ResultSet rs = stmt.executeQuery(trimmedSql)) {
                    ResultSetMetaData meta = rs.getMetaData();
                    int colCount = meta.getColumnCount();

                    List<String> columns = new ArrayList<>();
                    for (int i = 1; i <= colCount; i++) {
                        columns.add(meta.getColumnLabel(i));
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
                    return new RunQueryResponse(columns, rows, rows.size(), executionTime, trimmedSql);
                }
            } else {
                UpdateOutcome outcome = executeUpdateReturningKey(conn, trimmedSql);
                long executionTime = System.currentTimeMillis() - startTime;
                return new RunQueryResponse(Collections.emptyList(), Collections.emptyList(),
                        outcome.affectedRows(), executionTime, trimmedSql, outcome.insertId());
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
                    return new RunQueryResponse(columns, rows, 1, executionTime, endpoint);
                } catch (Exception e) {
                    try {
                        List<Map<String, Object>> list = objectMapper.readValue(response.body(),
                                new TypeReference<List<Map<String, Object>>>() {});
                        List<String> columns = list.isEmpty() ? List.of("result") : new ArrayList<>(list.get(0).keySet());
                        List<List<Object>> rows = list.stream()
                                .map(m -> columns.stream().map(m::get).toList())
                                .collect(Collectors.toList());
                        return new RunQueryResponse(columns, new ArrayList<>(rows), rows.size(), executionTime, endpoint);
                    } catch (Exception e2) {
                        return new RunQueryResponse(
                                List.of("status", "body"),
                                List.of(List.of(response.statusCode(), response.body())),
                                1, executionTime, endpoint);
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
        // 硬失败：模板引用了 this.auth 但当前上下文没有任何用户身份。
        // 绝不能静默渲染成 NULL——"WHERE user_id = NULL 命中 0 行还被当成执行成功"
        // 是最危险的静默断链（无会话的系统调用必须以发起人身份执行）。
        if ((authParams == null || authParams.isEmpty()) && body.contains("this.auth.")) {
            throw new IllegalArgumentException(
                    "查询模板使用了 {{ this.auth.* }}，但当前执行上下文没有用户身份（无会话的"
                    + "系统调用必须以发起人身份执行，请检查调用路径的身份注入）");
        }
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
            condition = condition.replaceAll("\\bthis\\.", "");
            assertSafeOgnlExpression(condition);
            Map<String, Object> wrapper = new HashMap<>();
            wrapper.put("params", params);
            OgnlContext ctx = new OgnlContext(null, null, RESTRICTED);
            ctx.setRoot(wrapper);
            Object result = Ognl.getValue(Ognl.parseExpression(condition), ctx, wrapper);
            boolean boolResult = result instanceof Boolean ? (Boolean) result : false;
            AgentLogger.debug("bug-if-tag.log",
                String.format("OGNL条件求值: [%s] → %s | params=%s",
                    condition, boolResult, params));
            return boolResult;
        } catch (Exception e) {
            AgentLogger.bug("bug-if-tag.log",
                String.format("OGNL条件求值异常: [%s] | 错误: %s | params=%s",
                    condition, e.getMessage(), params));
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
        // 第一遍：替换简单引用 {{ this.params.xxx }}
        Pattern simplePattern = Pattern.compile("\\{\\{\\s*this\\.params\\.(\\w+)\\s*\\}\\}");
        Matcher simpleMatcher = simplePattern.matcher(body);
        StringBuilder sb = new StringBuilder();
        while (simpleMatcher.find()) {
            String key = simpleMatcher.group(1);
            Object value = params.get(key);
            String replacement = value != null ? formatSqlValue(value) : "NULL";
            simpleMatcher.appendReplacement(sb, Matcher.quoteReplacement(replacement));
        }
        simpleMatcher.appendTail(sb);
        String afterSimple = sb.toString();

        // 第二遍：处理表达式 {{ ... }}（如 {{ (this.params.pageNum - 1) * this.params.pageSize }}）
        Pattern exprPattern = Pattern.compile("\\{\\{\\s*(.+?)\\s*\\}\\}");
        Matcher exprMatcher = exprPattern.matcher(afterSimple);
        StringBuilder sb2 = new StringBuilder();
        while (exprMatcher.find()) {
            String expr = exprMatcher.group(1).trim();
            String replacement = evaluateOgnlExpression(expr, params);
            exprMatcher.appendReplacement(sb2, Matcher.quoteReplacement(replacement));
        }
        exprMatcher.appendTail(sb2);
        String afterExpr = sb2.toString();

        // 第三遍：替换命名参数 :param_name（排除 PostgreSQL :: 类型转换）
        Pattern namedPattern = Pattern.compile("(?<!:):(\\w+)");
        Matcher namedMatcher = namedPattern.matcher(afterExpr);
        StringBuilder sb3 = new StringBuilder();
        while (namedMatcher.find()) {
            String key = namedMatcher.group(1);
            Object value = params.get(key);
            if (value != null) {
                namedMatcher.appendReplacement(sb3, Matcher.quoteReplacement(formatSqlValue(value)));
            } else {
                namedMatcher.appendReplacement(sb3, "NULL");
            }
        }
        namedMatcher.appendTail(sb3);
        return sb3.toString();
    }

    private String evaluateOgnlExpression(String expr, Map<String, Object> params) {
        try {
            expr = expr.replaceAll("\\bthis\\.", "");
            assertSafeOgnlExpression(expr);
            Map<String, Object> wrapper = new HashMap<>();
            wrapper.put("params", params);
            OgnlContext ctx = new OgnlContext(null, null, RESTRICTED);
            ctx.setRoot(wrapper);
            Object result = Ognl.getValue(Ognl.parseExpression(expr), ctx, wrapper);
            String formatted = result != null ? formatSqlValue(result) : "NULL";
            AgentLogger.debug("bug-if-tag.log",
                String.format("OGNL表达式求值: [%s] → %s", expr, formatted));
            return formatted;
        } catch (Exception e) {
            AgentLogger.bug("bug-if-tag.log",
                String.format("OGNL表达式求值失败: [%s] | 错误: %s", expr, e.getMessage()));
            return "NULL";
        }
    }

    private String formatSqlValue(Object value) {
        if (value instanceof Number) return value.toString();
        if (value instanceof Boolean) return ((Boolean) value) ? "1" : "0";
        return "'" + value.toString().replace("'", "''") + "'";
    }

    private Map<String, Object> buildQueryMap(Query q) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", q.getId());
        map.put("applicationId", q.getApplicationId());
        map.put("datasourceId", q.getDatasourceId());
        map.put("name", q.getName());
        map.put("body", q.getBody());
        map.put("params", fromJsonMap(q.getParams()));
        map.put("description", q.getDescription());
        map.put("source", q.getSource());
        map.put("publishedGroupId", q.getPublishedGroupId());
        map.put("createdAt", q.getCreatedAt());
        return map;
    }
}