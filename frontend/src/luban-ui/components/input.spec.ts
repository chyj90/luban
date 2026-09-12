import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Input',
  category: 'data-entry',
  spec: `### 输入组件
\`\`\`html
<input class="luban-input" placeholder="文本输入">
<input class="luban-input" disabled>
<div class="luban-input-clearable"><input class="luban-input" id="searchBox" placeholder="搜索..."><span class="luban-input-clear" onclick="...">✕</span></div>
<div class="luban-input-affix"><span class="luban-input-prefix">¥</span><input class="luban-input"><span class="luban-input-suffix">元</span></div>
<input type="date" class="luban-datepicker">
<input type="number" class="luban-input-number" min="0" max="999">
<label class="luban-checkbox"><input type="checkbox"> 复选框</label>
<label class="luban-radio"><input type="radio" name="g"> 单选框</label>
<label class="luban-switch"><input type="checkbox"> 开关</label>
\`\`\``,
} satisfies ComponentSpec;