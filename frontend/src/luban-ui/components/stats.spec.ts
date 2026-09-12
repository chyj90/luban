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
颜色：luban-stat-card-primary / success / warning / danger。加载骨架：加 luban-stat-loading 类。`,
} satisfies ComponentSpec;