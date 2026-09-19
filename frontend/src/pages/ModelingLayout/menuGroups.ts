interface ModelingMenuItem {
  key: string;
  label: string;
  path: string;
  permission: string;
}

export interface ModelingMenuGroup {
  title: string;
  items: ModelingMenuItem[];
}

/**
 * 建模中心菜单定义（与 ModelingLayout 共用）。
 *
 * 面向"语义运营"收敛：概念域管理、版本快照、异步任务不再挂侧边栏——
 * 概念域的创建内联在概念编辑器；快照/回滚与异步任务由变更审核流程自动驱动，
 * 页面路由保留（无菜单入口），供排查问题深链访问。
 */
export const MODELING_MENU_GROUPS: ModelingMenuGroup[] = [
  {
    title: '数据接入',
    items: [
      // 工具管理不单独挂侧边栏：依赖系统页选中的系统上下文（groupId），从系统管理进入
      { key: '/modeling/systems', label: '系统管理', path: '/modeling/systems', permission: 'connect:systems' },
      { key: '/modeling/gateway', label: '运行监控', path: '/modeling/gateway', permission: 'connect:gateway' },
    ],
  },
  {
    title: '语义运营',
    items: [
      { key: '/modeling/concepts', label: '概念编辑器', path: '/modeling/concepts', permission: 'connect:concepts' },
      { key: '/modeling/binding-profiles', label: '绑定管理', path: '/modeling/binding-profiles', permission: 'connect:concepts' },
      { key: '/modeling/concept-feedback', label: '问题洞察', path: '/modeling/concept-feedback', permission: 'connect:concept-feedback' },
      { key: '/modeling/ontology-regression', label: '语义包回归', path: '/modeling/ontology-regression', permission: 'connect:concepts' },
    ],
  },
  {
    title: '凭据与模型',
    items: [
      { key: '/modeling/keys', label: '我的 KEY', path: '/modeling/keys', permission: 'connect:keys' },
      { key: '/modeling/agent', label: '大模型配置', path: '/modeling/agent', permission: 'connect:agent' },
    ],
  },
];

/** 按菜单顺序取第一个有权限的路径，作为 /modeling 的落地页 */
export function modelingHomePath(hasPermission: (p: string) => boolean): string {
  for (const group of MODELING_MENU_GROUPS) {
    for (const item of group.items) {
      if (hasPermission(item.permission)) return item.path;
    }
  }
  return '/modeling/systems';
}
