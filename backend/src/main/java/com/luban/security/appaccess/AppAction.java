package com.luban.security.appaccess;

/**
 * 应用访问动作分级——平台唯一的授权语义定义。
 *
 * <ul>
 *   <li>{@code VIEW}：查看应用内资源（元数据、页面代码、查询定义）</li>
 *   <li>{@code RUN}：运行态执行（跑查询、调工具、发起流程实例）——应用任意角色成员</li>
 *   <li>{@code DEVELOP}：开发态写（页面代码、查询、流程定义、绑定）——owner 或持 app:develop 权限</li>
 *   <li>{@code MANAGE}：应用管理（成员/角色管理、删除应用、强制跳转等危险运维）——owner 或持 app:manage 权限</li>
 * </ul>
 * 隐含关系：MANAGE ⊃ DEVELOP ⊃ RUN ⊃ VIEW。
 */
public enum AppAction {
    VIEW,
    RUN,
    DEVELOP,
    MANAGE;

    /** 是否满足：this 蕴含 required（MANAGE ⊃ DEVELOP ⊃ RUN ⊃ VIEW） */
    public boolean implies(AppAction required) {
        return this.ordinal() >= required.ordinal();
    }
}
