package com.luban.config;

import com.luban.constant.Permissions;
import com.luban.constant.OntologyOperationType.BuiltinRelation;
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

import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

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
    private final RelationTypeRepository relationTypeRepository;
    private final PasswordEncoder passwordEncoder;

    @Override
    @Transactional
    public void run(String... args) {
        initPlatformRoles();
        initSuperAdminPermissions();
        cleanupOrphanPermissions();
        initRootUser();
        initPlatformWorkflows();
        initDatasourceApprovalWorkflow();
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
        String[] userPerms = {Permissions.WORKBENCH_READ, Permissions.ASK_READ, Permissions.APPS_READ};
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

    /**
     * 权限清单收敛后的自愈：历史种子授予或管理员勾选过的权限 key，若已从
     * Permissions.ALL 下线（无任何鉴权/菜单引用），其勾选记录直接清掉，
     * 避免角色授权界面与实际能力长期不一致。
     */
    private void cleanupOrphanPermissions() {
        Set<String> validKeys = Permissions.ALL.stream()
                .map(Permissions.Def::getKey)
                .collect(Collectors.toSet());
        List<RolePermission> orphans = rolePermissionRepository.findAll().stream()
                .filter(rp -> !validKeys.contains(rp.getPermission()))
                .toList();
        if (orphans.isEmpty()) return;
        rolePermissionRepository.deleteAll(orphans);
        log.info("清理 {} 条已下线权限的勾选记录: {}", orphans.size(),
                orphans.stream().map(RolePermission::getPermission).distinct().toList());
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


    /**
     * 种子升级：早期版本种下的平台审批流程没有 resolutionPolicy（默认 skip 会静默跳过，
     * 权限审批会卡在 PENDING 无人处理）。仅升级系统种子（createdBy=0）的节点定义，
     * 不触碰管理员自建/改过的流程。
     */
    private void upgradeSeedWorkflowResolutionPolicy() {
        List<WorkflowDefinition> platformDefs = workflowDefinitionRepository.findByScope(WorkflowScope.PLATFORM);
        for (WorkflowDefinition def : platformDefs) {
            if (!Long.valueOf(0L).equals(def.getCreatedBy())) continue;
            String nodes = def.getNodes();
            if (nodes == null || nodes.contains("resolutionPolicy")) continue;
            String upgraded = nodes
                    .replace("\"approverType\":\"leader\",\"collaborationMode\":\"all_pass\"}",
                             "\"approverType\":\"leader\",\"collaborationMode\":\"all_pass\",\"resolutionPolicy\":\"fail\"}")
                    .replace("\"approverType\":\"department_head\",\"collaborationMode\":\"all_pass\"}",
                             "\"approverType\":\"department_head\",\"collaborationMode\":\"all_pass\",\"resolutionPolicy\":\"fail\"}")
                    .replace("\"approverType\":\"role\",\"roleSlugs\":[\"system_admin\"],\"collaborationMode\":\"any_pass\"}",
                             "\"approverType\":\"role\",\"roleSlugs\":[\"system_admin\"],\"collaborationMode\":\"any_pass\",\"resolutionPolicy\":\"fail\"}");
            if (!upgraded.equals(nodes)) {
                def.setNodes(upgraded);
                workflowDefinitionRepository.save(def);
                log.info("种子流程「{}」审批节点已升级 resolutionPolicy=fail", def.getName());
            }
        }
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
                    "{\"nodeId\":\"leader_approve\",\"nodeType\":\"approve\",\"label\":\"直属领导审批\",\"config\":{\"approverType\":\"leader\",\"collaborationMode\":\"all_pass\",\"resolutionPolicy\":\"fail\"}}," +
                    "{\"nodeId\":\"dept_head_approve\",\"nodeType\":\"approve\",\"label\":\"部门负责人审批\",\"config\":{\"approverType\":\"department_head\",\"collaborationMode\":\"all_pass\",\"resolutionPolicy\":\"fail\"}}," +
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
                    "{\"nodeId\":\"admin_approve\",\"nodeType\":\"approve\",\"label\":\"系统管理员审批\",\"config\":{\"approverType\":\"role\",\"roleSlugs\":[\"system_admin\"],\"collaborationMode\":\"any_pass\",\"resolutionPolicy\":\"fail\"}}," +
                    "{\"nodeId\":\"end\",\"nodeType\":\"end\",\"label\":\"结束\"}" +
                    "]");
            toolPermWf.setEdges("[" +
                    "{\"source\":\"start\",\"target\":\"admin_approve\"}," +
                    "{\"source\":\"admin_approve\",\"target\":\"end\"}" +
                    "]");
            workflowDefinitionRepository.save(toolPermWf);

            log.info("平台工作流初始化完成");
        }
        upgradeSeedWorkflowResolutionPolicy();
    }

    /**
     * 数据源权限审批平台流程：requestDatasourcePermission 按名称精确查找该流程，
     * 缺失时 API Key 的数据源权限申请链路不可用（REST 禁止创建平台级流程，只能种子补齐）。
     */
    private void initDatasourceApprovalWorkflow() {
        boolean exists = workflowDefinitionRepository.findByScope(WorkflowScope.PLATFORM).stream()
                .anyMatch(w -> "数据源权限审批".equals(w.getName()) && "PUBLISHED".equals(w.getStatus()));
        if (exists) return;

        WorkflowDefinition dsPermWf = new WorkflowDefinition();
        dsPermWf.setName("数据源权限审批");
        dsPermWf.setDescription("API Key 申请数据源访问权限，需直属领导审批 → 部门负责人审批");
        dsPermWf.setScope(WorkflowScope.PLATFORM);
        dsPermWf.setVersion(1);
        dsPermWf.setStatus("PUBLISHED");
        dsPermWf.setCreatedBy(0L);
        dsPermWf.setNodes("[" +
                "{\"nodeId\":\"start\",\"nodeType\":\"start\",\"label\":\"开始\"}," +
                "{\"nodeId\":\"leader_approve\",\"nodeType\":\"approve\",\"label\":\"直属领导审批\",\"config\":{\"approverType\":\"leader\",\"collaborationMode\":\"all_pass\",\"resolutionPolicy\":\"fail\"}}," +
                "{\"nodeId\":\"dept_head_approve\",\"nodeType\":\"approve\",\"label\":\"部门负责人审批\",\"config\":{\"approverType\":\"department_head\",\"collaborationMode\":\"all_pass\",\"resolutionPolicy\":\"fail\"}}," +
                "{\"nodeId\":\"end\",\"nodeType\":\"end\",\"label\":\"结束\"}" +
                "]");
        dsPermWf.setEdges("[" +
                "{\"source\":\"start\",\"target\":\"leader_approve\"}," +
                "{\"source\":\"leader_approve\",\"target\":\"dept_head_approve\"}," +
                "{\"source\":\"dept_head_approve\",\"target\":\"end\"}" +
                "]");
        workflowDefinitionRepository.save(dsPermWf);
        log.info("数据源权限审批平台流程初始化完成");
    }

    private void initDefaultAgentConfig() {
        if (agentConfigRepository.findByIsDefaultTrue().isEmpty()) {
            String apiKey = System.getenv("LUBAN_LLM_API_KEY");
            String endpoint = System.getenv("LUBAN_LLM_ENDPOINT");
            String model = System.getenv("LUBAN_LLM_MODEL");

            if (apiKey != null && !apiKey.isBlank()) {
                log.info("从环境变量初始化默认 Agent 配置...");
                AgentConfig config = new AgentConfig();
                config.setName("Default Agent");
                config.setModelEndpoint(endpoint != null ? endpoint : "https://api.openai.com/v1/chat/completions");
                config.setModelName(model != null ? model : "gpt-4o");
                config.setSecretKeyEnc(encryptAes(apiKey));
                config.setIsDefault(true);
                config.setStatus("ENABLED");
                agentConfigRepository.save(config);
                log.info("默认 Agent 配置初始化完成 (model={})", config.getModelName());
            } else {
                log.info("初始化默认 Agent 配置（占位）...");
                AgentConfig config = new AgentConfig();
                config.setName("Default Agent");
                config.setModelEndpoint("https://api.openai.com/v1/chat/completions");
                config.setModelName("gpt-4o");
                config.setSecretKeyEnc("");
                config.setIsDefault(true);
                config.setStatus("ENABLED");
                agentConfigRepository.save(config);
                log.info("默认 Agent 配置初始化完成（需手动配置 API Key）");
            }
        }
    }

    private String encryptAes(String plainText) {
        try {
            String aesSecret = System.getenv().getOrDefault("LUBAN_AGENT_AES_KEY", "Luban@Agent#2026");
            byte[] key = MessageDigest.getInstance("SHA-256").digest(aesSecret.getBytes("UTF-8"));
            SecretKeySpec secretKey = new SecretKeySpec(key, "AES");
            Cipher cipher = Cipher.getInstance("AES/ECB/PKCS5Padding");
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            return Base64.getEncoder().encodeToString(cipher.doFinal(plainText.getBytes("UTF-8")));
        } catch (Exception e) {
            throw new RuntimeException("AES 加密失败", e);
        }
    }

    private void initBuiltinRelations() {
        int totalInserted = 0;
        for (BuiltinRelation def : BuiltinRelation.values()) {
            String relationType = def.name();
            if (!relationTypeRepository.existsByRelationType(relationType)) {
                RelationType relation = new RelationType();
                relation.setRelationType(relationType);
                relation.setDescription(def.description());
                relation.setLabel(def.label());
                relation.setColor(def.color());
                relation.setSourceRole(def.sourceRole());
                relation.setTargetRole(def.targetRole());
                relation.setSourceToTarget(def.sourceToTarget());
                relation.setIsTransitive(def.isTransitive());
                relation.setIsSymmetric(def.isSymmetric());
                relation.setSortOrder(def.sortOrder());
                relation.setIsBuiltin(true);
                relationTypeRepository.save(relation);
                totalInserted++;
            }
        }

        if (totalInserted > 0) {
            log.info("平台关系类型初始化完成：{} 种内置关系类型", totalInserted);
        }
    }
}