import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'PageHeader',
  category: 'navigation',
  spec: `### 页头 PageHeader
⚠️ **页面标题必须使用 pageHeader 组件，禁止手写裸 \`<h1>\` 标题。**
\`\`\`js
LubanUI.pageHeader('pageHeader', {
  title: '员工管理',
  description: '管理公司员工信息与部门归属',
  breadcrumb: [{ label: '首页', href: '#' }, { label: '员工管理', active: true }],
  stats: [{ label: '员工总数', value: 128, color: 'primary' }, { label: '本月入职', value: 12, color: 'success' }],
  actions: ['<button class="luban-btn luban-btn-primary" onclick="openAdd()">新增员工</button>'],
  badge: { text: '已完成', color: 'success' }
});
\`\`\`
使用场景：列表页 → stats + actions；简单页 → title + description + actions；详情页 → breadcrumb + badge；仪表盘 → title + description，统计卡放内容区。`,
} satisfies ComponentSpec;