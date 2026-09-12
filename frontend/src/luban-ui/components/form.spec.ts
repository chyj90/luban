import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Form',
  category: 'data-entry',
  spec: `### 表单 Form
\`\`\`html
<form class="luban-form" id="myForm">
  <div class="luban-form-item">
    <label class="luban-form-label luban-form-label-required">名称</label>
    <input class="luban-input" name="name" placeholder="请输入">
  </div>
</form>
<!-- 行内搜索 -->
<form class="luban-form luban-form-inline">...</form>
<!-- 水平标签 -->
<form class="luban-form luban-form-horizontal">...</form>
\`\`\`
表单容器必须使用 \`<form>\` 标签。取值：\`LubanUI.getFormData('myForm')\`。`,
} satisfies ComponentSpec;