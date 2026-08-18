package com.luban.config;

import com.luban.entity.*;
import com.luban.repository.*;
import com.luban.util.AesEncryptUtil;
import com.luban.util.Ed25519Util;
import com.luban.workflow.entity.*;
import com.luban.workflow.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.security.KeyPair;
import java.time.LocalDateTime;

@Slf4j
@Component
@RequiredArgsConstructor
public class PlatformSeedDataInitializer implements CommandLineRunner {

    private final RoleRepository roleRepository;
    private final WorkflowDefinitionRepository workflowDefinitionRepository;
    private final ToolGroupRepository toolGroupRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final AgentConfigRepository agentConfigRepository;
    private final ConceptRepository conceptRepository;
    private final ConceptRelationRepository conceptRelationRepository;
    private final ToolConceptRepository toolConceptRepository;
    private final JdbcTemplate jdbcTemplate;

    @Override
    @Transactional
    public void run(String... args) {
        initPlatformRoles();
        initPlatformWorkflows();
        initSeedTables();
        initToolGroups();
        initDefaultAgentConfig();
        initConcepts();
    }

    private void initPlatformRoles() {
        if (roleRepository.findByScope("PLATFORM").isEmpty()) {
            log.info("初始化平台角色...");

            createRoleIfNotExists("super_admin", "超级管理员", "PLATFORM", "系统最高权限");
            createRoleIfNotExists("system_admin", "系统管理员", "PLATFORM", "负责某系统的管理");
            createRoleIfNotExists("developer", "外部开发者", "PLATFORM", "负责 API 开发集成");
            createRoleIfNotExists("user", "普通用户", "PLATFORM", "普通业务用户");

            log.info("平台角色初始化完成");
        }
    }

    private void createRoleIfNotExists(String slug, String name, String scope, String description) {
        if (roleRepository.findBySlug(slug).isEmpty()) {
            Role role = new Role();
            role.setName(name);
            role.setSlug(slug);
            role.setDescription(description);
            role.setScope(scope);
            role.setMemberIds("[]");
            roleRepository.save(role);
        }
    }

    private void initPlatformWorkflows() {
        if (workflowDefinitionRepository.findByScope("PLATFORM").isEmpty()) {
            log.info("初始化平台工作流...");

            WorkflowDefinition systemPermWf = new WorkflowDefinition();
            systemPermWf.setName("系统权限审批");
            systemPermWf.setDescription("员工申请系统权限，需直属领导审批 → 部门负责人审批");
            systemPermWf.setScope("PLATFORM");
            systemPermWf.setVersion(1);
            systemPermWf.setStatus("PUBLISHED");
            systemPermWf.setCreatedBy(0L);
            systemPermWf.setNodes("[" +
                    "{\"nodeId\":\"start\",\"nodeType\":\"start\",\"label\":\"开始\"}," +
                    "{\"nodeId\":\"leader_approve\",\"nodeType\":\"approve\",\"label\":\"直属领导审批\",\"config\":{\"approverType\":\"leader\",\"collaborationMode\":\"all_pass\"}}," +
                    "{\"nodeId\":\"dept_head_approve\",\"nodeType\":\"approve\",\"label\":\"部门负责人审批\",\"config\":{\"approverType\":\"department_head\",\"collaborationMode\":\"all_pass\"}}," +
                    "{\"nodeId\":\"end\",\"nodeType\":\"end\",\"label\":\"结束\"}" +
                    "]");
            systemPermWf.setEdges("[" +
                    "{\"source\":\"start\",\"target\":\"leader_approve\"}," +
                    "{\"source\":\"leader_approve\",\"target\":\"dept_head_approve\"}," +
                    "{\"source\":\"dept_head_approve\",\"target\":\"end\"}" +
                    "]");
            workflowDefinitionRepository.save(systemPermWf);

            WorkflowDefinition toolPermWf = new WorkflowDefinition();
            toolPermWf.setName("工具权限审批");
            toolPermWf.setDescription("外部开发者申请工具权限，需系统管理员审批");
            toolPermWf.setScope("PLATFORM");
            toolPermWf.setVersion(1);
            toolPermWf.setStatus("PUBLISHED");
            toolPermWf.setCreatedBy(0L);
            toolPermWf.setNodes("[" +
                    "{\"nodeId\":\"start\",\"nodeType\":\"start\",\"label\":\"开始\"}," +
                    "{\"nodeId\":\"admin_approve\",\"nodeType\":\"approve\",\"label\":\"系统管理员审批\",\"config\":{\"approverType\":\"role\",\"roleSlugs\":[\"system_admin\"],\"collaborationMode\":\"any_pass\"}}," +
                    "{\"nodeId\":\"end\",\"nodeType\":\"end\",\"label\":\"结束\"}" +
                    "]");
            toolPermWf.setEdges("[" +
                    "{\"source\":\"start\",\"target\":\"admin_approve\"}," +
                    "{\"source\":\"admin_approve\",\"target\":\"end\"}" +
                    "]");
            workflowDefinitionRepository.save(toolPermWf);

            log.info("平台工作流初始化完成");
        }
    }

