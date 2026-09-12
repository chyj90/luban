import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Loading',
  category: 'feedback',
  spec: `### 加载 Loading
\`\`\`html
<div class="luban-loading"><div class="luban-spinner"></div><div class="luban-loading-text">加载中...</div></div>
<div class="luban-loading luban-loading-inline"><div class="luban-spinner"></div><span>加载中...</span></div>
<div class="luban-loading-fullscreen" id="fullLoading"><div class="luban-spinner"></div><div class="luban-loading-text">处理中...</div></div>
\`\`\``,
} satisfies ComponentSpec;