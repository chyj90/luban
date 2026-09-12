import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Select',
  category: 'data-entry',
  spec: `### ⚠️ Select 组件强制规则
LubanUI 增强的 select 内部维护独立状态，所有操作必须使用 LubanUI.select() API，禁止使用原生 DOM API。
| 操作 | ❌ 禁止（原生 DOM） | ✅ 必须（LubanUI API） |
|------|---------------------|------------------------|
| 初始化 | 无 | \`LubanUI.initSelects()\` |
| 取值 | \`elm.value\` | \`LubanUI.select('#sel').getValue()\` |
| 设值 | \`elm.value = 'x'\` | \`LubanUI.select('#sel').setValue('x')\` |
| 清空 | \`elm.value = ''\` | \`LubanUI.select('#sel').setValue('')\` |
| 动态选项 | \`createElement('option')\` | \`LubanUI.select('#sel').setOptions([...])\` |
| 表单重置 | \`form.reset()\` 不会重置 | 额外调用 \`LubanUI.select('#xxx').setValue('')\` |
\`\`\`js
LubanUI.initSelects();
LubanUI.select('#mySelect').getValue();
LubanUI.select('#mySelect').setValue('2');
LubanUI.select('#mySelect').setOptions([{ value: '1', label: '选项一' }, { value: '2', label: '选项二' }]);
// 树形选项（级联选择）
LubanUI.select('#mySelect').setOptions([{ value: 'china', label: '中国', children: [{ value: 'beijing', label: '北京' }] }]);
\`\`\``,
} satisfies ComponentSpec;