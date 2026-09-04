/* ============================================
   Table JS — 分页、排序逻辑
   LubanUI.table(containerId, config)
   ============================================ */

(function() {
  'use strict';

  var defaultConfig = {
    pageSize: 10,
    pageSizes: [10, 20, 50],
    initialSort: null,
    emptyText: '暂无数据',
    loadingText: '加载中...',
    render: {}
  };

  function tbody(container) {
    return container.querySelector('tbody');
  }

  function render(container, config) {
    var _tbody = tbody(container);
    if (!_tbody) return;

    var data = config.data || [];
    var page = config._page || 1;
    var pageSize = config.pageSize || defaultConfig.pageSize;
    var sortKey = config._sortKey || null;
    var sortDir = config._sortDir || 'asc';

    var rows = data.slice();

    if (sortKey) {
      rows.sort(function(a, b) {
        var va = (String(a[sortKey] || '')).toLowerCase();
        var vb = (String(b[sortKey] || '')).toLowerCase();
        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }

    var columns = config.columns || [];
    var ths = container.querySelectorAll('thead th');
    ths.forEach(function(th, idx) {
      th.classList.remove('sort-asc', 'sort-desc');
      if (sortKey && columns[idx] === sortKey) {
        th.classList.add('sort-' + sortDir);
      }
    });

    var total = rows.length;
    var paged = rows.slice((page - 1) * pageSize, page * pageSize);

    _tbody.innerHTML = '';

    if (paged.length === 0) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = container.querySelectorAll('thead th').length || 1;
      td.className = 'luban-table-empty';
      if (config._loading) {
        td.textContent = config.loadingText || defaultConfig.loadingText;
      } else if (data.length === 0) {
        var emptyHtml = '<div class="luban-empty luban-empty-simple">'
          + '<div class="luban-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></div>'
          + '<div class="luban-empty-text">' + (config.emptyText || defaultConfig.emptyText) + '</div>';
        if (config.emptyDescription) {
          emptyHtml += '<div class="luban-empty-description">' + config.emptyDescription + '</div>';
        }
        if (config.emptyAction) {
          emptyHtml += '<button class="luban-btn luban-btn-sm luban-btn-primary" onclick="' + config.emptyAction + '">' + (config.emptyActionText || '立即创建') + '</button>';
        }
        emptyHtml += '</div>';
        td.innerHTML = emptyHtml;
      } else {
        td.textContent = '';
      }
      tr.appendChild(td);
      _tbody.appendChild(tr);
    } else {
      paged.forEach(function(row, rowIdx) {
        var tr = document.createElement('tr');
        if (config.onRowClick) {
          tr.style.cursor = 'pointer';
          tr.addEventListener('click', function() {
            config.onRowClick(row, (page - 1) * pageSize + rowIdx);
          });
        }
        columns.forEach(function(col) {
          var td = document.createElement('td');
          var val = row[col] != null ? row[col] : '';
          if (config.render && config.render[col]) {
            td.innerHTML = config.render[col](val, row);
          } else {
            td.textContent = String(val);
          }
          tr.appendChild(td);
        });
        _tbody.appendChild(tr);
      });
    }

    if (config._page !== page) {
      config._page = page;
      renderPagination(container, config, total, page, pageSize);
    }
  }

  function renderPagination(container, config, total, page, pageSize) {
    var paginationEl = container.parentElement ? container.parentElement.querySelector('.luban-pagination') : null;
    if (!paginationEl) {
      paginationEl = container.nextElementSibling;
      if (!paginationEl || !paginationEl.classList.contains('luban-pagination')) {
        paginationEl = document.createElement('div');
        paginationEl.className = 'luban-pagination';
        container.parentElement ? container.parentElement.insertBefore(paginationEl, container.nextSibling) : container.insertAdjacentElement('afterend', paginationEl);
      }
    }

    var totalPages = Math.ceil(total / pageSize);
    if (totalPages <= 1) {
      paginationEl.innerHTML = '';
      return;
    }

    var html = '';
    html += '<span class="luban-pagination-info">共 ' + total + ' 条，第 ' + page + '/' + totalPages + ' 页</span>';
    html += '<button class="luban-btn luban-btn-sm' + (page === 1 ? ' disabled' : '') + '" data-page="1"' + (page === 1 ? ' disabled' : '') + '>首页</button>';
    html += '<button class="luban-btn luban-btn-sm' + (page === 1 ? ' disabled' : '') + '" data-page="' + (page - 1) + '"' + (page === 1 ? ' disabled' : '') + '>上一页</button>';

    var start = Math.max(1, page - 2);
    var end = Math.min(totalPages, page + 2);
    for (var i = start; i <= end; i++) {
      html += '<button class="luban-btn luban-btn-sm' + (i === page ? ' luban-btn-primary' : '') + '" data-page="' + i + '">' + i + '</button>';
    }

    html += '<button class="luban-btn luban-btn-sm' + (page === totalPages ? ' disabled' : '') + '" data-page="' + (page + 1) + '"' + (page === totalPages ? ' disabled' : '') + '>下一页</button>';
    html += '<button class="luban-btn luban-btn-sm' + (page === totalPages ? ' disabled' : '') + '" data-page="' + totalPages + '"' + (page === totalPages ? ' disabled' : '') + '>末页</button>';
    paginationEl.innerHTML = html;

    paginationEl.querySelectorAll('button[data-page]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var p = parseInt(this.getAttribute('data-page'));
        if (!isNaN(p) && p !== config._page) {
          config._page = p;
          render(container, config);
        }
      });
    });
  }

  window.LubanUI = window.LubanUI || {};

  window.LubanUI.table = function(containerId, config) {
    var container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!container) return;

    config = Object.assign({}, defaultConfig, config);
    config._page = config._page || 1;
    config._sortKey = config.initialSort ? config.initialSort.key : null;
    config._sortDir = config.initialSort ? config.initialSort.dir : 'asc';

    var ths = container.querySelectorAll('thead th');
    ths.forEach(function(th, idx) {
      var col = config.columns ? config.columns[idx] : null;
      if (col && th.classList.contains('sortable')) {
        th.addEventListener('click', function() {
          if (config._sortKey === col) {
            config._sortDir = config._sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            config._sortKey = col;
            config._sortDir = 'asc';
          }
          config._page = 1;
          render(container, config);
        });
      }
    });

    if (config.initialSort) {
      ths.forEach(function(th, idx) {
        th.classList.remove('sort-asc', 'sort-desc');
        if (config.columns && config.columns[idx] === config.initialSort.key) {
          th.classList.add('sort-' + (config.initialSort.dir || 'asc'));
        }
      });
    }

    render(container, config);
    return {
      setData: function(data) {
        config.data = data;
        config._loading = false;
        config._page = 1;
        render(container, config);
      },
      refresh: function() {
        render(container, config);
      },
      setPage: function(p) {
        config._page = p;
        render(container, config);
      },
      setLoading: function(loading) {
        config._loading = loading;
        render(container, config);
      }
    };
  };
})();