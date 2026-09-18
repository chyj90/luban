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

/** 建模中心菜单定义（与 ModelingLayout 共用） */
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
    title: '概念图谱',
    items: [
      { key: '/modeling/ontology-groups', label: '概念域管理', path: '/modeling/ontology-groups', permission: 'connect:ontology-groups' },
      { key: '/modeling/concepts', label: '概念编辑器', path: '/modeling/concepts', permission: 'connect:concepts' },
      { key: '/modeling/concept-feedback', label: '概念反馈', path: '/modeling/concept-feedback', permission: 'connect:concept-feedback' },
      { key: '/modeling/concept-snapshots', label: '版本快照', path: '/modeling/concept-snapshots', permission: 'connect:concept-snapshots' },
      { key: '/modeling/concept-embeddings', label: '异步任务', path: '/modeling/concept-embeddings', permission: 'connect:concept-embeddings' },
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
