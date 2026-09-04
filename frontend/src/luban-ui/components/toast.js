/* ============================================
   Toast JS（与平台一致）
   LubanUI.toast.success(msg) / .error(msg) / .warning(msg) / .info(msg)
   ============================================ */

(function() {
  'use strict';

  window.LubanUI = window.LubanUI || {};

  var ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  var CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  var TITLES = { success: '成功', error: '错误', warning: '警告', info: '提示' };

  function ensureContainer() {
    var container = document.getElementById('__luban_toast__');
    if (!container) {
      container = document.createElement('div');
      container.id = '__luban_toast__';
      container.className = 'luban-toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function show(type, message, duration) {
    duration = duration || 4000;
    var container = ensureContainer();

    var toast = document.createElement('div');
    toast.className = 'luban-toast luban-toast-' + type;

    toast.innerHTML =
      '<span class="luban-toast-icon">' + (ICONS[type] || ICONS.info) + '</span>' +
      '<div class="luban-toast-body">' +
        '<div class="luban-toast-title">' + (TITLES[type] || '提示') + '</div>' +
        '<div class="luban-toast-message">' + escapeHtml(message) + '</div>' +
      '</div>' +
      '<button class="luban-toast-close">' + CLOSE_ICON + '</button>' +
      '<div class="luban-toast-progress" style="animation-duration:' + (duration / 1000) + 's"></div>';

    container.appendChild(toast);

    var closeBtn = toast.querySelector('.luban-toast-close');
    closeBtn.addEventListener('click', function() { dismiss(toast); });

    if (duration > 0) {
      var timer = setTimeout(function() { dismiss(toast); }, duration);
      toast._timer = timer;
    }
  }

  function dismiss(toast) {
    if (toast._dismissing) return;
    toast._dismissing = true;
    if (toast._timer) clearTimeout(toast._timer);
    toast.classList.add('luban-toast-leaving');
    setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 200);
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  window.LubanUI.toast = {
    success: function(msg, dur) { show('success', msg, dur); },
    error: function(msg, dur) { show('error', msg, dur); },
    warning: function(msg, dur) { show('warning', msg, dur); },
    info: function(msg, dur) { show('info', msg, dur); }
  };
})();