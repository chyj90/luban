import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Badge',
  category: 'data-display',
  spec: `### 标签 Badge
\`\`\`html
<span class="luban-badge luban-badge-success">成功</span>
<span class="luban-badge luban-badge-warning">警告</span>
<span class="luban-badge luban-badge-danger">危险</span>
<span class="luban-badge luban-badge-primary">主要</span>
<span class="luban-badge luban-badge-info">信息</span>
<span class="luban-badge luban-badge-dot luban-badge-success"></span>
<span class="luban-badge luban-badge-count">99+</span>
\`\`\``,
} satisfies ComponentSpec;