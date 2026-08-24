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
import java.util.List;
import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class PlatformSeedDataInitializer implements CommandLineRunner {

    private final RoleRepository roleRepository;
    private final RoleUserRepository roleUserRepository;
    private final WorkflowDefinitionRepository workflowDefinitionRepository;
    private final ToolGroupRepository toolGroupRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final AgentConfigRepository agentConfigRepository;
    private final UserRepository userRepository;
    private final MemberRepository memberRepository;
    private final JdbcTemplate jdbcTemplate;
    private final IndustryRepository industryRepository;
    private final IndustryRelationRepository industryRelationRepository;

    @Override
    @Transactional
    public void run(String... args) {
        initPlatformRoles();
        initTestUsers();
        initPlatformWorkflows();
        initSeedTables();
        initToolGroups();
        initDefaultAgentConfig();
        initIndustries();
    }

    private void initPlatformRoles() {
        if (roleRepository.findByScope("PLATFORM").isEmpty()) {
            log.info("初始化平台角色...");

            createRoleIfNotExists("super_admin", "超级管理员", "PLATFORM", "系统最高权限");
            createRoleIfNotExists("system_admin", "系统管理员", "PLATFORM", "负责某系统的管理");
            createRoleIfNotExists("developer", "外部开发者", "PLATFORM", "负责 API 开发集成");
            createRoleIfNotExists("user", "普通用户", "PLATFORM", "普通业务用户");
            createRoleIfNotExists("flow_tester", "流程测试", "PLATFORM", "流程测试专用角色，不可删除");

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
            role.setCreatedBy(null);
            roleRepository.save(role);
        }
    }

    private void initTestUsers() {
        if (userRepository.count() > 1) {
            return;
        }

        log.info("初始化流程测试用户...");

        Role flowTester = roleRepository.findBySlug("flow_tester").orElse(null);
        if (flowTester == null) {
            flowTester = new Role();
            flowTester.setName("流程测试");
            flowTester.setSlug("flow_tester");
            flowTester.setDescription("流程测试专用角色，不可删除");
            flowTester.setScope("PLATFORM");
            flowTester.setCreatedBy(null);
            flowTester = roleRepository.save(flowTester);
        }

        String[][] testUsers = {
                {"张三", "zhangsan", "zhangsan@luban.test", "13800000001", "测试工程师", "TEST001", "测试部门"},
                {"李四", "lisi", "lisi@luban.test", "13800000002", "测试工程师", "TEST002", "测试部门"},
                {"王五", "wangwu", "wangwu@luban.test", "13800000003", "测试主管", "TEST003", "测试部门"},
                {"赵六", "zhaoliu", "zhaoliu@luban.test", "13800000004", "测试开发", "TEST004", "测试部门"},
                {"孙七", "sunqi", "sunqi@luban.test", "13800000005", "测试经理", "TEST005", "测试部门"},
        };

        for (String[] u : testUsers) {
            String name = u[0];
            String account = u[1];
            String email = u[2];
            String mobile = u[3];
            String position = u[4];
            String employeeNo = u[5];
            String deptName = u[6];

            User user = userRepository.findByEmail(email).orElse(null);
            if (user == null) {
                user = new User();
                user.setAccount(account);
                user.setEmail(email);
                user.setPassword(null);
                userRepository.save(user);
            }

            Member member = memberRepository.findByUserId(user.getId()).orElse(null);
            if (member == null) {
                member = new Member();
                member.setUserId(user.getId());
                member.setName(name);
                member.setEmail(email);
                member.setMobile(mobile);
                member.setPosition(position);
                member.setEmployeeNo(employeeNo);
                member.setDepartmentName(deptName);
                member.setProvider("local");
                member.setStatus("ACTIVE");
                memberRepository.save(member);
            }

            if (roleUserRepository.findByRoleIdAndUserId(flowTester.getId(), user.getId()).isEmpty()) {
                RoleUser ru = new RoleUser();
                ru.setRoleId(flowTester.getId());
                ru.setUserId(user.getId());
                roleUserRepository.save(ru);
            }
        }

        log.info("流程测试用户初始化完成");
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

    private void initIndustries() {
        if (industryRepository.count() > 0) {
            return;
        }
        log.info("初始化行业及关系清单...");

        Industry industry = new Industry();
        industry.setName("industrial");
        industry.setDisplayName("工业");
        industry.setDescription("工业制造领域本体关系清单");
        industry = industryRepository.save(industry);

        String[][] relations = {
                {"PARENT_OF", "概念层级包含（父→子）", "true", "false"},
                {"PART_OF", "部分-整体（子→父）", "true", "false"},
                {"KIND_OF", "继承关系（子类→父类）", "true", "false"},
                {"COMPUTED_FROM", "由其他概念计算得出", "false", "false"},
                {"DERIVED_FROM", "条件推导", "false", "false"},
                {"EQUIVALENT_TO", "跨系统/跨域等价", "true", "true"},
                {"PREREQUISITE_OF", "前置依赖", "true", "false"},
                {"UPPER_STREAM_OF", "上下游传递", "true", "false"},
                {"PRODUCES", "工具产出该概念的数据", "false", "false"},
                {"CONSUMES", "工具需要该概念的数据作为输入", "false", "false"},
        };

        for (int i = 0; i < relations.length; i++) {
            IndustryRelation rel = new IndustryRelation();
            rel.setIndustryId(industry.getId());
            rel.setRelationType(relations[i][0]);
            rel.setDescription(relations[i][1]);
            rel.setIsTransitive(Boolean.valueOf(relations[i][2]));
            rel.setIsSymmetric(Boolean.valueOf(relations[i][3]));
            rel.setSortOrder(i);
            industryRelationRepository.save(rel);
        }

        log.info("行业及关系清单初始化完成：1 个行业，{} 个关系类型", relations.length);
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