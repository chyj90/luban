import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Stats',
  category: 'data-display',
  spec: `### 统计卡 Stats
\`\`\`html
<div class="luban-stats-grid">
  <div class="luban-stat-card luban-stat-card-primary">
    <div class="luban-stat-label">总收入</div>
    <div class="luban-stat-value" id="val1">-</div>
    <div class="luban-stat-change luban-stat-up">↑ 12%</div>
  </div>
</div>
\`\`\`
颜色：luban-stat-card-primary / success / warning / danger。加载骨架：加 luban-stat-loading 类。

#### 角标装饰（浅色主题注意）
需要左上角标装饰时，**直接加 luban-stat-corner 类**（配合 -primary/-danger 等变体自动取色）：
\`\`\`html
<div class="luban-stat-card luban-stat-card-danger luban-stat-corner">...</div>
\`\`\`
⚠️ 不要手写 currentColor 角标装饰——currentColor 继承文字色，浅色主题下会变成灰色实线（观感如样式缺失）。
如需自定义色，用 var(--luban-stat-accent)（随变体自动变色）或具体色值。`,
} satisfies ComponentSpec;