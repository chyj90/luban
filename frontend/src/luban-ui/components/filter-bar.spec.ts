import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'FilterBar',
  category: 'data-entry',
  spec: `### 筛选栏 FilterBar
\`\`\`html
<div class="luban-filter-bar">
  <div class="luban-filter-item"><span class="luban-filter-label">关键词</span><input class="luban-input" id="searchInput" placeholder="搜索..."></div>
  <div class="luban-filter-item"><span class="luban-filter-label">状态</span><select class="luban-select" id="statusFilter"><option value="">全部</option></select></div>
  <div class="luban-filter-actions"><button class="luban-btn luban-btn-primary" onclick="search()">查询</button><button class="luban-btn" onclick="reset()">重置</button></div>
</div>
\`\`\``,
} satisfies ComponentSpec;