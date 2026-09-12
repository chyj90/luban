import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Button',
  category: 'data-entry',
  spec: `### 按钮 Button
\`\`\`html
<button class="luban-btn luban-btn-primary">主按钮</button>
<button class="luban-btn luban-btn-secondary">次要</button>
<button class="luban-btn luban-btn-danger">危险</button>
<button class="luban-btn luban-btn-success">成功</button>
<button class="luban-btn luban-btn-text">文字按钮</button>
<button class="luban-btn luban-btn-sm">小</button>
<button class="luban-btn luban-btn-lg">大</button>
<button class="luban-btn luban-btn-primary luban-btn-block">全宽</button>
<button class="luban-btn luban-btn-primary luban-btn-loading">提交中</button>
\`\`\`
JS 切换 loading：btn.classList.add/remove('luban-btn-loading')。`,
} satisfies ComponentSpec;