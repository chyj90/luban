/* ============================================
   Modal JS — 弹窗开关
   LubanUI.modal.open(id, opts) / .close(id)
   opts: { width, closable, onClose }
   ============================================ */

(function() {
  'use strict';

  var openModals = [];

  window.LubanUI = window.LubanUI || {};

  window.LubanUI.modal = {
    open: function(id, opts) {
      var el = document.getElementById(id);
      if (!el) return;
      opts = opts || {};

      el.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      openModals.push(el);

      // 宽度
      if (opts.width) {
        var content = el.querySelector('.luban-modal');
        if (content) {
          content.style.width = typeof opts.width === 'number' ? opts.width + 'px' : opts.width;
        }
      }

      // 点击遮罩关闭
      var closable = opts.closable !== false;
      el._closable = closable;
      el._onClose = opts.onClose;

      el.addEventListener('click', function handler(e) {
        if (e.target === el && el._closable !== false) {
          window.LubanUI.modal.close(id);
        }
      });

      // 关闭按钮
      var closeBtns = el.querySelectorAll('[data-modal-close]');
      closeBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
          window.LubanUI.modal.close(id);
        });
      });
    },
    close: function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.style.display = 'none';
      document.body.style.overflow = '';
      openModals = openModals.filter(function(m) { return m !== el; });
      if (el._onClose) el._onClose();
    }
  };

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && openModals.length > 0) {
      var top = openModals[openModals.length - 1];
      if (top._closable !== false) {
        window.LubanUI.modal.close(top.id);
      }
    }
  });
})();