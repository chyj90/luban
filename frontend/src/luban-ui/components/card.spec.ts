import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Card',
  category: 'data-display',
  spec: `### 卡片 Card
\`\`\`html
<div class="luban-card luban-card-hoverable"><div class="luban-card-header"><span class="luban-card-title">标题</span></div><div class="luban-card-body">内容</div></div>
\`\`\`
变体：luban-card-hoverable / luban-card-bordered / luban-card-shadow。`,
} satisfies ComponentSpec;