(function(LubanUI) {
  var activeSelect = null;

  function closeAll() {
    if (activeSelect) {
      activeSelect.container.classList.remove('luban-select-open');
      activeSelect = null;
    }
  }

  document.addEventListener('click', function(e) {
    if (activeSelect && !activeSelect.container.contains(e.target)) {
      closeAll();
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && activeSelect) {
      closeAll();
    }
  });

  /**
   * 将原生 <select> 替换为自定义下拉，支持树形选项
   * 用法: LubanUI.select('#mySelect')
   */
  LubanUI.select = function(selector) {
    var el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el || el.tagName !== 'SELECT') return;
    if (el._lubanSelect) return el._lubanSelect;

    // 构建容器
    var container = document.createElement('div');
    container.className = 'luban-select';
    if (el.disabled) container.classList.add('luban-select-disabled');

    // 隐藏原生 select
    el.classList.add('luban-select-native');
    el.style.display = 'none';

    // 构建 trigger
    var trigger = document.createElement('div');
    trigger.className = 'luban-select-trigger';

    var valueEl = document.createElement('span');
    valueEl.className = el.value ? 'luban-select-value' : 'luban-select-placeholder';

    var arrowEl = document.createElement('span');
    arrowEl.className = 'luban-select-arrow';
    arrowEl.innerHTML = '<svg viewBox="0 0 10 10"><path fill="currentColor" d="M5 7L1 3h8z"/></svg>';

    trigger.appendChild(valueEl);
    trigger.appendChild(arrowEl);

    // 构建下拉
    var dropdown = document.createElement('div');
    dropdown.className = 'luban-select-dropdown';

    // 选项数据 + 展开状态
    var options = [];
    var expanded = {};

    // 从原生 <option> 读取
    var optionEls = el.querySelectorAll('option');
    for (var i = 0; i < optionEls.length; i++) {
      var opt = optionEls[i];
      options.push({
        value: opt.value,
        label: opt.textContent || opt.innerText,
        disabled: opt.disabled
      });
    }

    /** 递归查找 label */
    function findLabel(list, val) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].value === val) return list[i].label;
        if (list[i].children) {
          var found = findLabel(list[i].children, val);
          if (found) return found;
        }
      }
      return '';
    }

    function updateValue() {
      var label = findLabel(options, el.value);
      if (label && el.value !== '') {
        valueEl.textContent = label;
        valueEl.className = 'luban-select-value';
      } else {
        valueEl.textContent = el.getAttribute('placeholder') || '请选择';
        valueEl.className = 'luban-select-placeholder';
      }
    }

    /** 递归渲染选项 */
    function renderList(list, level) {
      level = level || 0;
      for (var i = 0; i < list.length; i++) {
        var opt = list[i];
        var hasChildren = opt.children && opt.children.length > 0;
        var isExpanded = expanded[opt.value] !== false; // 默认展开

        var optEl = document.createElement('div');
        optEl.className = 'luban-select-option';
        if (opt.value === el.value) optEl.classList.add('selected');
        if (opt.disabled) optEl.classList.add('disabled');
        optEl.style.paddingLeft = (12 + level * 16) + 'px';
        optEl.setAttribute('data-value', opt.value);

        // 展开/折叠图标
        if (hasChildren) {
          var expandIcon = document.createElement('span');
          expandIcon.className = 'luban-select-expand';
          expandIcon.textContent = isExpanded ? '▼' : '▶';
          expandIcon.addEventListener('click', function(e) {
            e.stopPropagation();
            var val = this.parentNode.getAttribute('data-value');
            if (expanded[val] === false) {
              expanded[val] = true;
            } else {
              expanded[val] = false;
            }
            renderOptions();
          });
          optEl.appendChild(expandIcon);
        }

        var labelSpan = document.createElement('span');
        labelSpan.textContent = opt.label;
        optEl.appendChild(labelSpan);

        // 点击选择
        optEl.addEventListener('click', function(e) {
          e.stopPropagation();
          var val = this.getAttribute('data-value');
          var od = findOption(options, val);
          if (od && od.disabled) return;
          if (od && od.children) {
            // 点击父节点：切换展开
            if (expanded[val] === false) {
              expanded[val] = true;
            } else {
              expanded[val] = false;
            }
            renderOptions();
            return;
          }
          el.value = val;
          updateValue();
          renderOptions();
          closeAll();
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });

        dropdown.appendChild(optEl);

        if (hasChildren && isExpanded) {
          renderList(opt.children, level + 1);
        }
      }
    }

    /** 递归查找选项 */
    function findOption(list, val) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].value === val) return list[i];
        if (list[i].children) {
          var found = findOption(list[i].children, val);
          if (found) return found;
        }
      }
      return null;
    }

    function renderOptions() {
      dropdown.innerHTML = '';
      renderList(options, 0);
    }

    updateValue();
    renderOptions();

    // 插入容器到原生 select 前面，再把原生 select 移入容器
    var parent = el.parentNode;
    parent.insertBefore(container, el);
    container.appendChild(el);
    container.appendChild(trigger);
    container.appendChild(dropdown);

    // 事件
    trigger.addEventListener('click', function(e) {
      e.stopPropagation();
      if (el.disabled) return;
      if (activeSelect && activeSelect.container === container) {
        closeAll();
      } else {
        closeAll();
        container.classList.add('luban-select-open');
        activeSelect = { container: container, el: el };

        // 判断是否需要向上弹出
        var rect = dropdown.getBoundingClientRect();
        var dropdownHeight = dropdown.scrollHeight;
        var spaceBelow = window.innerHeight - rect.top;
        if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
          dropdown.classList.add('luban-select-dropup');
        } else {
          dropdown.classList.remove('luban-select-dropup');
        }

        // 滚动到选中项
        var selected = dropdown.querySelector('.luban-select-option.selected');
        if (selected) {
          selected.scrollIntoView({ block: 'nearest' });
        }
      }
    });

    /** 扁平化选项（用于原生 select 备份） */
    function flatten(list, acc) {
      acc = acc || [];
      for (var i = 0; i < list.length; i++) {
        acc.push(list[i]);
        if (list[i].children) flatten(list[i].children, acc);
      }
      return acc;
    }

    var api = {
      container: container,
      el: el,
      getValue: function() { return el.value; },
      setValue: function(val) {
        el.value = val;
        updateValue();
        renderOptions();
      },
      setOptions: function(newOptions) {
        options = newOptions;
        expanded = {};
        // 同步到原生 select（扁平化）
        el.innerHTML = '';
        var flat = flatten(newOptions);
        for (var i = 0; i < flat.length; i++) {
          var o = document.createElement('option');
          o.value = flat[i].value;
          o.textContent = flat[i].label;
          if (flat[i].disabled) o.disabled = true;
          el.appendChild(o);
        }
        updateValue();
        renderOptions();
      },
      destroy: function() {
        closeAll();
        el.classList.remove('luban-select-native');
        el.style.display = '';
        container.parentNode.insertBefore(el, container);
        container.parentNode.removeChild(container);
        delete el._lubanSelect;
      }
    };

    el._lubanSelect = api;
    return api;
  };

  // 自动初始化页面中所有 .luban-select 的 select
  LubanUI.initSelects = function(root) {
    root = root || document;
    var selects = root.querySelectorAll('select.luban-select');
    for (var i = 0; i < selects.length; i++) {
      LubanUI.select(selects[i]);
    }
  };

})(window.LubanUI = window.LubanUI || {});