    private void initSeedTables() {
        try {
            jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS daily_output (" +
                    "id BIGINT AUTO_INCREMENT PRIMARY KEY, " +
                    "date DATE NOT NULL, " +
                    "output INT NOT NULL, " +
                    "qualified INT NOT NULL, " +
                    "defect_rate DECIMAL(5,2) NOT NULL, " +
                    "workshop VARCHAR(64) NOT NULL, " +
                    "UNIQUE KEY uk_date_workshop (date, workshop)" +
                    ")");

            jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS devices (" +
                    "id BIGINT AUTO_INCREMENT PRIMARY KEY, " +
                    "device_id VARCHAR(32) NOT NULL, " +
                    "device_name VARCHAR(128) NOT NULL, " +
                    "device_type VARCHAR(64) NOT NULL, " +
                    "status VARCHAR(32) NOT NULL, " +
                    "workshop VARCHAR(64) NOT NULL, " +
                    "last_maintenance DATE, " +
                    "UNIQUE KEY uk_device_id (device_id)" +
                    ")");

            Integer count = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM daily_output", Integer.class);
            if (count != null && count == 0) {
                jdbcTemplate.update(
                        "INSERT INTO daily_output (date, output, qualified, defect_rate, workshop) VALUES " +
                                "('2026-08-10', 1200, 1180, 1.67, 'A车间')," +
                                "('2026-08-10', 950, 930, 2.11, 'B车间')," +
                                "('2026-08-10', 800, 790, 1.25, 'C车间')," +
                                "('2026-08-11', 1150, 1130, 1.74, 'A车间')," +
                                "('2026-08-11', 980, 960, 2.04, 'B车间')," +
                                "('2026-08-11', 820, 810, 1.22, 'C车间')," +
                                "('2026-08-12', 1300, 1280, 1.54, 'A车间')," +
                                "('2026-08-12', 1020, 1000, 1.96, 'B车间')," +
                                "('2026-08-12', 850, 840, 1.18, 'C车间')," +
                                "('2026-08-13', 980, 970, 1.02, 'A车间')," +
                                "('2026-08-13', 900, 880, 2.22, 'B车间')," +
                                "('2026-08-13', 780, 770, 1.28, 'C车间')," +
                                "('2026-08-14', 1050, 1030, 1.90, 'A车间')," +
                                "('2026-08-14', 920, 900, 2.17, 'B车间')," +
                                "('2026-08-14', 800, 790, 1.25, 'C车间')," +
                                "('2026-08-15', 1100, 1080, 1.82, 'A车间')," +
                                "('2026-08-15', 950, 930, 2.11, 'B车间')," +
                                "('2026-08-15', 830, 820, 1.20, 'C车间')");
                log.info("日产量种子数据初始化完成（18 条）");
            }

            Integer devCount = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM devices", Integer.class);
            if (devCount != null && devCount == 0) {
                jdbcTemplate.update(
                        "INSERT INTO devices (device_id, device_name, device_type, status, workshop, last_maintenance) VALUES " +
                                "('CNC-01', 'CNC加工中心-01', 'CNC', '运行中', 'A车间', '2026-07-20')," +
                                "('CNC-02', 'CNC加工中心-02', 'CNC', '待机', 'A车间', '2026-07-15')," +
                                "('CNC-03', 'CNC加工中心-03', 'CNC', '维修中', 'B车间', '2026-06-10')," +
                                "('ROBOT-01', '焊接机器人-01', 'ROBOT', '运行中', 'B车间', '2026-07-25')," +
                                "('ROBOT-02', '焊接机器人-02', 'ROBOT', '待机', 'B车间', '2026-08-01')," +
                                "('INJ-01', '注塑机-01', 'INJECTION', '待机', 'C车间', '2026-07-30')," +
                                "('INJ-02', '注塑机-02', 'INJECTION', '运行中', 'C车间', '2026-08-05')," +
                                "('AGV-01', '自动搬运车-01', 'AGV', '运行中', 'A车间', '2026-07-28')");
                log.info("设备清单种子数据初始化完成（8 条）");
            }
        } catch (Exception e) {
            log.warn("种子表初始化跳过（可能已存在）: {}", e.getMessage());
        }
    }

