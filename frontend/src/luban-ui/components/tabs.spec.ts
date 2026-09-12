import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Tabs',
  category: 'navigation',
  spec: `### 标签页 Tabs
\`\`\`html
<div class="luban-tabs luban-tabs-card" id="myTabs">
  <div class="luban-tabs-nav"><button class="luban-tab-item active" data-tab="tab1">标签一</button><button class="luban-tab-item" data-tab="tab2">标签二</button></div>
  <div class="luban-tab-content active" data-tab="tab1">内容1</div>
  <div class="luban-tab-content" data-tab="tab2">内容2</div>
</div>
\`\`\`
\`\`\`js
LubanUI.initTabs('myTabs');
\`\`\`
样式：默认下划线 / luban-tabs-card（卡片式）。`,
} satisfies ComponentSpec;