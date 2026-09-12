export interface ComponentSpec {
  name: string;
  category: 'layout' | 'data-display' | 'data-entry' | 'feedback' | 'navigation';
  spec: string;
}

const globFn = (import.meta as unknown as Record<string, unknown>).glob as
  | (<T>(pattern: string, opts: { eager: boolean }) => Record<string, T>)
  | undefined;

const specModules = globFn
  ? globFn<{ default: ComponentSpec }>('./components/*.spec.ts', { eager: true })
  : {};

const allSpecs: ComponentSpec[] = Object.values(specModules)
  .map((m) => m.default)
  .filter(Boolean)
  .sort((a, b) => a.name.localeCompare(b.name));

const layoutSpecs: ComponentSpec[] = [
  {
    name: 'PageContainer',
    category: 'layout',
    spec: `### 页面容器结构
所有页面必须使用以下标准容器：
\`\`\`html
<div class="page-container">
  <div id="pageHeader"></div>
  <div class="content-container">
    <!-- 筛选栏 / 表格 / 图表 等 -->
  </div>
</div>
\`\`\`
\`\`\`css
.page-container { padding: 20px; max-width: 1400px; margin: 0 auto; }
.content-container { background: #fff; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); padding: 20px; }
\`\`\``,
  },
  {
    name: 'CSSRules',
    category: 'layout',
    spec: `### CSS 命名规范
- **luban-** 前缀的类名由 LubanUI 组件库管理，禁止在自定义 CSS 中覆盖或重定义
- 自定义样式必须使用 **my-** 前缀（如 my-filter-bar、my-custom-card）`,
  },
  {
    name: 'DataQueryAPI',
    category: 'data-display',
    spec: `### DataQuery API 常见错误修复
\`\`\`
❌ 错误写法                          → ✅ 正确写法
result.success                       → 直接用 .then()/.catch()，写操作返回 { affectedRows, success }
result.data.rows                     → result.rows
result.data.columns                  → result.columns
var data = result.rows               → var data = result.rows || []（必须加空值保护）
async function loadData()            → var loadData = function() { ... }（不用 async/await）
QueryRunner.runQuery(name, params)   → DataQuery.QueryName(params)
JSON.stringify(row) 传给 onclick     → onclick="editRow(' + row.id + ')" + table.getData().find(...)
\`\`\``,
  },
];

const mergedSpecs: ComponentSpec[] = [...layoutSpecs, ...allSpecs].sort((a, b) =>
  a.name.localeCompare(b.name),
);

export function getComponentSpecs(): ComponentSpec[] {
  return mergedSpecs;
}

export function getComponentCatalog(): string {
  const categories: Record<string, string[]> = {};
  for (const spec of mergedSpecs) {
    const cat = spec.category;
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(spec.name);
  }

  const categoryLabels: Record<string, string> = {
    layout: '布局',
    'data-display': '数据展示',
    'data-entry': '数据录入',
    feedback: '反馈',
    navigation: '导航',
  };

  const lines = ['## LubanUI 组件目录', ''];
  for (const [cat, names] of Object.entries(categories)) {
    lines.push(`**${categoryLabels[cat] || cat}**：${names.join('、')}`);
  }
  lines.push('');
  lines.push('⚠️ 必须优先使用 LubanUI 组件，禁止用原生 HTML 替代。调用 get_component_spec 获取组件详细用法。');
  return lines.join('\n');
}

export function getComponentSpecByName(names: string[]): string {
  const nameSet = new Set(names.map((n) => n.toLowerCase()));
  const matched = mergedSpecs.filter((s) => nameSet.has(s.name.toLowerCase()));
  if (matched.length === 0) {
    return `未找到匹配的组件。可用组件：${mergedSpecs.map((s) => s.name).join('、')}`;
  }
  return matched.map((s) => s.spec).join('\n\n');
}

export function buildDesignSpecFromComponents(): string {
  const header = `## LubanUI 组件库

⚠️ **强制规则：必须优先使用 LubanUI 组件库构建页面。** 页面预置了完整的 LubanUI 组件库，所有组件风格与平台一致。禁止使用原生 HTML 元素替代已有组件（如用原生 <button> 代替 luban-btn），仅当组件库确实无法满足需求时才可自定义 CSS/HTML。违反此规则会导致校验警告。`;

  const body = mergedSpecs.map((s) => s.spec).join('\n\n');
  return `${header}\n\n${body}`;
}