    private void initToolGroups() {
        if (toolGroupRepository.findByCode("mes").isEmpty()) {
            log.info("初始化 MES系统 工具组...");

            ToolGroup mesGroup = createToolGroup(
                    "MES系统", "mes",
                    "制造执行系统，管理设备状态、生产数据、维保工单",
                    "当用户询问设备状态、产量、生产、工单、CNC、维修相关问题时使用此系统",
                    "factory", 0);
            Long mesGroupId = mesGroup.getId();

            createToolIfNotExists(mesGroupId, "query_device_status", "查询设备状态",
                    "HTTP", "根据设备编号查询设备当前运行状态、主轴转速、今日产量等信息",
                    "{\"type\":\"object\",\"properties\":{\"device_id\":{\"type\":\"string\",\"description\":\"设备编号，如 CNC-07\"}},\"required\":[\"device_id\"]}",
                    "{\"url\":\"http://localhost:8080/api/v1/mock-mes/device/{device_id}/status\",\"method\":\"GET\",\"timeout\":10,\"retry\":3}");

            createToolIfNotExists(mesGroupId, "create_work_order", "创建维修工单",
                    "HTTP", "为指定设备创建维修工单",
                    "{\"type\":\"object\",\"properties\":{\"device_id\":{\"type\":\"string\",\"description\":\"设备编号\"},\"description\":{\"type\":\"string\",\"description\":\"故障描述\"},\"priority\":{\"type\":\"string\",\"enum\":[\"LOW\",\"NORMAL\",\"HIGH\",\"URGENT\"],\"description\":\"优先级\"}},\"required\":[\"device_id\",\"description\"]}",
                    "{\"url\":\"http://localhost:8080/api/v1/mock-mes/work-order\",\"method\":\"POST\",\"timeout\":10,\"retry\":3}");

            createToolIfNotExists(mesGroupId, "query_production_stats", "查询产量统计",
                    "HTTP", "查询指定时间范围内的产量统计数据，含每日产量和设备产量明细",
                    "{\"type\":\"object\",\"properties\":{\"startDate\":{\"type\":\"string\",\"description\":\"开始日期，格式 yyyy-MM-dd\"},\"endDate\":{\"type\":\"string\",\"description\":\"结束日期，格式 yyyy-MM-dd\"}},\"required\":[\"startDate\",\"endDate\"]}",
                    "{\"url\":\"http://localhost:8080/api/v1/mock-mes/production/stats?startDate={startDate}&endDate={endDate}\",\"method\":\"GET\",\"timeout\":10,\"retry\":3}");

            log.info("MES系统工具组初始化完成（3 个 HTTP 工具）");
        }

        if (toolGroupRepository.findByCode("data_query").isEmpty()) {
            log.info("初始化 数据查询 工具组...");

            ToolGroup dataGroup = createToolGroup(
                    "数据查询", "data_query",
                    "企业数据查询，包含日产量查询和设备列表查询",
                    "当用户询问产量统计、设备清单、生产报表相关问题时使用此系统",
                    "database", 1);
            Long dataGroupId = dataGroup.getId();

            createToolIfNotExists(dataGroupId, "query_daily_output", "查询日产量",
                    "SQL", "查询每日产量数据，按日期范围筛选",
                    "{\"type\":\"object\",\"properties\":{\"startDate\":{\"type\":\"string\",\"description\":\"开始日期\"},\"endDate\":{\"type\":\"string\",\"description\":\"结束日期\"}}}",
                    "{\"queryId\":null,\"datasourceId\":null,\"sql\":\"SELECT date, output, qualified, defect_rate FROM daily_output WHERE date BETWEEN '${startDate}' AND '${endDate}' ORDER BY date\",\"maxRows\":1000,\"readOnly\":true}");

            createToolIfNotExists(dataGroupId, "query_device_list", "查询设备列表",
                    "SQL", "查询设备清单，按状态筛选",
                    "{\"type\":\"object\",\"properties\":{\"status\":{\"type\":\"string\",\"description\":\"设备状态筛选：运行中/待机/维修中/停机\"}}}",
                    "{\"queryId\":null,\"datasourceId\":null,\"sql\":\"SELECT device_id, device_name, device_type, status, workshop, last_maintenance FROM devices\",\"maxRows\":1000,\"readOnly\":true}");

            log.info("数据查询工具组初始化完成（2 个 SQL 工具）");
        }
    }

