// LubanUI — JS API 主入口
// 此文件会被注入到 iframe 中

window.LubanUI = window.LubanUI || {};

(function() {
  'use strict';
  var UI = window.LubanUI;

  // ==========================================
  // Tabs — 标签页切换
  // ==========================================
  UI.initTabs = function(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.addEventListener('click', function(e) {
      var tab = e.target.closest('.luban-tab-item');
      if (!tab) return;
      var tabName = tab.getAttribute('data-tab');
      var nav = tab.closest('.luban-tabs-nav');
      var tabs = nav.closest('.luban-tabs');

      nav.querySelectorAll('.luban-tab-item').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');

      tabs.querySelectorAll('.luban-tab-content').forEach(function(c) { c.classList.remove('active'); });
      var content = tabs.querySelector('.luban-tab-content[data-tab="' + tabName + '"]');
      if (content) content.classList.add('active');
    });
  };

  // ==========================================
  // Form — 表单取值
  // ==========================================
  UI.getFormData = function(formId) {
    var form = document.getElementById(formId);
    if (!form) return {};
    var data = {};
    form.querySelectorAll('[name]').forEach(function(el) {
      var name = el.getAttribute('name');
      if (el.type === 'checkbox') {
        if (!data[name]) data[name] = [];
        if (el.checked) data[name].push(el.value);
      } else if (el.type === 'radio') {
        if (el.checked) data[name] = el.value;
      } else {
        data[name] = el.value;
      }
    });
    return data;
  };

  // ==========================================
  // Chart — ECharts 封装
  // ==========================================
  UI.chart = function(containerId, config) {
    var container = document.getElementById(containerId);
    if (!container) return null;
    if (typeof echarts === 'undefined') {
      console.warn('LubanUI: ECharts 未加载');
      return null;
    }
    var instance = echarts.init(container);
    instance.setOption(config);
    return instance;
  };
})();