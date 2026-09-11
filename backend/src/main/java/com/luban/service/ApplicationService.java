package com.luban.service;

import com.luban.dto.CreateAppRequest;
import com.luban.entity.Application;
import com.luban.entity.CodePage;
import com.luban.entity.Page;
import com.luban.repository.ApplicationRepository;
import com.luban.repository.CodePageRepository;
import com.luban.repository.PageRepository;
import com.luban.repository.QueryRepository;
import com.luban.repository.ToolDefinitionRepository;
import com.luban.repository.ApplicationApiKeyRepository;
import com.luban.repository.DatasourceRepository;
import com.luban.repository.JsFunctionRepository;
import com.luban.workflow.entity.FormWorkflowBinding;
import com.luban.workflow.entity.Role;
import com.luban.workflow.entity.RolePermission;
import com.luban.workflow.entity.RoleUser;
import com.luban.workflow.entity.WorkflowDefinition;
import com.luban.workflow.entity.WorkflowInstance;
import com.luban.workflow.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class ApplicationService {

    private final ApplicationRepository applicationRepository;
    private final PageRepository pageRepository;
    private final CodePageRepository codePageRepository;
    private final JsFunctionRepository jsFunctionRepository;
    private final QueryRepository queryRepository;
    private final ToolDefinitionRepository toolDefinitionRepository;
    private final ApplicationApiKeyRepository applicationApiKeyRepository;
    private final DatasourceRepository datasourceRepository;
    private final WorkflowDefinitionRepository workflowDefinitionRepository;
    private final WorkflowInstanceRepository workflowInstanceRepository;
    private final WorkflowTaskRepository workflowTaskRepository;
    private final WorkflowHistoryRepository workflowHistoryRepository;
    private final FormDefinitionRepository formDefinitionRepository;
    private final FormWorkflowBindingRepository formWorkflowBindingRepository;
    private final RoleRepository roleRepository;
    private final RolePermissionRepository rolePermissionRepository;
    private final RoleUserRepository roleUserRepository;

    public ApplicationService(ApplicationRepository applicationRepository,
                              PageRepository pageRepository,
                              CodePageRepository codePageRepository,
                              JsFunctionRepository jsFunctionRepository,
                              QueryRepository queryRepository,
                              ToolDefinitionRepository toolDefinitionRepository,
                              ApplicationApiKeyRepository applicationApiKeyRepository,
                              DatasourceRepository datasourceRepository,
                              WorkflowDefinitionRepository workflowDefinitionRepository,
                              WorkflowInstanceRepository workflowInstanceRepository,
                              WorkflowTaskRepository workflowTaskRepository,
                              WorkflowHistoryRepository workflowHistoryRepository,
                              FormDefinitionRepository formDefinitionRepository,
                              FormWorkflowBindingRepository formWorkflowBindingRepository,
                              RoleRepository roleRepository,
                              RolePermissionRepository rolePermissionRepository,
                              RoleUserRepository roleUserRepository) {
        this.applicationRepository = applicationRepository;
        this.pageRepository = pageRepository;
        this.codePageRepository = codePageRepository;
        this.jsFunctionRepository = jsFunctionRepository;
        this.queryRepository = queryRepository;
        this.toolDefinitionRepository = toolDefinitionRepository;
        this.applicationApiKeyRepository = applicationApiKeyRepository;
        this.datasourceRepository = datasourceRepository;
        this.workflowDefinitionRepository = workflowDefinitionRepository;
        this.workflowInstanceRepository = workflowInstanceRepository;
        this.workflowTaskRepository = workflowTaskRepository;
        this.workflowHistoryRepository = workflowHistoryRepository;
        this.formDefinitionRepository = formDefinitionRepository;
        this.formWorkflowBindingRepository = formWorkflowBindingRepository;
        this.roleRepository = roleRepository;
        this.rolePermissionRepository = rolePermissionRepository;
        this.roleUserRepository = roleUserRepository;
    }

    public List<Application> listByCreatedBy(Long userId) {
        List<Application> myApps = applicationRepository.findByCreatedBy(userId);
        for (Application app : myApps) {
            app.setWorkflowCount(workflowDefinitionRepository.countByApplicationId(app.getId()));
            app.setPublishedWorkflowCount(workflowDefinitionRepository.countByApplicationIdAndStatus(app.getId(), "PUBLISHED"));
        }
        return myApps;
    }

    public List<Map<String, Object>> listAccessibleApps(Long userId) {
        List<RoleUser> userRoles = roleUserRepository.findByUserId(userId);
        List<Long> appRoleIds = new ArrayList<>();
        for (RoleUser ru : userRoles) {
            Role role = roleRepository.findById(ru.getRoleId()).orElse(null);
            if (role != null && "APPLICATION".equals(role.getScope()) && role.getApplicationId() != null) {
                appRoleIds.add(ru.getRoleId());
            }
        }

        Set<Long> appIds = new HashSet<>();
        for (Long roleId : appRoleIds) {
            Role role = roleRepository.findById(roleId).orElse(null);
            if (role != null && role.getApplicationId() != null) {
                appIds.add(role.getApplicationId());
            }
        }

        List<Application> myApps = applicationRepository.findByCreatedBy(userId);
        for (Application app : myApps) {
            appIds.add(app.getId());
        }

        if (appIds.isEmpty()) {
            return List.of();
        }

        List<Application> apps = applicationRepository.findAllById(appIds);
        List<RolePermission> permissions = rolePermissionRepository.findByRoleIdIn(appRoleIds);
        Set<String> permSet = permissions.stream()
                .map(RolePermission::getPermission)
                .collect(Collectors.toSet());

        List<Map<String, Object>> result = new ArrayList<>();
        for (Application app : apps) {
            boolean isOwner = app.getCreatedBy() != null && app.getCreatedBy().equals(userId);
            List<Page> pages = pageRepository.findByApplicationId(app.getId());
            List<Map<String, Object>> pageList = new ArrayList<>();
            for (Page page : pages) {
                Map<String, Object> pageMap = new LinkedHashMap<>();
                pageMap.put("id", page.getId());
                pageMap.put("name", page.getName());
                pageMap.put("slug", page.getSlug());
                pageMap.put("isDefault", page.getIsDefault());
                pageMap.put("accessible", isOwner || permSet.contains("app:page:" + page.getId()));
                pageList.add(pageMap);
            }

            List<WorkflowDefinition> workflows = workflowDefinitionRepository.findByApplicationIdAndStatus(app.getId(), "PUBLISHED");
            List<Map<String, Object>> workflowList = new ArrayList<>();
            for (WorkflowDefinition wf : workflows) {
                boolean wfAccessible = isOwner || permSet.contains("app:workflow:" + wf.getId());
                if (!wfAccessible) continue;
                Map<String, Object> wfMap = new LinkedHashMap<>();
                wfMap.put("id", wf.getId());
                wfMap.put("name", wf.getName());
                wfMap.put("description", wf.getDescription());
                List<FormWorkflowBinding> bindings = formWorkflowBindingRepository.findByWorkflowId(wf.getId());
                List<Map<String, Object>> formList = new ArrayList<>();
                for (FormWorkflowBinding binding : bindings) {
                    Map<String, Object> formMap = new LinkedHashMap<>();
                    formMap.put("formId", binding.getFormId());
                    formMap.put("bindingType", binding.getBindingType());
                    formMap.put("isDefault", binding.getIsDefault());
                    formList.add(formMap);
                }
                wfMap.put("forms", formList);
                workflowList.add(wfMap);
            }

            Map<String, Object> appMap = new LinkedHashMap<>();
            appMap.put("id", app.getId());
            appMap.put("name", app.getName());
            appMap.put("slug", app.getSlug());
            appMap.put("pages", pageList);
            appMap.put("workflows", workflowList);
            result.add(appMap);
        }
        return result;
    }

    public boolean canSubmitWorkflow(Long userId, Long definitionId) {
        WorkflowDefinition definition = workflowDefinitionRepository.findById(definitionId).orElse(null);
        if (definition == null) return false;
        if (definition.getApplicationId() == null) return true; // 平台级流程所有人可发起

        List<RoleUser> userRoles = roleUserRepository.findByUserId(userId);
        List<Long> roleIds = userRoles.stream()
                .map(RoleUser::getRoleId)
                .filter(rid -> {
                    Role role = roleRepository.findById(rid).orElse(null);
                    return role != null && "APPLICATION".equals(role.getScope())
                            && definition.getApplicationId().equals(role.getApplicationId());
                })
                .toList();
        if (roleIds.isEmpty()) return false;

        return rolePermissionRepository.findByRoleIdIn(roleIds).stream()
                .anyMatch(rp -> ("app:workflow:" + definitionId).equals(rp.getPermission()));
    }

    public Application getById(Long id) {
        return applicationRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("应用不存在"));
    }

    @Transactional
    public Application create(CreateAppRequest request, Long userId) {
        Application app = new Application();
        app.setName(request.getName());
        app.setCreatedBy(userId);
        app.setSlug(generateSlug(request.getName()));
        app = applicationRepository.save(app);

        return app;
    }

    public Application update(Long id, String name) {
        Application app = applicationRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("应用不存在"));
        app.setName(name);
        app.setSlug(generateSlug(name));
        return applicationRepository.save(app);
    }

    @Transactional
    public void delete(Long id) {
        // 1. 删除页面及关联的 CodePage、JsFunction
        List<Page> pages = pageRepository.findByApplicationId(id);
        for (Page page : pages) {
            codePageRepository.deleteByPageId(page.getId());
            jsFunctionRepository.deleteByPageId(page.getId());
        }
        pageRepository.deleteByApplicationId(id);

        // 2. 删除查询
        queryRepository.deleteByApplicationId(id);

        // 3. 删除应用级数据源（owner_id = 应用ID）
        datasourceRepository.deleteBySlugAndOwnerId("APPLICATION", id);

        // 4. 删除应用级 API（scope=APPLICATION, groupId=appId）
        toolDefinitionRepository.deleteByGroupIdAndScope(id, "APPLICATION");

        // 5. 删除流程相关
        List<WorkflowDefinition> wfDefs = workflowDefinitionRepository.findByApplicationId(id);
        List<Long> wfIds = wfDefs.stream().map(WorkflowDefinition::getId).collect(Collectors.toList());
        if (!wfIds.isEmpty()) {
            formWorkflowBindingRepository.deleteByWorkflowIdIn(wfIds);
            List<WorkflowInstance> instances = workflowInstanceRepository.findByWorkflowIdIn(wfIds);
            List<Long> instanceIds = instances.stream().map(WorkflowInstance::getId).collect(Collectors.toList());
            if (!instanceIds.isEmpty()) {
                workflowHistoryRepository.deleteByInstanceIdIn(instanceIds);
                workflowTaskRepository.deleteByInstanceIdIn(instanceIds);
            }
        }
        workflowInstanceRepository.deleteByApplicationId(id);
        workflowTaskRepository.deleteByApplicationId(id);
        workflowDefinitionRepository.deleteByApplicationId(id);

        // 5. 删除表单定义
        formDefinitionRepository.deleteByApplicationId(id);

        // 6. 删除角色及关联权限
        List<Role> roles = roleRepository.findByApplicationId(id);
        for (Role role : roles) {
            rolePermissionRepository.deleteByRoleId(role.getId());
            roleUserRepository.deleteByRoleId(role.getId());
        }
        roleRepository.deleteByApplicationId(id);

        // 7. 删除 API KEY 绑定
        applicationApiKeyRepository.deleteByApplicationId(id);

        // 8. 删除应用
        applicationRepository.deleteById(id);
    }

    private String generateSlug(String name) {
        String base = name.toLowerCase()
                .replaceAll("[^a-z0-9\\u4e00-\\u9fa5]+", "-")
                .replaceAll("^-|-$", "");
        if (base.isEmpty()) {
            base = "app";
        }
        return base + "-" + UUID.randomUUID().toString().substring(0, 6);
    }
}