    private ToolGroup createToolGroup(String name, String code, String description, String systemPromptHint, String icon, int sortOrder) {
        ToolGroup group = new ToolGroup();
        group.setName(name);
        group.setCode(code);
        group.setDescription(description);
        group.setSystemPromptHint(systemPromptHint);
        group.setIcon(icon);
        group.setSortOrder(sortOrder);
        group.setStatus("ENABLED");
        generateKeyPair(group);
        return toolGroupRepository.save(group);
    }

    private void createToolIfNotExists(Long groupId, String name, String displayName,
                                        String toolType, String description,
                                        String inputSchema, String config) {
        if (toolDefinitionRepository.findByName(name).isEmpty()) {
            ToolDefinition tool = new ToolDefinition();
            tool.setName(name);
            tool.setDisplayName(displayName);
            tool.setToolType(toolType);
            tool.setDescription(description);
            tool.setInputSchema(inputSchema);
            tool.setConfig(config);
            tool.setGroupId(groupId);
            tool.setStatus("ENABLED");
            toolDefinitionRepository.save(tool);
        }
    }

    private void initDefaultAgentConfig() {
        if (agentConfigRepository.findByIsDefaultTrue().isEmpty()) {
            log.info("初始化默认 Agent 配置...");

            AgentConfig config = new AgentConfig();
            config.setName("Default Agent");
            config.setModelEndpoint("https://api.openai.com/v1/chat/completions");
            config.setModelName("gpt-4o");
            config.setSecretKeyEnc("");
            config.setIsDefault(true);
            config.setStatus("ENABLED");
            agentConfigRepository.save(config);

            log.info("默认 Agent 配置初始化完成");
        }
    }

