package com.luban.constant;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;

public final class Permissions {

    private Permissions() {}

    public static final String WORKBENCH_READ = "workbench:read";
    public static final String ASK_READ = "ask:read";
    public static final String APPS_READ = "apps:read";
    public static final String PEOPLE_USERS = "people:users";
    public static final String PEOPLE_ORG = "people:org";
    public static final String PEOPLE_ROLES = "people:roles";
    public static final String CONNECT_SYSTEMS = "connect:systems";
    public static final String CONNECT_TOOLS = "connect:tools";
    public static final String CONNECT_CONCEPTS = "connect:concepts";
    public static final String CONNECT_ONTOLOGY_GROUPS = "connect:ontology-groups";
    public static final String CONNECT_CONCEPT_FEEDBACK = "connect:concept-feedback";
    public static final String CONNECT_CONCEPT_SNAPSHOTS = "connect:concept-snapshots";
    public static final String CONNECT_CONCEPT_EMBEDDINGS = "connect:concept-embeddings";
    public static final String CONNECT_GATEWAY = "connect:gateway";
    public static final String CONNECT_KEYS = "connect:keys";
    public static final String CONNECT_AGENT = "connect:agent";
    public static final String SYSTEM_TASKS = "system:tasks";

    @Data
    @AllArgsConstructor
    public static class Def {
        private String key;
        private String label;
        private String desc;
        private String section;
    }

    public static final List<Def> ALL = List.of(
            new Def(WORKBENCH_READ, "工作中心", "我的工作、平台审核", "工作中心"),
            new Def(ASK_READ, "问数", "AI 对话查询", "问数"),
            new Def(APPS_READ, "应用开发", "应用中心、工作流设计", "应用开发"),
            new Def(PEOPLE_USERS, "用户管理", "查看、编辑用户与角色", "人员管理"),
            new Def(PEOPLE_ORG, "组织架构", "管理部门与成员", "人员管理"),
            new Def(PEOPLE_ROLES, "平台角色", "创建、编辑、删除角色及权限", "人员管理"),
            new Def(CONNECT_SYSTEMS, "系统管理", "管理外部系统配置", "系统配置"),
            new Def(CONNECT_TOOLS, "工具注册表", "管理注册工具", "系统配置"),
            new Def(CONNECT_CONCEPTS, "概念编辑器", "概念编辑器", "概念图谱"),
            new Def(CONNECT_ONTOLOGY_GROUPS, "概念域管理", "管理概念域分组", "概念图谱"),
            new Def(CONNECT_CONCEPT_FEEDBACK, "概念反馈", "查看处理用户概念反馈", "概念图谱"),
            new Def(CONNECT_CONCEPT_SNAPSHOTS, "版本快照", "管理概念版本快照", "概念图谱"),
            new Def(CONNECT_CONCEPT_EMBEDDINGS, "概念向量", "管理概念向量嵌入", "概念图谱"),
            new Def(CONNECT_GATEWAY, "MCP 网关", "网关配置", "系统配置"),
            new Def(CONNECT_KEYS, "我的 Key", "API Key 管理", "系统配置"),
            new Def(CONNECT_AGENT, "大模型配置", "管理大模型配置", "系统配置"),
            new Def(SYSTEM_TASKS, "异步任务", "管理异步任务", "系统配置")
    );
}