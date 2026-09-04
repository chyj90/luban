/* ============================================
   PageHeader JS — 页面标题栏
   LubanUI.pageHeader(containerId, config)

   config: {
     title: string,              // 必填，页面标题
     description: string,        // 可选，标题下方描述
     breadcrumb: [               // 可选，面包屑
       { label: '首页', href: '#' },
       { label: '当前页', active: true }
     ],
     stats: [                    // 可选，标题上方统计卡
       { label: '员工总数', value: 128, color: 'primary' },
       { label: '本月新增', value: 12, color: 'success' }
     ],
     actions: [                  // 可选，右侧操作按钮（HTML 字符串）
       '<button class="luban-btn luban-btn-primary" onclick="...">新增</button>',
       '<button class="luban-btn" onclick="...">导出</button>'
     ],
     badge: {                    // 可选，右侧状态标签
       text: '已完成',
       color: 'success'          // default | primary | success | warning | danger | info
     }
   }
   ============================================ */

(function() {
  'use strict';

  var colorMap = {
    primary: 'luban-badge-primary',
    success: 'luban-badge-success',
    warning: 'luban-badge-warning',
    danger: 'luban-badge-danger',
    info: 'luban-badge-info',
    default: ''
  };

  function buildBreadcrumb(items) {
    if (!items || !items.length) return '';
    var html = '<div class="luban-page-header-breadcrumb">';
    items.forEach(function(item, i) {
      if (i > 0) html += '<span class="luban-breadcrumb-sep">/</span>';
      if (item.active) {
        html += '<span class="luban-breadcrumb-active">' + escapeHtml(item.label) + '</span>';
      } else if (item.href) {
        html += '<a href="' + escapeHtml(item.href) + '">' + escapeHtml(item.label) + '</a>';
      } else {
        html += '<span>' + escapeHtml(item.label) + '</span>';
      }
    });
    html += '</div>';
    return html;
  }

  function buildStats(items) {
    if (!items || !items.length) return '';
    var html = '<div class="luban-stats-grid luban-page-header-stats">';
    items.forEach(function(s) {
      var cls = s.color ? ' luban-stat-card-' + s.color : '';
      html += '<div class="luban-stat-card' + cls + '">';
      html += '<div class="luban-stat-label">' + escapeHtml(s.label) + '</div>';
      html += '<div class="luban-stat-value">' + escapeHtml(String(s.value)) + '</div>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function buildActions(actions) {
    if (!actions || !actions.length) return '';
    return '<div class="luban-page-header-right">' + actions.join('') + '</div>';
  }

  function buildBadge(badge) {
    if (!badge) return '';
    var cls = 'luban-badge';
    if (badge.color && colorMap[badge.color]) cls += ' ' + colorMap[badge.color];
    return '<div class="luban-page-header-right"><span class="' + cls + '" style="font-size:13px;padding:4px 12px;">' + escapeHtml(badge.text) + '</span></div>';
  }

  function buildRight(config) {
    if (config.actions && config.actions.length) return buildActions(config.actions);
    if (config.badge) return buildBadge(config.badge);
    return '';
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') str = String(str);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.LubanUI = window.LubanUI || {};

  window.LubanUI.pageHeader = function(containerId, config) {
    var container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!container) {
      console.warn('LubanUI.pageHeader: 容器不存在:', containerId);
      return;
    }
    config = config || {};

    var html = '<div class="luban-page-header">';

    // 面包屑
    if (config.breadcrumb) {
      html += buildBreadcrumb(config.breadcrumb);
    }

    // 统计卡
    if (config.stats) {
      html += buildStats(config.stats);
    }

    // 标题行
    var hasRight = (config.actions && config.actions.length) || config.badge;
    html += '<div class="luban-page-header-row">';
    html += '<div class="luban-page-header-left">';
    html += '<h1 class="luban-page-header-title">' + escapeHtml(config.title || '') + '</h1>';
    if (config.description) {
      html += '<p class="luban-page-header-desc">' + escapeHtml(config.description) + '</p>';
    }
    html += '</div>';
    if (hasRight) {
      html += buildRight(config);
    }
    html += '</div>';

    html += '</div>';

    container.innerHTML = html;
  };
})();