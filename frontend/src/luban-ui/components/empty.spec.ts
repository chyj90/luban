import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Empty',
  category: 'data-display',
  spec: `### 空状态 Empty
\`\`\`html
<div class="luban-empty luban-empty-action">
  <div class="luban-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg></div>
  <div class="luban-empty-text">暂无数据</div>
  <div class="luban-empty-description">当前没有可显示的内容</div>
  <button class="luban-btn luban-btn-primary">立即创建</button>
</div>
<!-- 紧凑空态 -->
<div class="luban-empty luban-empty-simple"><div class="luban-empty-icon">...</div><div class="luban-empty-text">暂无数据</div></div>
\`\`\``,
} satisfies ComponentSpec;