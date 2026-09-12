import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Modal',
  category: 'feedback',
  spec: `### 弹窗 Modal
\`\`\`html
<div class="luban-modal-overlay" id="myModal" style="display:none">
  <div class="luban-modal luban-modal-narrow">
    <div class="luban-modal-header"><span class="luban-modal-title">标题</span><button class="luban-modal-close" data-modal-close>✕</button></div>
    <div class="luban-modal-body">内容</div>
    <div class="luban-modal-footer"><button class="luban-btn" data-modal-close>取消</button><button class="luban-btn luban-btn-primary" onclick="save()">保存</button></div>
  </div>
</div>
\`\`\`
\`\`\`js
LubanUI.modal.open('myModal', { width: 400, closable: false, onClose: function() {} });
LubanUI.modal.close('myModal');
\`\`\`
尺寸：luban-modal-narrow (360px) / 默认 (480px) / luban-modal-wide (680px)。按钮加 data-modal-close 自动关闭。`,
} satisfies ComponentSpec;