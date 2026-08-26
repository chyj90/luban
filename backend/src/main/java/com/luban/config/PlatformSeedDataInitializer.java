package com.luban.config;

import com.luban.constant.Permissions;
import com.luban.constant.WorkflowScope;
import com.luban.entity.*;
import com.luban.repository.*;
import com.luban.workflow.entity.*;
import com.luban.workflow.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Slf4j
@Component
@RequiredArgsConstructor
public class PlatformSeedDataInitializer implements CommandLineRunner {

    private final RoleRepository roleRepository;
    private final UserRepository userRepository;
    private final RoleUserRepository roleUserRepository;
    private final RolePermissionRepository rolePermissionRepository;
    private final WorkflowDefinitionRepository workflowDefinitionRepository;
    private final AgentConfigRepository agentConfigRepository;
    private final IndustryRepository industryRepository;
    private final IndustryRelationRepository industryRelationRepository;
    private final PasswordEncoder passwordEncoder;

    @Override
    @Transactional
    public void run(String... args) {
        initPlatformRoles();
        initSuperAdminPermissions();
        initRootUser();
        initPlatformWorkflows();
        initDefaultAgentConfig();
        initBuiltinRelations();
    }

    private void initPlatformRoles() {
        if (roleRepository.findByScope("PLATFORM").isEmpty()) {
            log.info("初始化平台角色...");

            createRoleIfNotExists("super_admin", "超级管理员", "PLATFORM", "系统最高权限");
            createRoleIfNotExists("system_admin", "系统管理员", "PLATFORM", "负责某系统的管理");
            createRoleIfNotExists("developer", "外部开发者", "PLATFORM", "负责 API 开发集成");
            createRoleIfNotExists("user", "普通用户", "PLATFORM", "普通业务用户");

            initUserPermissions();

            log.info("平台角色初始化完成");
        }
    }

    private void initUserPermissions() {
        Role userRole = roleRepository.findBySlug("user").orElse(null);
        if (userRole == null) return;

        if (!rolePermissionRepository.findByRoleId(userRole.getId()).isEmpty()) {
            return;
        }

        log.info("授予 user 角色基础权限...");
        String[] userPerms = {Permissions.WORKBENCH_READ, Permissions.APPS_READ};
        for (String perm : userPerms) {
            RolePermission rp = new RolePermission();
            rp.setRoleId(userRole.getId());
            rp.setPermission(perm);
            rolePermissionRepository.save(rp);
        }
        log.info("user 角色权限授予完成（{} 项）", userPerms.length);
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

    private void initSuperAdminPermissions() {
        Role superAdmin = roleRepository.findBySlug("super_admin").orElse(null);
        if (superAdmin == null) return;

        if (!rolePermissionRepository.findByRoleId(superAdmin.getId()).isEmpty()) {
            return;
        }

        log.info("授予 super_admin 全部平台权限...");
        for (Permissions.Def def : Permissions.ALL) {
            RolePermission rp = new RolePermission();
            rp.setRoleId(superAdmin.getId());
            rp.setPermission(def.getKey());
            rolePermissionRepository.save(rp);
        }
        log.info("super_admin 权限授予完成（{} 项）", Permissions.ALL.size());
    }

    private void initRootUser() {
        if (userRepository.findByAccount("root").isPresent()) {
            return;
        }
        log.info("初始化超管账号 root...");

        User root = new User();
        root.setAccount("root");
        root.setEmail("root@luban.local");
        root.setPassword(passwordEncoder.encode("123456"));
        root.setName("超级管理员");
        root.setProvider("local");
        root.setStatus("ACTIVE");
        root.setSyncedAt(LocalDateTime.now());
        userRepository.save(root);

        Role superAdmin = roleRepository.findBySlug("super_admin").orElse(null);
        if (superAdmin != null) {
            RoleUser ru = new RoleUser();
            ru.setRoleId(superAdmin.getId());
            ru.setUserId(root.getId());
            roleUserRepository.save(ru);
        }

        log.info("超管账号 root 初始化完成");
    }

    private void initPlatformWorkflows() {
        if (workflowDefinitionRepository.findByScope(WorkflowScope.PLATFORM).isEmpty()) {
            log.info("初始化平台工作流...");

            WorkflowDefinition systemPermWf = new WorkflowDefinition();
            systemPermWf.setName("系统权限审批");
            systemPermWf.setDescription("员工申请系统权限，需直属领导审批 → 部门负责人审批");
            systemPermWf.setScope(WorkflowScope.PLATFORM);
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
            toolPermWf.setScope(WorkflowScope.PLATFORM);
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

    private void initBuiltinRelations() {
        List<Industry> industries = industryRepository.findAll();
        if (industries.isEmpty()) {
            return;
        }

        String[][] builtins = {
            {"DRILLS_INTO", "可下钻到子维度，纯分析导航", "true", "false", "0"},
            {"DRILLED_FROM", "上卷维度，DRILLS_INTO 的逆，自动推导", "true", "false", "1"},
            {"CORRELATED", "关联维度，交叉分析提示", "false", "false", "2"}
        };

        int totalInserted = 0;
        for (Industry industry : industries) {
            for (String[] def : builtins) {
                String relationType = def[0];
                if (industryRelationRepository.findByIndustryIdAndRelationTypeAndIsBuiltin(
                        industry.getId(), relationType, true).isEmpty()) {
                    IndustryRelation relation = new IndustryRelation();
                    relation.setIndustryId(industry.getId());
                    relation.setRelationType(relationType);
                    relation.setDescription(def[1]);
                    relation.setIsTransitive(Boolean.parseBoolean(def[2]));
                    relation.setIsSymmetric(Boolean.parseBoolean(def[3]));
                    relation.setSortOrder(Integer.parseInt(def[4]));
                    relation.setIsBuiltin(true);
                    industryRelationRepository.save(relation);
                    totalInserted++;
                }
            }
        }

        if (totalInserted > 0) {
            log.info("平台关系类型初始化完成：{} 个行业 × {} 种关系类型 = {} 条",
                    industries.size(), builtins.length, totalInserted);
        }
    }
}