    private void initConcepts() {
        if (conceptRepository.count() > 0) {
            return;
        }
        log.info("初始化概念本体层种子数据...");

        Concept hrEmployeeTotal = createConcept("员工总数", null, "企业全体员工的总人数");
        Concept hrDeptCount = createConcept("部门人数", hrEmployeeTotal.getId(), "单个部门的员工人数");
        Concept hrResignedCount = createConcept("离职人数", null, "统计周期内离职的员工人数");
        Concept hrResignedRate = createConcept("离职比例", null, "离职人数占员工总数的比例");
        Concept hrDeptList = createConcept("部门列表", null, "企业所有部门的清单");

        createRelation(hrEmployeeTotal.getId(), hrDeptCount.getId(), "PARENT_OF", null, "员工总数包含各部门人数");
        createRelation(hrResignedRate.getId(), hrResignedCount.getId(), "COMPUTED_FROM", "离职人数 / 员工总数", "离职比例由离职人数和员工总数计算");
        createRelation(hrResignedRate.getId(), hrEmployeeTotal.getId(), "COMPUTED_FROM", "离职人数 / 员工总数", "离职比例由离职人数和员工总数计算");

        Concept mesMetric = createConcept("生产指标", null, "制造执行系统的核心生产指标");
        Concept mesOEE = createConcept("OEE", mesMetric.getId(), "设备综合效率，Overall Equipment Effectiveness");
        Concept mesAvailability = createConcept("可用率", null, "设备实际可用时间与计划生产时间的比率");
        Concept mesPerformance = createConcept("性能率", null, "实际生产速度与理论生产速度的比率");
        Concept mesQuality = createConcept("质量率", null, "良品数与总产出数的比率");
        Concept mesYieldRate = createConcept("良品率", mesMetric.getId(), "良品数占总产出的比例");
        Concept mesGoodCount = createConcept("良品数", null, "合格产品的数量");
        Concept mesTotalOutput = createConcept("总产出", null, "生产线的总产出数量");
        Concept mesCapacityUtil = createConcept("产能利用率", mesMetric.getId(), "实际产出与设计产能的比率");
        Concept mesActualOutput = createConcept("实际产出", null, "统计周期内的实际产量");
        Concept mesDesignCapacity = createConcept("设计产能", null, "生产线设计的理论最大产能");

        createRelation(mesOEE.getId(), mesAvailability.getId(), "COMPUTED_FROM", "可用率 × 性能率 × 质量率", "OEE由可用率、性能率、质量率计算");
        createRelation(mesOEE.getId(), mesPerformance.getId(), "COMPUTED_FROM", "可用率 × 性能率 × 质量率", "OEE由可用率、性能率、质量率计算");
        createRelation(mesOEE.getId(), mesQuality.getId(), "COMPUTED_FROM", "可用率 × 性能率 × 质量率", "OEE由可用率、性能率、质量率计算");
        createRelation(mesYieldRate.getId(), mesGoodCount.getId(), "COMPUTED_FROM", "良品数 / 总产出", "良品率由良品数和总产出计算");
        createRelation(mesYieldRate.getId(), mesTotalOutput.getId(), "COMPUTED_FROM", "良品数 / 总产出", "良品率由良品数和总产出计算");
        createRelation(mesCapacityUtil.getId(), mesActualOutput.getId(), "COMPUTED_FROM", "实际产出 / 设计产能", "产能利用率由实际产出和设计产能计算");
        createRelation(mesCapacityUtil.getId(), mesDesignCapacity.getId(), "COMPUTED_FROM", "实际产出 / 设计产能", "产能利用率由实际产出和设计产能计算");

        Concept schPlan = createConcept("排产计划", null, "智能排产生成的车间生产计划");
        Concept schOrder = createConcept("订单信息", schPlan.getId(), "待排产的客户订单信息");
        Concept schDeviceCap = createConcept("设备产能", schPlan.getId(), "各设备的可用产能信息");
        Concept schMaterialStock = createConcept("物料库存", schPlan.getId(), "生产所需物料的库存信息");
        Concept schKitRate = createConcept("物料齐套率", null, "已齐套订单数占总订单数的比例");
        Concept schKitComplete = createConcept("已齐套订单数", null, "物料已齐套的订单数量");
        Concept schTotalOrders = createConcept("总订单数", null, "待排产的总订单数量");

        createRelation(schPlan.getId(), schOrder.getId(), "PREREQUISITE_OF", null, "排产需要订单信息");
        createRelation(schPlan.getId(), schDeviceCap.getId(), "PREREQUISITE_OF", null, "排产需要设备产能数据");
        createRelation(schPlan.getId(), schMaterialStock.getId(), "PREREQUISITE_OF", null, "排产需要物料库存数据");
        createRelation(schKitRate.getId(), schKitComplete.getId(), "COMPUTED_FROM", "已齐套订单数 / 总订单数", "物料齐套率由已齐套订单数和总订单数计算");
        createRelation(schKitRate.getId(), schTotalOrders.getId(), "COMPUTED_FROM", "已齐套订单数 / 总订单数", "物料齐套率由已齐套订单数和总订单数计算");

        Concept procGroup = createConcept("工序", null, "生产工艺的工序集合");
        Concept procA = createConcept("工序A:冲压", procGroup.getId(), "冲压成型工序");
        Concept procB = createConcept("工序B:焊接", procGroup.getId(), "焊接组装工序");
        Concept procC = createConcept("工序C:喷涂", procGroup.getId(), "表面喷涂工序");
        Concept procAOutput = createConcept("工序A产出", null, "冲压工序的产出件");
        Concept procBInput = createConcept("工序B投入", null, "焊接工序的投入件");
        Concept procBOutput = createConcept("工序B产出", null, "焊接工序的产出件");
        Concept procCInput = createConcept("工序C投入", null, "喷涂工序的投入件");

        createRelation(procA.getId(), procAOutput.getId(), "UPPER_STREAM_OF", null, "工序A产出流向工序B");
        createRelation(procAOutput.getId(), procBInput.getId(), "UPPER_STREAM_OF", null, "工序A产出即为工序B投入");
        createRelation(procB.getId(), procBOutput.getId(), "UPPER_STREAM_OF", null, "工序B产出流向工序C");
        createRelation(procBOutput.getId(), procCInput.getId(), "UPPER_STREAM_OF", null, "工序B产出即为工序C投入");

        Concept factory = createConcept("工厂", null, "生产制造工厂");
        Concept workshop = createConcept("车间", factory.getId(), "工厂下的生产车间");
        Concept line = createConcept("产线", workshop.getId(), "车间内的生产线");
        Concept device = createConcept("设备", line.getId(), "产线上的生产设备");
        Concept deviceStatus = createConcept("设备状态", null, "设备的当前运行状态");

        createRelation(device.getId(), deviceStatus.getId(), "DERIVED_FROM", null, "设备状态由设备运行数据推导");

        Concept mesGoodCount2 = createConcept("MES.良品数", null, "MES系统中的良品数概念");
        Concept qmsQualified = createConcept("QMS.合格品数", null, "QMS系统中的合格品数概念");

        createRelation(mesGoodCount2.getId(), qmsQualified.getId(), "EQUIVALENT_TO", null, "MES良品数等同于QMS合格品数");

        ToolDefinition deviceStatusTool = toolDefinitionRepository.findByName("query_device_status").orElse(null);
        ToolDefinition prodStatsTool = toolDefinitionRepository.findByName("query_production_stats").orElse(null);
        ToolDefinition dailyOutputTool = toolDefinitionRepository.findByName("query_daily_output").orElse(null);
        ToolDefinition deviceListTool = toolDefinitionRepository.findByName("query_device_list").orElse(null);

        if (deviceStatusTool != null) {
            bindToolConcept(deviceStatusTool.getId(), deviceStatus.getId(), "PRODUCES");
        }
        if (prodStatsTool != null) {
            bindToolConcept(prodStatsTool.getId(), mesTotalOutput.getId(), "PRODUCES");
            bindToolConcept(prodStatsTool.getId(), mesGoodCount.getId(), "PRODUCES");
        }
        if (dailyOutputTool != null) {
            bindToolConcept(dailyOutputTool.getId(), mesTotalOutput.getId(), "PRODUCES");
            bindToolConcept(dailyOutputTool.getId(), mesGoodCount.getId(), "PRODUCES");
        }
        if (deviceListTool != null) {
            bindToolConcept(deviceListTool.getId(), hrDeptList.getId(), "PRODUCES");
        }

        // 阈值语义：产能利用率 > 90% → 产能紧张
        Concept mesCapacityStressed = createConcept("产能紧张", null, "产能利用率超过阈值，生产线处于高负荷状态");
        createRelation(mesCapacityStressed.getId(), mesCapacityUtil.getId(), "DERIVED_FROM", ">90%", "产能紧张由产能利用率超过 90% 阈值推导");

        log.info("概念本体层种子数据初始化完成：{} 个概念，{} 个关系，{} 个工具绑定",
                conceptRepository.count(),
                conceptRelationRepository.count(),
                toolConceptRepository.count());
    }

