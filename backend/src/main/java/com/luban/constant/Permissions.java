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
    public static final String CONNECT_CONCEPTS = "connect:concepts";
    public static final String CONNECT_CONCEPT_FEEDBACK = "connect:concept-feedback";
    public static final String CONNECT_AGENT = "connect:agent";

    @Data
    @AllArgsConstructor
    public static class Def {
        private String key;
        private String label;
        private String desc;
        private String section;
    }

    /**
     * 平台权限清单：与实际菜单/接口鉴权一一对应，label 与 desc 描述的是勾选后
     * 真正放开的页面与能力。下线的 key 由 PlatformSeedDataInitializer
     * cleanupOrphanPermissions 在启动时自动清理历史勾选。
     */
    public static final List<Def> ALL = List.of(
            new Def(WORKBENCH_READ, "工作中心", "我的工作、数据看板、平台审核", "工作中心"),
            new Def(ASK_READ, "智能问数", "AI 对话查询", "智能问数"),
            new Def(APPS_READ, "开发中心", "应用中心、工作流设计", "开发中心"),
            new Def(PEOPLE_USERS, "用户管理", "查看、编辑用户", "平台管理"),
            new Def(PEOPLE_ORG, "组织架构", "管理部门与成员", "平台管理"),
            new Def(PEOPLE_ROLES, "平台角色", "创建、编辑、删除角色及权限", "平台管理"),
            new Def(CONNECT_SYSTEMS, "系统管理", "管理外部系统与工具注册、Key 权限审批", "建模中心 · 数据接入"),
            new Def(CONNECT_CONCEPTS, "概念编辑器", "概念编辑器、绑定管理、语义包回归、运行监控", "建模中心 · 语义运营"),
            new Def(CONNECT_CONCEPT_FEEDBACK, "问题洞察", "洞察问数缺口、处理概念反馈", "建模中心 · 语义运营"),
            new Def(CONNECT_AGENT, "大模型配置", "管理大模型配置", "建模中心 · 凭据与模型")
    );
}