import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Toast',
  category: 'feedback',
  spec: `### 消息提示 Toast
\`\`\`js
LubanUI.toast.success('操作成功');
LubanUI.toast.error('操作失败');
LubanUI.toast.warning('请注意');
LubanUI.toast.info('提示信息');
LubanUI.toast.success('已保存', 2000); // 自定义时长(ms)，默认4000ms，传0不自动关闭
\`\`\``,
} satisfies ComponentSpec;