    private Concept createConcept(String name, Long parentId, String description) {
        Concept concept = new Concept();
        concept.setName(name);
        concept.setParentId(parentId);
        concept.setDescription(description);
        return conceptRepository.save(concept);
    }

    private ConceptRelation createRelation(Long sourceId, Long targetId, String relationType, String expression, String description) {
        ConceptRelation relation = new ConceptRelation();
        relation.setSourceConceptId(sourceId);
        relation.setTargetConceptId(targetId);
        relation.setRelationType(relationType);
        relation.setExpression(expression);
        relation.setDescription(description);
        return conceptRelationRepository.save(relation);
    }

    private void bindToolConcept(Long toolId, Long conceptId, String relation) {
        ToolConcept binding = new ToolConcept();
        binding.setToolId(toolId);
        binding.setConceptId(conceptId);
        binding.setRelation(relation);
        toolConceptRepository.save(binding);
    }

    private void generateKeyPair(ToolGroup group) {
        try {
            KeyPair keyPair = Ed25519Util.generateKeyPair();
            group.setPublicKey(Ed25519Util.encodePublicKey(keyPair.getPublic()));
            String privateKeyStr = Ed25519Util.encodePrivateKey(keyPair.getPrivate());
            group.setPrivateKeyEnc(AesEncryptUtil.encrypt(privateKeyStr));
            group.setKeyPairCreatedAt(LocalDateTime.now());
            log.info("Ed25519 密钥对已生成: system={}", group.getCode());
        } catch (Exception e) {
            log.error("Ed25519 密钥对生成失败: system={}", group.getCode(), e);
        }
    }
}