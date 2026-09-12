// LubanUI — JS API 主入口
// 此文件会被注入到 iframe 中

window.LubanUI = window.LubanUI || {};

(function() {
  'use strict';
  var UI = window.LubanUI;

  // ==========================================
  // Theme — 深浅主题切换
  // ==========================================
  UI.setTheme = function(theme) {
    var el = document.documentElement;
    if (theme === 'dark') {
      el.setAttribute('data-theme', 'dark');
    } else {
      el.removeAttribute('data-theme');
    }
    UI._currentTheme = theme;
  };

  UI.getTheme = function() {
    return UI._currentTheme || (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  };

  UI.toggleTheme = function() {
    var current = UI.getTheme();
    UI.setTheme(current === 'dark' ? 'light' : 'dark');
  };

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
  // Chart — ECharts 封装（自动适配主题）
  // ==========================================
  UI.chart = function(containerId, config) {
    var container = document.getElementById(containerId);
    if (!container) return null;
    if (typeof echarts === 'undefined') {
      console.warn('LubanUI: ECharts 未加载');
      return null;
    }
    var isDark = UI.getTheme() === 'dark';
    var instance = echarts.init(container, isDark ? 'dark' : undefined);
    instance.setOption(config);
    return instance;
  };

  // ==========================================
  // Chart Presets — 内置美观图表预设
  // 所有预设均支持：
  //   colors: string[]    自定义配色，自动适配深浅主题
  //   overrides: object   ECharts option 深合并，可覆盖任意子属性
  // ==========================================
  UI.chartPresets = {};

  var F = UI.chartPresets;

  function mergeDeep(target, source) {
    if (!source || typeof source !== 'object') return target;
    var result = target;
    if (Array.isArray(source) && Array.isArray(target)) { return source; }
    for (var key in source) {
      if (source.hasOwnProperty(key)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
          result[key] = mergeDeep(target[key], source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }
    return result;
  }

  function finalizeOption(option, opts) {
    if (opts.overrides) { option = mergeDeep(option, opts.overrides); }
    return option;
  }

  // ===== 整屏配色 token：setVisualStyle 后所有预设默认从风格取色，保证整屏配色统一 =====
  UI.setVisualStyle = function(name) {
    if (!UI.visualStyle[name]) {
      console.warn('LubanUI: 未知视觉风格 "' + name + '"，可选：' + Object.keys(UI.visualStyle).join('、'));
      return;
    }
    UI._activeStyle = name;
  };
  UI.getVisualStyle = function() { return UI._activeStyle || null; };
  function styleToken() { return (UI._activeStyle && UI.visualStyle[UI._activeStyle]) || null; }
  function tokenColors(kind, isDark, fallback) {
    var st = styleToken();
    if (st && st.chart && st.chart[kind] && st.chart[kind].length) return st.chart[kind];
    return fallback;
  }
  function lighten(hex, t) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var n = parseInt(h, 16);
    var r = (n>>16)&255, g = (n>>8)&255, b = n&255;
    r = Math.round(r+(255-r)*t); g = Math.round(g+(255-g)*t); b = Math.round(b+(255-b)*t);
    return 'rgb('+r+','+g+','+b+')';
  }
  function darken(hex, t) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var n = parseInt(h, 16);
    var r = Math.round(((n>>16)&255)*(1-t)), g = Math.round(((n>>8)&255)*(1-t)), b = Math.round((n&255)*(1-t));
    return 'rgb('+r+','+g+','+b+')';
  }

  F.bar = function(containerId, opts) {
    opts = opts || {};
    var isDark = UI.getTheme() === 'dark';
    if (opts.theme === 'light') isDark = false;
    var data = opts.data || [];
    var categories = opts.categories || data.map(function(_, i) { return '项' + (i + 1); });
    var colors = opts.colors || tokenColors('barColors', isDark, (isDark
      ? ['#4dabf7', '#74c0fc', '#3bc9db', '#63e6be']
      : ['#1677ff', '#4096ff', '#69b1ff', '#91caff']));

    var option = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '8%', containLabel: true },
      xAxis: { type: 'category', data: categories, axisLabel: { color: isDark ? '#94a3b8' : '#64748b' }, axisLine: { lineStyle: { color: isDark ? '#334155' : '#e2e8f0' } } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: isDark ? '#1e293b' : '#f1f5f9' } }, axisLabel: { color: isDark ? '#94a3b8' : '#64748b' } },
      series: [{
        type: 'bar',
        data: data,
        barWidth: opts.barWidth || '50%',
        itemStyle: {
          borderRadius: opts.borderRadius || [6, 6, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: colors[0] },
            { offset: 1, color: colors[1] || colors[0] }
          ])
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: isDark ? 'rgba(77,171,247,0.5)' : 'rgba(22,119,255,0.3)',
            shadowOffsetY: 2
          }
        },
        label: opts.showLabel ? { show: true, position: 'top', color: isDark ? '#e2e8f0' : '#1e293b' } : undefined
      }]
    };
    return UI.chart(containerId, finalizeOption(option, opts));
  };

  F.line = function(containerId, opts) {
    opts = opts || {};
    var isDark = UI.getTheme() === 'dark';
    if (opts.theme === 'light') isDark = false;
    var categories = opts.categories || [];
    var seriesData = opts.series || [{ name: '数据', data: opts.data || [] }];
    var lineColors = opts.colors || tokenColors('lineColors', isDark, isDark
      ? ['#4dabf7', '#4ade80', '#fbbf24', '#f87171']
      : ['#1677ff', '#22c55e', '#f59e0b', '#ef4444']);

    var option = {
      tooltip: { trigger: 'axis' },
      legend: opts.legend !== false ? {
        data: seriesData.map(function(s) { return s.name; }),
        textStyle: { color: isDark ? '#94a3b8' : '#64748b' },
        bottom: 0
      } : undefined,
      grid: { left: '3%', right: '4%', bottom: opts.legend !== false ? '12%' : '3%', top: '8%', containLabel: true },
      xAxis: { type: 'category', data: categories, boundaryGap: false, axisLabel: { color: isDark ? '#94a3b8' : '#64748b' }, axisLine: { lineStyle: { color: isDark ? '#334155' : '#e2e8f0' } } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: isDark ? '#1e293b' : '#f1f5f9' } }, axisLabel: { color: isDark ? '#94a3b8' : '#64748b' } },
      series: seriesData.map(function(s, i) {
        return {
          name: s.name,
          type: 'line',
          data: s.data,
          smooth: opts.smooth !== false,
          symbol: opts.symbol || 'circle',
          symbolSize: 6,
          lineStyle: { width: 2.5, color: s.color || lineColors[i % lineColors.length] },
          itemStyle: { color: s.color || lineColors[i % lineColors.length] },
          areaStyle: opts.area ? {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: (s.areaColor || lineColors[i % lineColors.length]) },
              { offset: 1, color: isDark ? 'rgba(15,23,42,0)' : 'rgba(255,255,255,0)' }
            ])
          } : undefined
        };
      })
    };
    return UI.chart(containerId, finalizeOption(option, opts));
  };

  F.pie = function(containerId, opts) {
    opts = opts || {};
    var isDark = UI.getTheme() === 'dark';
    if (opts.theme === 'light') isDark = false;
    var data = opts.data || [];
    var pieColors = opts.colors || tokenColors('pieColors', isDark, isDark
      ? ['#4dabf7', '#4ade80', '#fbbf24', '#f87171', '#c084fc', '#3bc9db', '#f472b6', '#a78bfa']
      : ['#1677ff', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#6366f1']);

    var option = {
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: opts.legend !== false ? {
        orient: opts.legendOrient || 'horizontal',
        bottom: 0,
        textStyle: { color: isDark ? '#94a3b8' : '#64748b' }
      } : undefined,
      series: [{
        type: 'pie',
        radius: opts.radius || ['45%', '70%'],
        center: ['50%', opts.legend !== false ? '45%' : '50%'],
        roseType: opts.rose ? 'area' : undefined,
        itemStyle: {
          borderRadius: opts.radius ? 4 : 8,
          borderColor: isDark ? '#0f172a' : '#fff',
          borderWidth: 2
        },
        label: {
          show: opts.showLabel !== false,
          color: isDark ? '#94a3b8' : '#64748b'
        },
        emphasis: {
          label: { show: true, fontSize: 16, fontWeight: 'bold' },
          itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.2)' }
        },
        data: data,
        color: pieColors
      }]
    };
    return UI.chart(containerId, finalizeOption(option, opts));
  };

  // 3D 柱状图 — 使用 echarts-gl
  F.bar3d = function(containerId, opts) {
    opts = opts || {};
    if (typeof echarts === 'undefined' || !echarts.gl) {
      console.warn('LubanUI: echarts-gl 未加载，降级为 2D 柱状图');
      return F.bar(containerId, opts);
    }
    var container = document.getElementById(containerId);
    if (!container) return null;
    var isDark = UI.getTheme() === 'dark';
    var instance = echarts.init(container, isDark ? 'dark' : undefined);

    var data = opts.data || [];
    var xLabels = opts.xLabels || data.map(function(_, i) { return '项' + (i + 1); });
    var zLabels = opts.zLabels || ['系列1'];

    var chartData = data.map(function(val, xi) {
      return [xi, val, 0];
    });

    var option = {
      tooltip: {},
      visualMap: {
        max: Math.max.apply(null, data),
        inRange: { color: isDark ? ['#1e3a5f', '#4dabf7', '#74c0fc'] : ['#e6f4ff', '#4096ff', '#1677ff'] }
      },
      xAxis3D: { type: 'category', data: xLabels, name: opts.xName || '' },
      yAxis3D: { type: 'value', name: opts.yName || '' },
      zAxis3D: { type: 'category', data: zLabels, name: opts.zName || '' },
      grid3D: {
        viewControl: { autoRotate: opts.autoRotate !== false, autoRotateSpeed: opts.rotateSpeed || 6 },
        boxWidth: opts.boxWidth || 80,
        boxDepth: opts.boxDepth || 40,
        light: { main: { intensity: 1.2 }, ambient: { intensity: 0.4 } }
      },
      series: [{ type: 'bar3D', data: chartData, shading: 'lambert', label: { show: opts.showLabel, fontSize: 12 } }]
    };
    instance.setOption(option);
    return instance;
  };

  // 3D 折线图 — 使用 echarts-gl
  F.line3d = function(containerId, opts) {
    opts = opts || {};
    if (typeof echarts === 'undefined' || !echarts.gl) {
      console.warn('LubanUI: echarts-gl 未加载，降级为 2D 折线图');
      return F.line(containerId, opts);
    }
    var container = document.getElementById(containerId);
    if (!container) return null;
    var instance = echarts.init(container);

    var data = opts.data || [];
    var chartData = data.map(function(val, i) { return [i, val, 0]; });

    var option = {
      tooltip: {},
      xAxis3D: { type: 'value', name: opts.xName || 'X' },
      yAxis3D: { type: 'value', name: opts.yName || 'Y' },
      zAxis3D: { type: 'value', name: opts.zName || 'Z' },
      grid3D: { viewControl: { autoRotate: opts.autoRotate !== false, autoRotateSpeed: opts.rotateSpeed || 8 } },
      series: [{ type: 'line3D', data: chartData, lineStyle: { width: 3, color: '#4dabf7' } }]
    };
    instance.setOption(option);
    return instance;
  };

  // 3D 饼图 — 使用 echarts-gl (surface 实现立体效果)
  F.pie3d = function(containerId, opts) {
    opts = opts || {};
    if (typeof echarts === 'undefined' || !echarts.gl) {
      console.warn('LubanUI: echarts-gl 未加载，降级为 2D 饼图');
      return F.pie(containerId, opts);
    }
    // pie3D 使用 surface3D 构造立体扇形，降级处理走 2D 豪华饼图
    console.warn('LubanUI: pie3D 暂不支持原生 echarts-gl，使用豪华 2D 饼图替代');
    return F.pie(containerId, Object.assign({}, opts, { radius: ['40%', '70%'], rose: true }));
  };

  // 漏斗图预设
  F.funnel = function(containerId, opts) {
    opts = opts || {};
    var isDark = UI.getTheme() === 'dark';
    var data = opts.data || [];
    var option = {
      tooltip: { trigger: 'item', formatter: '{b}: {c}' },
      series: [{
        type: 'funnel',
        left: '10%',
        right: '10%',
        top: 60,
        bottom: 60,
        min: 0,
        max: opts.max || 100,
        sort: opts.sort || 'descending',
        gap: 2,
        label: { show: true, position: 'inside', color: '#fff' },
        itemStyle: { borderColor: isDark ? '#0f172a' : '#fff', borderWidth: 1 },
        emphasis: { label: { fontSize: 16 } },
        data: data
      }]
    };
    return UI.chart(containerId, finalizeOption(option, opts));
  };

  // 仪表盘预设
  F.gauge = function(containerId, opts) {
    opts = opts || {};
    var isDark = UI.getTheme() === 'dark';
    var option = {
      tooltip: { formatter: '{b}: {c}' + (opts.unit || '%') },
      series: [{
        type: 'gauge',
        startAngle: opts.startAngle || 210,
        endAngle: opts.endAngle || -30,
        center: ['50%', '60%'],
        radius: '90%',
        min: opts.min || 0,
        max: opts.max || 100,
        splitNumber: opts.splitNumber || 10,
        axisLine: {
          show: true,
          lineStyle: {
            width: opts.lineWidth || 20,
            color: [
              [opts.thresholds ? opts.thresholds[0] / (opts.max || 100) : 0.3, '#22c55e'],
              [opts.thresholds ? opts.thresholds[1] / (opts.max || 100) : 0.7, '#f59e0b'],
              [1, '#ef4444']
            ]
          }
        },
        pointer: { length: '70%', width: 6, itemStyle: { color: isDark ? '#e2e8f0' : '#1e293b' } },
        detail: {
          formatter: '{value}' + (opts.unit || '%'),
          fontSize: 28,
          fontWeight: 'bold',
          color: isDark ? '#e2e8f0' : '#1e293b',
          offsetCenter: [0, '70%']
        },
        data: [{ value: opts.value || 0, name: opts.name || '指标' }]
      }]
    };
    return UI.chart(containerId, finalizeOption(option, opts));
  };

  // 雷达图预设
  F.radar = function(containerId, opts) {
    opts = opts || {};
    var isDark = UI.getTheme() === 'dark';
    var indicators = (opts.indicators || []).map(function(ind) {
      return { name: ind.name || ind, max: ind.max || 100 };
    });
    var option = {
      tooltip: {},
      legend: opts.legend !== false ? { bottom: 0, textStyle: { color: isDark ? '#94a3b8' : '#64748b' } } : undefined,
      radar: {
        indicator: indicators,
        shape: opts.shape || 'polygon',
        splitNumber: 5,
        axisName: { color: isDark ? '#94a3b8' : '#64748b' },
        splitArea: { areaStyle: { color: isDark ? ['rgba(255,255,255,0.02)', 'rgba(255,255,255,0.04)'] : ['rgba(0,0,0,0.02)', 'rgba(0,0,0,0.04)'] } }
      },
      series: [{
        type: 'radar',
        data: opts.series || [],
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { width: 2 },
        areaStyle: opts.area !== false ? { opacity: 0.2 } : undefined
      }]
    };
    return UI.chart(containerId, finalizeOption(option, opts));
  };

  // 散点图预设
  F.scatter = function(containerId, opts) {
    opts = opts || {};
    var isDark = UI.getTheme() === 'dark';
    var option = {
      tooltip: { trigger: 'item' },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '8%', containLabel: true },
      xAxis: { type: 'value', name: opts.xName || '', splitLine: { lineStyle: { color: isDark ? '#1e293b' : '#f1f5f9' } } },
      yAxis: { type: 'value', name: opts.yName || '', splitLine: { lineStyle: { color: isDark ? '#1e293b' : '#f1f5f9' } } },
      series: [{
        type: 'scatter',
        data: opts.data || [],
        symbolSize: opts.symbolSize || 10,
        itemStyle: {
          shadowBlur: 4,
          shadowColor: isDark ? 'rgba(77,171,247,0.4)' : 'rgba(22,119,255,0.2)',
          shadowOffsetY: 2
        }
      }]
    };
    return UI.chart(containerId, finalizeOption(option, opts));
  };

  // 组合图表（柱状图 + 折线图双 Y 轴，运营商监控大屏常用）
  F.combo = function(containerId, opts) {
    opts = opts || {};
    var isDark = UI.getTheme() === 'dark';
    if (opts.theme === 'light') isDark = false;
    var categories = opts.categories || [];
    var colors = opts.colors || tokenColors('barColors', isDark, (isDark
      ? ['#4dabf7', '#4ade80', '#fbbf24']
      : ['#1677ff', '#22c55e', '#f59e0b']));

    var bars = opts.bars || [];
    var lines = opts.lines || [];
    var hasBars = bars.length > 0;
    var hasLines = lines.length > 0;

    var series = [];

    for (var bi = 0; bi < bars.length; bi++) {
      var b = bars[bi];
      var bc = b.color || colors[bi % colors.length];
      series.push({
        name: b.name,
        type: 'bar',
        data: b.data,
        barWidth: opts.barWidth || '35%',
        itemStyle: {
          borderRadius: opts.borderRadius || [6, 6, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: bc },
            { offset: 1, color: isDark ? 'rgba(15,23,42,0.3)' : 'rgba(255,255,255,0.5)' }
          ])
        }
      });
    }

    for (var li = 0; li < lines.length; li++) {
      var l = lines[li];
      var lc = l.color || colors[(bars.length + li) % colors.length];
      series.push({
        name: l.name,
        type: 'line',
        yAxisIndex: 1,
        data: l.data,
        smooth: opts.smooth !== false,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2.5, color: lc },
        itemStyle: { color: lc },
        areaStyle: opts.area ? {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: lc },
            { offset: 1, color: 'rgba(0,0,0,0)' }
          ])
        } : undefined
      });
    }

    var option = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      legend: {
        data: series.map(function(s) { return s.name; }),
        textStyle: { color: isDark ? '#94a3b8' : '#64748b' },
        bottom: 0
      },
      grid: { left: '3%', right: '4%', bottom: '12%', top: '8%', containLabel: true },
      xAxis: {
        type: 'category', data: categories,
        axisLabel: { color: isDark ? '#94a3b8' : '#64748b' },
        axisLine: { lineStyle: { color: isDark ? '#334155' : '#e2e8f0' } }
      },
      yAxis: [
        {
          type: 'value',
          name: opts.yLeftName || '',
          splitLine: { lineStyle: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' } },
          axisLabel: { color: isDark ? '#94a3b8' : '#64748b' }
        },
        {
          type: 'value',
          name: opts.yRightName || '',
          splitLine: { show: false },
          axisLabel: { color: isDark ? '#94a3b8' : '#64748b' }
        }
      ],
      series: series
    };
    return UI.chart(containerId, finalizeOption(option, opts));
  };

  // Spark — 迷你趋势线（KPI 卡内嵌 sparkline，无坐标轴）
  // 用法：LubanUI.chartPresets.spark('spark1', { data: [3,8,5,9,4,7], color: '#00d4ff', type: 'line'|'bar' })
  F.spark = function(containerId, opts) {
    opts = opts || {};
    var el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!el || typeof echarts === 'undefined') return null;
    var isDark = UI.getTheme() === 'dark';
    if (opts.theme === 'light') isDark = false;
    var color = opts.color || (isDark ? '#00d4ff' : '#1677ff');
    var data = opts.data || [];
    function rgba(hex, a) {
      var h = String(hex).replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    var series = opts.type === 'bar' ? {
      type: 'bar', data: data, barWidth: '55%',
      itemStyle: { borderRadius: [2, 2, 0, 0], color: color, opacity: 0.85 }
    } : {
      type: 'line', data: data, smooth: true, symbol: 'none',
      lineStyle: { width: opts.width || 2, color: color },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: rgba(color, 0.35) },
        { offset: 1, color: rgba(color, 0) }
      ]) }
    };
    var chart = echarts.init(el);
    chart.setOption({
      grid: { left: 2, right: 2, top: 4, bottom: 2 },
      xAxis: { type: 'category', show: false, data: data.map(function(_, i) { return i; }) },
      yAxis: { type: 'value', show: false },
      tooltip: { show: false },
      series: [series]
    });
    return chart;
  };

  // ==========================================
  // Chart Presets — Glow 光晕增强变体（大屏高端效果）
  // barGlow: 霓虹光柱 + 深阴影   lineGlow: 发光曲线 + 面积渐变   pieGlow: 立体饼图 + 阴影
  // ==========================================

  F.barGlow = function(containerId, opts) {
    opts = opts || {};
    var isDark = true;
    if (opts.theme === 'light') isDark = false;
    else if (UI.getTheme() === 'dark') isDark = true;

    var data = opts.data || [];
    var categories = opts.categories || data.map(function(_, i) { return '项' + (i + 1); });
    var colors = opts.colors || tokenColors('barColors', isDark, (isDark
      ? ['#00d4ff', '#7b61ff', '#ff3d9a', '#00e676']
      : ['#1677ff', '#7c3aed', '#ec4899', '#22c55e']));

    var series = (opts.series || [{ name: '数据', data: data }]).map(function(s, si) {
      var c = s.color || colors[si % colors.length];
      return {
        name: s.name,
        type: 'bar',
        data: s.data,
        barGap: opts.barGap || '20%',
        barWidth: opts.barWidth || '40%',
        // 背景柱槽：主柱后面衬一层半透明底柱（大屏柱图质感的关键之一）
        showBackground: opts.background !== false,
        backgroundStyle: {
          color: isDark ? 'rgba(120,160,220,0.08)' : 'rgba(30,80,150,0.06)',
          borderRadius: [opts.radius || 8, opts.radius || 8, 0, 0]
        },
        itemStyle: {
          borderRadius: [opts.radius || 8, opts.radius || 8, 0, 0],
          // 三段渐变：亮顶 → 基色 → 深底
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: lighten(c, 0.35) },
            { offset: 0.35, color: c },
            { offset: 1, color: darken(c, isDark ? 0.55 : 0.25) }
          ]),
          // 柱内横向刻度纹理（可选）
          decal: opts.texture ? {
            symbol: 'rect', symbolSize: [12, 2], rotation: 0,
            color: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.25)',
            dashArrayX: [12, 0]
          } : null,
          shadowBlur: opts.shadowBlur || 14,
          shadowColor: c,
          shadowOffsetY: 2
        },
        emphasis: {
          itemStyle: { shadowBlur: 25, shadowColor: c, shadowOffsetY: 4 }
        },
        label: opts.showLabel ? {
          show: true, position: 'top',
          color: isDark ? '#e2e8f0' : '#1e293b',
          fontSize: 12, fontWeight: 'bold',
          textBorderColor: 'transparent',
          textShadowColor: c, textShadowBlur: 8
        } : undefined
      };
    });

    // 顶部发光帽：一条只显示圆点的折线叠在柱顶（参考图柱顶亮点的实现手法）
    if (opts.topCap !== false && (opts.series || data.length)) {
      var capColor = colors[0];
      series.push({
        name: '__cap__', type: 'line',
        data: (opts.series ? opts.series[0].data : data),
        tooltip: { show: false }, silent: true,
        lineStyle: { opacity: 0 }, z: 5,
        symbol: 'circle', symbolSize: 7,
        itemStyle: { color: lighten(capColor, 0.5), shadowBlur: 12, shadowColor: capColor }
      });
    }

    return UI.chart(containerId, {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: series.filter(function(x){ return x.name !== '__cap__'; }).length > 1 ? {
        data: series.filter(function(x){ return x.name !== '__cap__'; }).map(function(s) { return s.name; }),
        textStyle: { color: isDark ? '#94a3b8' : '#64748b' }, bottom: 0
      } : undefined,
      grid: { left: '3%', right: '4%', bottom: series.length > 2 ? '12%' : '3%', top: '8%', containLabel: true },
      xAxis: {
        type: 'category', data: categories,
        axisLabel: { color: isDark ? '#94a3b8' : '#64748b' },
        axisLine: { lineStyle: { color: isDark ? '#334155' : '#e2e8f0' } },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', type: 'dashed' } },
        axisLabel: { color: isDark ? '#94a3b8' : '#64748b' }
      },
      series: series
    });
  };

  F.lineGlow = function(containerId, opts) {
    opts = opts || {};
    var isDark = true;
    if (opts.theme === 'light') isDark = false;
    else if (UI.getTheme() === 'dark') isDark = true;

    var categories = opts.categories || [];
    var seriesData = opts.series || [{ name: '数据', data: opts.data || [] }];
    var colors = opts.colors || tokenColors('lineColors', isDark, (isDark
      ? ['#00d4ff', '#00e676', '#ff9100', '#ff3d9a']
      : ['#1677ff', '#22c55e', '#f59e0b', '#ef4444']));

    return UI.chart(containerId, {
      tooltip: { trigger: 'axis' },
      legend: opts.legend !== false ? {
        data: seriesData.map(function(s) { return s.name; }),
        textStyle: { color: isDark ? '#94a3b8' : '#64748b' }, bottom: 0
      } : undefined,
      grid: { left: '3%', right: '4%', bottom: opts.legend !== false ? '12%' : '3%', top: '8%', containLabel: true },
      xAxis: {
        type: 'category', data: categories, boundaryGap: false,
        axisLabel: { color: isDark ? '#94a3b8' : '#64748b' },
        axisLine: { lineStyle: { color: isDark ? '#334155' : '#e2e8f0' } }
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' } },
        axisLabel: { color: isDark ? '#94a3b8' : '#64748b' }
      },
      series: seriesData.map(function(s, i) {
        var c = s.color || colors[i % colors.length];
        return {
          name: s.name,
          type: 'line',
          data: s.data,
          smooth: opts.smooth !== false,
          symbol: 'circle', symbolSize: 8,
          lineStyle: { width: 3, color: c, shadowBlur: 10, shadowColor: c },
          itemStyle: { color: c, shadowBlur: 6, shadowColor: c },
          areaStyle: opts.area ? {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: c },
              { offset: 1, color: 'rgba(0,0,0,0)' }
            ])
          } : undefined,
          emphasis: { focus: 'series', itemStyle: { shadowBlur: 15 } }
        };
      })
    });
  };

  F.pieGlow = function(containerId, opts) {
    opts = opts || {};
    var isDark = true;
    if (opts.theme === 'light') isDark = false;
    else if (UI.getTheme() === 'dark') isDark = true;

    var data = opts.data || [];
    var colors = opts.colors || tokenColors('pieColors', isDark, (isDark
      ? ['#00d4ff', '#7b61ff', '#ff3d9a', '#00e676', '#ff9100', '#00e5ff', '#b388ff', '#ff80ab']
      : ['#1677ff', '#7c3aed', '#ec4899', '#22c55e', '#f59e0b', '#06b6d4', '#8b5cf6', '#f472b6']));
    var gapColor = isDark ? '#0a1020' : '#ffffff';
    var centerPos = ['50%', opts.legend !== false ? '45%' : '50%'];

    // 扇区径向渐变：内缘亮 → 外缘深，间隙随主题
    var pieData = data.map(function(d, i) {
      var c = colors[i % colors.length];
      return {
        name: d.name, value: d.value,
        itemStyle: {
          // RadialGradient 签名是 (x, y, r, colorStops)——4 参，色标数组是第 4 参
          color: new echarts.graphic.RadialGradient(0.5, 0.5, 1, [
            { offset: 0, color: lighten(c, 0.3) },
            { offset: 0.7, color: c },
            { offset: 1, color: darken(c, 0.25) }
          ]),
          shadowBlur: 12, shadowColor: 'rgba(0,0,0,0.35)', shadowOffsetY: 2
        }
      };
    });

    var series = [{
      type: 'pie',
      radius: opts.radius || ['48%', '75%'],
      center: centerPos,
      roseType: opts.rose ? 'area' : undefined,
      itemStyle: {
        borderRadius: opts.borderRadius != null ? opts.borderRadius : 6,
        borderColor: gapColor,
        borderWidth: opts.gap != null ? opts.gap : 3,
        shadowBlur: 15, shadowColor: 'rgba(0,0,0,0.3)', shadowOffsetY: 2
      },
      emphasis: {
        scale: true, scaleSize: 8,
        itemStyle: { shadowBlur: 30, shadowColor: 'rgba(0,0,0,0.4)' }
      },
      label: {
        show: opts.showLabel !== false,
        color: isDark ? '#94a3b8' : '#64748b',
        formatter: '{b}\n{d}%'
      },
      data: pieData, color: colors
    }];

    // 外圈装饰环：细线 + 刻度纹理（参考图的多层环效果）
    if (opts.decorRing !== false) {
      series.push({
        type: 'pie', radius: ['79%', '79.8%'], center: centerPos,
        silent: true, label: { show: false }, z: 1,
        data: [{ value: 1, itemStyle: { color: isDark ? 'rgba(0,212,255,0.25)' : 'rgba(22,119,255,0.2)' } }]
      });
      series.push({
        type: 'pie', radius: ['82%', '84%'], center: centerPos,
        silent: true, label: { show: false }, z: 1,
        data: [{ value: 1, itemStyle: { color: isDark ? 'rgba(0,212,255,0.5)' : 'rgba(22,119,255,0.35)' },
          decal: { symbol: 'rect', symbolSize: [4, 8], rotation: Math.PI / 2, dashArrayX: [4, 4] } }]
      });
    }

    // 中心数字 + 单位
    var graphics = [];
    if (opts.centerText) {
      graphics.push({ type: 'text', left: 'center', top: 'calc(' + centerPos[1] + ' - 20px)',
        style: { text: opts.centerText, fill: isDark ? '#ffffff' : '#1e293b', font: 'bold 26px sans-serif',
          textAlign: 'center' } });
      if (opts.centerSub) {
        graphics.push({ type: 'text', left: 'center', top: 'calc(' + centerPos[1] + ' + 12px)',
          style: { text: opts.centerSub, fill: isDark ? '#7ee0ff' : '#64748b', font: '12px sans-serif',
            textAlign: 'center' } });
      }
    }

    return UI.chart(containerId, {
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: opts.legend !== false ? {
        orient: opts.legendOrient || 'horizontal', bottom: 0,
        textStyle: { color: isDark ? '#94a3b8' : '#64748b' }
      } : undefined,
      graphic: graphics.length > 0 ? graphics : undefined,
      series: series
    });
  };

  // ==========================================
  // Chart3D — 通用 3D 图表（echarts-gl）
  // 当 Agent 传入 style: '3d' 时使用
  // ==========================================
  UI.chart3D = function(containerId, config) {
    var container = document.getElementById(containerId);
    if (!container) return null;
    if (typeof echarts === 'undefined') {
      console.warn('LubanUI: ECharts 未加载');
      return null;
    }
    var type = config.type || 'bar3D';
    var isDark = UI.getTheme() === 'dark';
    var instance = echarts.init(container, isDark ? 'dark' : undefined);

    var base3D = {
      grid3D: {
        viewControl: { autoRotate: config.autoRotate !== false, autoRotateSpeed: config.rotateSpeed || 6 },
        boxWidth: config.boxWidth || 100,
        boxDepth: config.boxDepth || 80,
        light: { main: { intensity: 1.2, shadow: true }, ambient: { intensity: 0.5 } },
        environment: isDark ? '#0f172a' : '#f8fafc'
      }
    };

    var option = Object.assign({}, base3D, config);
    instance.setOption(option);
    return instance;
  };

  // ==========================================
  // Topology — 拓扑图（运营商网络拓扑）
  // 基于 ECharts Graph 力导向布局
  // 支持下钻：节点 children 字段定义子拓扑，点击展开
  // 支持 LLM 动作：节点 onClick 字段指定回调函数名
  // ==========================================
  UI.topology = function(containerId, config) {
    var container = document.getElementById(containerId);
    if (!container) return null;
    if (typeof echarts === 'undefined') {
      console.warn('LubanUI: ECharts 未加载');
      return null;
    }

    config = config || {};
    var isDark = UI.getTheme() === 'dark';

    var statusColors = {
      normal: { fill: '#22c55e', stroke: '#16a34a' },
      warning: { fill: '#f59e0b', stroke: '#d97706' },
      alarm: { fill: '#ef4444', stroke: '#dc2626' },
      offline: { fill: '#94a3b8', stroke: '#64748b' }
    };

    var typeIcons = {
      router: 'path://M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
      switch: 'path://M4 18v3h3v-3h10v3h3v-6H4v3zm15-8h3v3h-3v-3zM2 10h3v3H2v-3zm15 3H7V5c0-1.1.9-2 2-2h6c1.1 0 2 .9 2 2v8z',
      server: 'path://M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4l4 4 4-4h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H4V4h16v12zM6 7h2v2H6V7zm0 4h2v2H6v-2zm4-4h8v2h-8V7zm0 4h8v2h-8v-2z',
      baseStation: 'path://M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z',
      default: 'circle'
    };

    var typeSizes = {
      router: 32,
      switch: 28,
      server: 36,
      baseStation: 30,
      default: 24
    };

    // layered 分层泳道布局：节点带 layer（0 基泳道索引），按泳道均分坐标，泳道标题由 layers 提供，
    // 适配"端到端链路/调用链/分层架构"类监控视图（SaaS→MaaS→Daas→PaaS→Iaas 等）
    if (config.layout === 'layered') {
      var __layers = config.layers || [];
      var __layerCount = Math.max(1, __layers.length);
      var __buckets = {};
      (config.nodes || []).forEach(function(n) {
        var L = Math.min(Math.max(n.layer || 0, 0), __layerCount - 1);
        (__buckets[L] = __buckets[L] || []).push(n);
      });
      Object.keys(__buckets).forEach(function(L) {
        var arr = __buckets[L];
        arr.forEach(function(n, i) {
          n.x = Math.round(((i + 1) / (arr.length + 1)) * (config.layoutWidth || 1000));
          n.y = Math.round(((Number(L) + 0.5) / __layerCount) * (config.layoutHeight || 620));
          n.fixed = true;
        });
      });
    }

    function buildNodes(nodesArr) {
      return (nodesArr || []).map(function(n) {
        var status = n.status || 'normal';
        var sc = statusColors[status] || statusColors.normal;
        var type = n.type || 'default';
        var size = n.symbolSize || typeSizes[type] || 24;
        return {
          id: n.id || '',
          name: n.name || n.id || '',
          symbol: n.symbol || typeIcons[type] || 'circle',
          symbolSize: size,
          itemStyle: {
            color: sc.fill,
            borderColor: n.alarming ? statusColors.alarm.fill : sc.stroke,
            borderWidth: n.alarming ? 3 : 1.5,
            shadowBlur: n.alarming ? 12 : 4,
            shadowColor: n.alarming ? statusColors.alarm.fill : sc.fill
          },
          label: { show: n.showLabel !== false, position: 'bottom', color: isDark ? '#e2e8f0' : '#1e293b', fontSize: 12 },
          x: n.x,
          y: n.y,
          fixed: n.fixed,
          category: n.category,
          tooltipData: n.tooltip,
          _raw: n
        };
      });
    }

    function buildLinks(linksArr) {
      return (linksArr || []).map(function(l) {
        var status = l.status || 'normal';
        var sc = statusColors[status] || statusColors.normal;
        return {
          source: l.source,
          target: l.target,
          lineStyle: {
            color: l.color || sc.fill,
            width: l.width || (l.type === 'fiber' ? 2 : 1.5),
            type: l.type === 'wireless' ? 'dashed' : 'solid',
            curveness: l.curveness || 0,
            opacity: 0.8
          },
          label: l.label ? { show: true, formatter: l.label, fontSize: 10 } : undefined
        };
      });
    }

    function buildOption(nodesArr, linksArr, cats) {
      cats = cats || [];
      var option = {
        tooltip: {
          formatter: function(p) {
            if (p.dataType === 'edge') {
              return (p.data.label ? p.data.label.formatter : '') || (p.data.source + ' → ' + p.data.target);
            }
            if (p.data.tooltipData) return p.data.tooltipData;
            return p.name;
          }
        },
        legend: cats.length > 0 ? {
          data: cats.map(function(c) { return c.name; }),
          bottom: 0,
          textStyle: { color: isDark ? '#94a3b8' : '#64748b' }
        } : undefined,
        series: [{
          type: 'graph',
          layout: config.layout === 'layered' ? 'none' : (config.layout || 'force'),
          roam: config.roam !== false,
          draggable: config.draggable !== false,
          force: config.layout === 'layered' ? undefined : {
            repulsion: config.repulsion || 300,
            gravity: config.gravity || 0.1,
            edgeLength: config.edgeLength || [150, 350],
            layoutAnimation: config.layoutAnimation !== false
          },
          data: nodesArr,
          links: linksArr,
          categories: cats,
          roam: true,
          focusNodeAdjacency: true,
          lineStyle: { color: isDark ? '#334155' : '#e2e8f0', curveness: 0.3, opacity: 0.5 },
          label: { show: true, position: 'bottom', color: isDark ? '#e2e8f0' : '#1e293b', fontSize: 12 },
          emphasis: {
            focus: 'adjacency',
            lineStyle: { width: 3 },
            itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' }
          }
        }]
      };

      if (cats.length > 0) {
        var catColors = config.categoryColors || (isDark
          ? ['#4dabf7', '#4ade80', '#fbbf24', '#f87171', '#c084fc']
          : ['#1677ff', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6']);
        cats.forEach(function(cat, i) {
          cat.itemStyle = cat.itemStyle || { color: catColors[i % catColors.length] };
        });
      }

      if (config.layout === 'layered' && __layers.length > 0) {
        option.graphic = __layers.map(function(title, i) {
          return {
            type: 'text',
            left: 10,
            top: (((i + 0.5) / __layers.length) * 100) + '%',
            style: {
              text: title,
              fill: isDark ? '#7ee0ff' : '#1677ff',
              font: 'bold 14px sans-serif'
            }
          };
        });
      }
      return option;
    }

    // —— 下钻栈：存储各级拓扑状态 ——
    var drillStack = [];

    // —— 面包屑导航 ——
    var breadcrumbEl = null;
    function updateBreadcrumb() {
      if (!breadcrumbEl) {
        breadcrumbEl = document.createElement('div');
        breadcrumbEl.className = 'luban-topo-breadcrumb';
        breadcrumbEl.style.cssText = 'position:absolute;top:8px;left:12px;z-index:10;display:flex;align-items:center;gap:4px;font-size:12px;';
        container.style.position = container.style.position || 'relative';
        container.appendChild(breadcrumbEl);
      }
      var parts = drillStack.map(function(s, i) {
        return '<span style="cursor:pointer;color:' + (isDark ? '#4dabf7' : '#1677ff') + '" data-drill-idx="' + i + '">' + s.title + '</span>';
      });
      parts.unshift('<span style="cursor:pointer;color:' + (isDark ? '#4dabf7' : '#1677ff') + '" data-drill-idx="root">全网拓扑</span>');
      breadcrumbEl.innerHTML = parts.join('<span style="color:' + (isDark ? '#64748b' : '#94a3b8') + '"> &gt; </span>');

      breadcrumbEl.querySelectorAll('[data-drill-idx]').forEach(function(el) {
        el.addEventListener('click', function(e) {
          var idx = this.getAttribute('data-drill-idx');
          if (idx === 'root') {
            drillStack = [];
          } else {
            drillStack = drillStack.slice(0, parseInt(idx, 10));
          }
          renderCurrent();
        });
        el.addEventListener('mouseenter', function() { this.style.textDecoration = 'underline'; });
        el.addEventListener('mouseleave', function() { this.style.textDecoration = 'none'; });
      });
    }

    var topoInstance = echarts.init(container, isDark ? 'dark' : undefined);

    var categories = config.categories || [];
    var nodes = buildNodes(config.nodes);
    var links = buildLinks(config.links);

    function renderCurrent() {
      var currentNodes, currentLinks, currentCats;
      if (drillStack.length === 0) {
        currentNodes = nodes;
        currentLinks = links;
        currentCats = categories;
      } else {
        var top = drillStack[drillStack.length - 1];
        currentNodes = top.nodes;
        currentLinks = top.links;
        currentCats = top.categories || [];
      }
      topoInstance.setOption(buildOption(currentNodes, currentLinks, currentCats), true);
      updateBreadcrumb();
    }

    // 节点点击：优先 onClick，其次 children 下钻
    topoInstance.off('click');
    topoInstance.on('click', function(params) {
      if (params.dataType !== 'node') return;
      var raw = params.data._raw;
      if (!raw) return;

      // LLM 动作优先
      if (raw.onClick) {
        var fn = typeof raw.onClick === 'function' ? raw.onClick : window[raw.onClick];
        if (typeof fn === 'function') {
          fn(raw, topoInstance, container);
          return;
        }
      }

      // 下钻：有 children 则展开
      if (raw.children && raw.children.nodes && raw.children.nodes.length > 0) {
        drillStack.push({
          title: raw.name || raw.id,
          nodes: buildNodes(raw.children.nodes),
          links: buildLinks(raw.children.links || []),
          categories: raw.children.categories || []
        });
        renderCurrent();
      }
    });

    renderCurrent();
    return topoInstance;
  };

  // ==========================================
  // Map — 地图组件（运营商站点分布、光缆路由）
  // 基于 ECharts Map + Scatter + Lines
  // 支持省份下钻：drillDown: true 点击省份加载子级地图
  // 支持 LLM 动作：散点/涟漪散点 onClick 字段指定回调函数名
  // v2 多图层：layers[] 数组配置任意多图层，支持动态 addLayer/removeLayer
  // ==========================================
  UI.map = function(containerId, config) {
    var container = document.getElementById(containerId);
    if (!container) return null;
    if (typeof echarts === 'undefined') {
      console.warn('LubanUI: ECharts 未加载');
      return null;
    }

    config = config || {};
    var isDark = UI.getTheme() === 'dark';
    var mapType = config.mapType || 'china';
    var drillStack = [];
    var breadcrumbEl = null;
    var visualMaps = []; // 存储 visualMap 配置，避免重复

    // —— 图层管理 ——
    // 兼容旧版扁平配置：scatter/effectScatter/heatmap/lines → 转为 layers
    var layers = config.layers ? config.layers.slice() : [];
    if (!config.layers && config.scatter) {
      layers.push({ id: '__scatter__', type: 'scatter', data: config.scatter });
    }
    if (!config.layers && config.effectScatter) {
      layers.push({ id: '__effectScatter__', type: 'effectScatter', data: config.effectScatter });
    }
    if (!config.layers && config.heatmap) {
      layers.push({ id: '__heatmap__', type: 'heatmap', data: config.heatmap,
        heatMin: config.heatMin, heatMax: config.heatMax, heatBlurSize: config.heatBlurSize,
        heatPointSize: config.heatPointSize, heatMinOpacity: config.heatMinOpacity });
    }
    if (!config.layers && config.lines) {
      layers.push({ id: '__lines__', type: 'lines', data: config.lines, lineColor: config.lineColor });
    }

    function buildSeriesFromLayer(layer) {
      var t = layer.type;
      if (t === 'scatter') {
        return {
          id: layer.id,
          type: 'scatter',
          coordinateSystem: 'geo',
          data: (layer.data || []).map(function(p) {
            return {
              name: p.name,
              value: p.value || [p.lng, p.lat, p.size || 1],
              tooltip: p.tooltip,
              itemStyle: { color: p.color || (layer.color || '#ef4444') },
              symbolSize: p.symbolSize || (layer.symbolSize || 12),
              _onClick: p.onClick,
              _raw: p
            };
          }),
          symbolSize: layer.symbolSizeFn || function(val) { return val[2] * (layer.sizeMultiplier || 6) + (layer.sizeBase || 6); },
          itemStyle: Object.assign({
            shadowBlur: 6,
            shadowColor: isDark ? 'rgba(239,68,68,0.5)' : 'rgba(239,68,68,0.3)',
            shadowOffsetY: 2
          }, layer.itemStyle || {}),
          label: {
            show: layer.showLabel !== false,
            formatter: '{b}',
            position: layer.labelPosition || 'right',
            color: layer.labelColor || (isDark ? '#e2e8f0' : '#1e293b'),
            fontSize: layer.labelFontSize || 11
          },
          emphasis: Object.assign({ scale: 1.4 }, layer.emphasis || {}),
          zlevel: layer.zlevel || 1
        };
      }
      if (t === 'effectScatter') {
        return {
          id: layer.id,
          type: 'effectScatter',
          coordinateSystem: 'geo',
          data: (layer.data || []).map(function(p) {
            return {
              name: p.name,
              value: [p.lng, p.lat],
              tooltip: p.tooltip,
              itemStyle: { color: p.color || (layer.color || '#4dabf7') },
              _onClick: p.onClick,
              _raw: p
            };
          }),
          symbolSize: layer.symbolSize || 16,
          showEffectOn: layer.showEffectOn || 'render',
          rippleEffect: {
            brushType: layer.rippleBrushType || 'stroke',
            scale: layer.rippleScale || 4,
            period: layer.ripplePeriod || 6
          },
          itemStyle: Object.assign({ shadowBlur: 8, shadowColor: 'rgba(77,171,247,0.5)' }, layer.itemStyle || {}),
          label: { show: layer.showLabel || false },
          zlevel: layer.zlevel || 2
        };
      }
      if (t === 'heatmap') {
        visualMaps.push({
          min: layer.heatMin || 0,
          max: layer.heatMax || 100,
          calculable: true,
          inRange: { color: layer.heatColors || (isDark ? ['#1e3a5f', '#4dabf7', '#74c0fc', '#e2e8f0'] : ['#e6f4ff', '#4096ff', '#1677ff', '#002766']) },
          textStyle: { color: isDark ? '#94a3b8' : '#64748b' }
        });
        return {
          id: layer.id,
          type: 'heatmap',
          coordinateSystem: 'geo',
          data: layer.data || [],
          blurSize: layer.heatBlurSize || 10,
          pointSize: layer.heatPointSize || 5,
          minOpacity: layer.heatMinOpacity || 0.3,
          zlevel: layer.zlevel || 0
        };
      }
      if (t === 'lines') {
        return {
          id: layer.id,
          type: 'lines',
          coordinateSystem: 'geo',
          polyline: layer.polyline || false,
          data: (layer.data || []).map(function(l) {
            return {
              coords: l.coords || [[l.fromLng, l.fromLat], [l.toLng, l.toLat]],
              lineStyle: {
                color: l.color || layer.lineColor || '#4dabf7',
                width: l.width || layer.lineWidth || 2,
                type: l.lineType || layer.lineType || 'solid',
                curveness: l.curveness != null ? l.curveness : (layer.curveness != null ? layer.curveness : 0.2),
                opacity: l.opacity != null ? l.opacity : (layer.opacity != null ? layer.opacity : 0.7)
              },
              effect: (l.effect || layer.showEffect) ? {
                show: true,
                period: l.effectPeriod || layer.effectPeriod || 6,
                trailLength: l.trailLength || layer.trailLength || 0.3,
                symbol: l.effectSymbol || layer.effectSymbol || 'arrow',
                symbolSize: l.effectSymbolSize || layer.effectSymbolSize || 8
              } : undefined,
              tooltip: l.tooltip
            };
          }),
          zlevel: layer.zlevel || 1
        };
      }
      // 呼吸灯散点 — 自动周期缩放的散点（告警大屏用）
      if (t === 'breathingScatter') {
        var breatheData = (layer.data || []).map(function(p) {
          return {
            name: p.name,
            value: [p.lng, p.lat],
            tooltip: p.tooltip,
            itemStyle: { color: p.color || layer.color || '#ef4444' },
            _onClick: p.onClick,
            _raw: p
          };
        });
        return {
          id: layer.id,
          type: 'effectScatter',
          coordinateSystem: 'geo',
          data: breatheData,
          symbolSize: layer.symbolSize || 20,
          showEffectOn: 'emphasis',
          rippleEffect: {
            brushType: 'stroke',
            scale: layer.breathScale || 6,
            period: layer.breathPeriod || 3
          },
          itemStyle: Object.assign({
            shadowBlur: 12,
            shadowColor: layer.glowColor || 'rgba(239,68,68,0.6)'
          }, layer.itemStyle || {}),
          label: { show: layer.showLabel || false },
          zlevel: layer.zlevel || 3
        };
      }
      // 自定义 ECharts series（LLM 直接传 series 配置）
      if (t === 'custom') {
        var custom = Object.assign({}, layer.series || {});
        custom.id = layer.id;
        custom.coordinateSystem = custom.coordinateSystem || 'geo';
        custom.zlevel = custom.zlevel || layer.zlevel || 1;
        custom.data = (custom.data || []).map(function(d) {
          if (layer.injectClick && d._raw) {
            d._onClick = d._raw.onClick;
          }
          return d;
        });
        return custom;
      }
      return null;
    }

    function updateBreadcrumb() {
      if (!config.drillDown) return;
      if (!breadcrumbEl) {
        breadcrumbEl = document.createElement('div');
        breadcrumbEl.className = 'luban-map-breadcrumb';
        breadcrumbEl.style.cssText = 'position:absolute;top:8px;left:12px;z-index:10;display:flex;align-items:center;gap:4px;font-size:12px;';
        container.style.position = container.style.position || 'relative';
        container.appendChild(breadcrumbEl);
      }
      var parts = drillStack.map(function(s, i) {
        return '<span style="cursor:pointer;color:' + (isDark ? '#4dabf7' : '#1677ff') + '" data-drill-idx="' + i + '">' + s.name + '</span>';
      });
      parts.unshift('<span style="cursor:pointer;color:' + (isDark ? '#4dabf7' : '#1677ff') + '" data-drill-idx="root">全国</span>');
      breadcrumbEl.innerHTML = parts.join('<span style="color:' + (isDark ? '#64748b' : '#94a3b8') + '"> &gt; </span>');

      breadcrumbEl.querySelectorAll('[data-drill-idx]').forEach(function(el) {
        el.addEventListener('click', function(e) {
          e.stopPropagation();
          var idx = this.getAttribute('data-drill-idx');
          if (idx === 'root') {
            drillStack = [];
            mapType = config.mapType || 'china';
          } else {
            var toIdx = parseInt(idx, 10);
            drillStack = drillStack.slice(0, toIdx);
            mapType = drillStack.length > 0 ? drillStack[drillStack.length - 1].code : (config.mapType || 'china');
          }
          renderMap();
        });
        el.addEventListener('mouseenter', function() { this.style.textDecoration = 'underline'; });
        el.addEventListener('mouseleave', function() { this.style.textDecoration = 'none'; });
      });
    }

    function buildOption() {
      var innerMapType = drillStack.length > 0 ? drillStack[drillStack.length - 1].code : mapType;
      visualMaps = [];
      var series = [];
      layers.forEach(function(layer) {
        var s = buildSeriesFromLayer(layer);
        if (s) series.push(s);
      });

      var option = {
        tooltip: {
          trigger: 'item',
          formatter: function(p) {
            if (p.seriesType === 'scatter' || p.seriesType === 'effectScatter') {
              return (p.data.tooltip || p.name) + (p.value !== undefined ? ': ' + p.value : '');
            }
            if (p.seriesType === 'lines') return p.data.tooltip || '';
            return p.name;
          }
        },
        geo: {
          map: innerMapType,
          roam: config.roam !== false,
          zoom: config.zoom || 1,
          center: config.center,
          label: { show: config.showLabel || false, color: isDark ? '#94a3b8' : '#64748b', fontSize: 10 },
          itemStyle: {
            areaColor: config.areaColor || (isDark ? '#1e293b' : '#f1f5f9'),
            borderColor: config.borderColor || (isDark ? '#334155' : '#cbd5e1'),
            borderWidth: 1
          },
          emphasis: {
            label: { show: true, color: isDark ? '#e2e8f0' : '#1e293b' },
            itemStyle: { areaColor: config.emphasisColor || (isDark ? '#334155' : '#e2e8f0') }
          }
        },
        series: series
      };

      if (visualMaps.length > 0) {
        option.visualMap = visualMaps;
      }
      return option;
    }

    var mapInstance = echarts.init(container, isDark ? 'dark' : undefined);

    function renderMap() {
      mapInstance.setOption(buildOption(), true);
      updateBreadcrumb();
    }

    renderMap();

    // 点击事件：散点 onClick 动作 > 省份下钻
    mapInstance.off('click');
    mapInstance.on('click', function(params) {
      if ((params.seriesType === 'scatter' || params.seriesType === 'effectScatter') && params.data) {
        var onClickVal = params.data._onClick;
        if (onClickVal) {
          var fn = typeof onClickVal === 'function' ? onClickVal : window[onClickVal];
          if (typeof fn === 'function') {
            fn(params.data._raw || params.data, mapInstance, container);
            return;
          }
        }
        return;
      }

      if (!config.drillDown || (params.componentSubType && params.componentSubType !== 'geo')) return;
      var regionName = params.name;
      if (!regionName) return;

      var code = UI._provinceCodeMap && UI._provinceCodeMap[regionName];
      if (!code) {
        console.warn('LubanUI: 未找到省份编码: ' + regionName + '，请先调用 LubanUI.loadProvinceDrill()');
        return;
      }

      if (config.onProvinceClick) {
        var cb = typeof config.onProvinceClick === 'function' ? config.onProvinceClick : window[config.onProvinceClick];
        if (typeof cb === 'function') {
          if (cb({ name: regionName, code: code }, mapInstance, container) === false) return;
        }
      }

      drillStack.push({ name: regionName, code: code });
      UI.loadProvinceMap(code, function() {
        renderMap();
      });
    });

    // —— 图层动态管理 API（挂载到 ECharts instance 上返回） ——
    var layerAPI = {
      addLayer: function(layer) {
        if (!layer.id) layer.id = 'layer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        layers.push(layer);
        renderMap();
        return layer.id;
      },
      removeLayer: function(layerId) {
        var idx = -1;
        for (var i = 0; i < layers.length; i++) {
          if (layers[i].id === layerId) { idx = i; break; }
        }
        if (idx >= 0) {
          layers.splice(idx, 1);
          renderMap();
          return true;
        }
        return false;
      },
      updateLayer: function(layerId, updates) {
        for (var i = 0; i < layers.length; i++) {
          if (layers[i].id === layerId) {
            Object.assign(layers[i], updates);
            renderMap();
            return true;
          }
        }
        return false;
      },
      getLayers: function() {
        return layers.map(function(l) { return { id: l.id, type: l.type, dataCount: (l.data || []).length }; });
      },
      clearLayers: function() {
        layers = [];
        renderMap();
      }
    };

    // 将 API 挂到 instance 上返回
    mapInstance._lubanLayers = layerAPI;
    return mapInstance;
  };

  // 加载中国地图 GeoJSON（优先使用 bridge 已注册的内置地图，避免 CDN 依赖）
  UI.loadChinaMap = function(callback) {
    if (typeof echarts === 'undefined') {
      console.warn('LubanUI: ECharts 未加载');
      return;
    }
    try {
      // 平台已通过 /luban/china.json 内置注册过时直接复用，无需再拉 CDN
      if (echarts.getMap && echarts.getMap('china')) {
        if (callback) callback();
        return;
      }
      var jsonUrl = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json';
      fetch(jsonUrl).then(function(res) { return res.json(); }).then(function(geoJson) {
        echarts.registerMap('china', geoJson);
        // 顺便构建省份名称→编码映射（GeoJSON properties.name → adcode 前6位）
        if (!UI._provinceCodeMap) {
          UI._provinceCodeMap = {};
          var features = geoJson.features || [];
          features.forEach(function(f) {
            var name = f.properties && f.properties.name;
            var adcode = f.properties && f.properties.adcode;
            if (name && adcode) {
              UI._provinceCodeMap[name] = String(adcode);
            }
          });
        }
        if (callback) callback();
      }).catch(function() {
        console.warn('LubanUI: 中国地图 GeoJSON 加载失败，请检查网络');
        if (callback) callback();
      });
    } catch(e) {
      console.warn('LubanUI: fetch 不可用');
      if (callback) callback();
    }
  };

  // 预加载省份下钻映射表（省份中文名 → GeoJSON 编码）
  // 调用 loadChinaMap 时自动构建，也可手动调用
  UI.loadProvinceDrill = function(callback) {
    UI.loadChinaMap(function() {
      if (callback) callback(UI._provinceCodeMap);
    });
  };

  // 加载指定省份 GeoJSON 并注册为 ECharts 地图
  // code: 6位行政区划编码，如 '320000'=江苏
  UI.loadProvinceMap = function(code, callback) {
    if (typeof echarts === 'undefined') {
      console.warn('LubanUI: ECharts 未加载');
      return;
    }
    code = String(code);
    try {
      var jsonUrl = 'https://geo.datav.aliyun.com/areas_v3/bound/' + code + '_full.json';
      fetch(jsonUrl).then(function(res) { return res.json(); }).then(function(geoJson) {
        echarts.registerMap(code, geoJson);
        if (callback) callback(geoJson);
      }).catch(function() {
        console.warn('LubanUI: 省份 GeoJSON 加载失败: ' + code);
        if (callback) callback();
      });
    } catch(e) {
      console.warn('LubanUI: fetch 不可用');
      if (callback) callback();
    }
  };

// ==========================================
  // ScreenScaler — 1920×1080 设计稿等比缩放（指挥中心大屏底座）
  // 用法：LubanUI.screenScaler({ width: 1920, height: 1080, target: '.screen-wrap' })
  // 目标元素按固定设计尺寸布局，整体随窗口等比缩放居中，任意分辨率下布局不散架
  // ==========================================
  UI.screenScaler = function(opts) {
    opts = opts || {};
    var w = opts.width || 1920, h = opts.height || 1080;
    var el = opts.target ? document.querySelector(opts.target) : (document.body.firstElementChild || null);
    if (!el) return null;
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.minHeight = h + 'px';
    el.style.transformOrigin = 'left top';
    el.style.position = 'absolute';
    el.style.left = '50%';
    el.style.top = '50%';
    function resize() {
      var scale = Math.min(window.innerWidth / w, window.innerHeight / h);
      el.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
    }
    resize();
    window.addEventListener('resize', resize);
    if (window.__LUBAN__ && window.__LUBAN__.onPageUnload) {
      window.__LUBAN__.onPageUnload(function() { window.removeEventListener('resize', resize); });
    }
    return { el: el, resize: resize };
  };

  // ==========================================
  // WorldClock — 多时区时钟条（指挥中心标题栏）
  // 用法：LubanUI.worldClock('clockBar', { zones: [{ label: '北京', offset: 8 }, { label: '莫斯科', offset: 3 }] })
  // offset 为相对 UTC 的小时数；组件内部自动注册定时器清理
  // ==========================================
  UI.worldClock = function(containerId, opts) {
    var el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!el) return null;
    opts = opts || {};
    var zones = opts.zones || [{ label: '北京时间', offset: 8 }];
    el.innerHTML = zones.map(function(z, i) {
      return '<span style="display:inline-flex;align-items:center;gap:8px;' + (i > 0 ? 'margin-left:18px;' : '') + '">' +
        '<b style="font-weight:600;">' + z.label + '</b>' +
        '<span data-tz-idx="' + i + '" style="font-family:Consolas,monospace;"></span></span>';
    }).join('');
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function tick() {
      var now = Date.now();
      zones.forEach(function(z, i) {
        var d = new Date(now + (z.offset || 0) * 3600 * 1000);
        var cell = el.querySelector('[data-tz-idx="' + i + '"]');
        if (cell) cell.textContent = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' 周' + '日一二三四五六'[d.getUTCDay()];
      });
    }
    tick();
    var timer = setInterval(tick, 1000);
    if (window.__LUBAN__ && window.__LUBAN__.onPageUnload) {
      window.__LUBAN__.onPageUnload(function() { clearInterval(timer); });
    }
    return { update: tick };
  };

// ==========================================
  // Map3D — geo3D 立体挤出地图（指挥中心类大屏主视图）
  // 用法：LubanUI.loadChinaMap(function() {
  //   LubanUI.map3d('map3d', { mapType: 'china', regionHeight: 3, markers: [{ name:'杭州', lng:120.15, lat:30.28 }] })
  // })
  // 依赖 echarts-gl（已内置）与已注册的地图 geoJSON
  // ==========================================
  UI.map3d = function(containerId, config) {
    var el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!el || typeof echarts === 'undefined' || !echarts.registerMap) return null;
    config = config || {};
    var isDark = UI.getTheme() === 'dark';
    if (config.theme === 'light') isDark = false;
    var glow = config.glowColor || (isDark ? 'rgba(0,212,255,0.9)' : 'rgba(22,119,255,0.8)');
    var area = config.areaColor || (isDark ? '#0d1b33' : '#dbe8f7');

    function init() {
      var chart = echarts.init(el);
      var series = [];
      (config.markers || []).forEach(function(m) {
        series.push({
          type: 'scatter3D',
          coordinateSystem: 'geo3D',
          symbolSize: m.size || 10,
          itemStyle: { color: m.color || '#ffd54f', shadowBlur: 12, shadowColor: m.color || '#ffd54f' },
          label: { show: m.name ? true : false, formatter: m.name, position: 'top', textStyle: { color: isDark ? '#e2e8f0' : '#1e293b', fontSize: 12, fontWeight: 'bold' } },
          data: [[m.lng, m.lat, (config.regionHeight || 3) + 1]]
        });
      });
      chart.setOption({
        geo3D: {
          map: config.mapType || 'china',
          regionHeight: config.regionHeight || 3,
          shading: 'realistic',
          realisticMaterial: { roughness: 0.55, metalness: 0.25 },
          postEffect: { enable: true, bloom: { enable: true, intensity: config.bloom != null ? config.bloom : 0.3 } },
          light: {
            main: { intensity: 1.2, shadow: true, alpha: config.lightAlpha || 40, beta: -30 },
            ambient: { intensity: 0.45 }
          },
          itemStyle: { color: area, borderColor: glow, borderWidth: 1.2 },
          emphasis: {
            itemStyle: { color: isDark ? '#1a3a5c' : '#b3d4f5' },
            label: { show: true, textStyle: { color: isDark ? '#ffffff' : '#1e293b', fontSize: 13 } }
          },
          label: { show: !!config.showLabels, textStyle: { color: isDark ? '#cfe8ff' : '#334155', fontSize: 11 } },
          viewControl: {
            alpha: config.alpha || 42, beta: 0,
            distance: config.distance || 95,
            autoRotate: !!config.autoRotate, autoRotateSpeed: 2,
            minDistance: 40, maxDistance: 200
          }
        },
        series: series
      });
      return chart;
    }

    // geo3D 的 map 需要先 registerMap；未注册时自动加载后再初始化
    if (echarts.getMap && echarts.getMap(config.mapType || 'china')) {
      return init();
    }
    UI.loadChinaMap(function() { init(); });
    return null;
  };

  // ==========================================
  // CityBlocks — 程序化城市/园区体块（3D 白模，bar3D 实现，echarts-gl）
  // 用法：LubanUI.cityBlocks('city3d', { rows: 10, cols: 14, centerTower: true })
  // 注意：程序化体块为风格化近似；照片级实景园区需要自备 3D 模型/实拍底图资产
  // ==========================================
  UI.cityBlocks = function(containerId, config) {
    var el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!el || typeof echarts === 'undefined' || !echarts.init) return null;
    config = config || {};
    var isDark = UI.getTheme() === 'dark';
    if (config.theme === 'light') isDark = false;
    var rows = config.rows || 10, cols = config.cols || 14;

    // 稳定伪随机（同一页面每次渲染体块布局一致）
    var seed = config.seed || 42;
    function rnd() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    }

    var data = [];
    var base = isDark ? '#155a8a' : '#7fb3e8';
    var hi = config.highlight || '#00d4ff';
    var midR = Math.floor(rows / 2), midC = Math.floor(cols / 2);
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (rnd() < 0.18) continue; // 留出街道空隙
        var dist = Math.abs(r - midR) + Math.abs(c - midC);
        var isCenter = config.centerTower && r === midR && c === midC;
        var h = isCenter ? (config.centerHeight || 55) : Math.max(3, Math.round((1 - dist / (rows + cols)) * 30 * (0.5 + rnd())));
        data.push({
          value: [c, r, h],
          itemStyle: { color: isCenter ? hi : (rnd() < 0.3 ? rgbaMix(base, hi, 0.3 + rnd() * 0.4) : base) }
        });
      }
    }
    function rgbaMix(hexA, hexB, t) {
      function pa(h) { h = h.replace('#', ''); if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; return parseInt(h, 16); }
      var a = pa(hexA), b = pa(hexB);
      var r = Math.round((((a>>16)&255)*(1-t)) + ((b>>16)&255)*t);
      var g = Math.round((((a>>8)&255)*(1-t)) + ((b>>8)&255)*t);
      var bl = Math.round(((a&255)*(1-t)) + (b&255)*t);
      return 'rgb(' + r + ',' + g + ',' + bl + ')';
    }

    var chart = echarts.init(el);
    chart.setOption({
      backgroundColor: 'transparent',
      grid3D: {
        show: false, boxWidth: config.boxWidth || 200, boxDepth: config.boxDepth || 130,
        viewControl: {
          alpha: config.alpha || 32, beta: config.beta || 18,
          distance: config.distance || 240, autoRotate: !!config.autoRotate, autoRotateSpeed: 2
        },
        light: {
          main: { intensity: 1.1, shadow: true, alpha: 40, beta: -30 },
          ambient: { intensity: 0.5 }
        },
        postEffect: { enable: true, bloom: { enable: true, intensity: config.bloom != null ? config.bloom : 0.25 } }
      },
      xAxis3D: { type: 'value', show: false, max: cols },
      yAxis3D: { type: 'value', show: false, max: rows },
      zAxis3D: { type: 'value', show: false, max: 60 },
      series: [{
        type: 'bar3D',
        data: data,
        barSize: config.barSize || 4,
        bevelSize: 0.3,
        shading: 'realistic',
        realisticMaterial: { roughness: 0.4, metalness: 0.35 },
        itemStyle: isDark ? { borderColor: 'rgba(0,212,255,0.35)', borderWidth: 1 } : {}
      }]
    });
    return chart;
  };

// ==========================================
  // Ring — 环形占比图（环心总计 + 右侧分项数值列表）
  // 用法1（分项环，参照社区平台人口数据环）：
  //   LubanUI.ring('ring1', { data: [{ name:'租赁房屋', value:3627 }, ...], centerLabel: '人口总数', unit: '人' })
  // 用法2（单值进度环，参照楼栋占比 25%/30% 小环组）：
  //   LubanUI.ring('ring2', { progress: 73.2, size: 90, centerUnit: '%' })
  // 说明：强调"占比构成+玫瑰/立体"用 pieGlow；"总计+分项列表/单值进度"用本组件
  // ==========================================
  UI.ring = function(containerId, opts) {
    var container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!container || typeof echarts === 'undefined') return null;
    opts = opts || {};
    var isDark = true;
    if (opts.theme === 'light') isDark = false;
    else if (UI.getTheme() === 'dark') isDark = true;
    if (opts.theme === 'light') isDark = false;

    var colors = opts.colors || tokenColors('pieColors', isDark, (isDark
      ? ['#00d4ff', '#00e676', '#ff9100', '#ff3d9a', '#7b61ff', '#00e5ff']
      : ['#1677ff', '#22c55e', '#f59e0b', '#ef4444', '#7c3aed', '#06b6d4']));
    var fg = isDark ? '#e2e8f0' : '#1e293b';
    var sub = isDark ? '#8aa3c8' : '#64748b';
    var gap = isDark ? '#0a1020' : '#ffffff';

    var size = opts.size || 150;
    var isProgress = opts.progress != null;
    var data = isProgress
      ? [{ name: opts.name || '占比', value: opts.progress }]
      : (opts.data || []);

    // —— 布局：左环 + 右列表（showList=false 时仅环）——
    var showList = !isProgress && opts.showList !== false && data.length > 0;
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = showList ? 'flex-start' : 'center';
    container.style.gap = '14px';
    container.style.height = container.style.height || '100%';
    var chartSize = isProgress ? size : Math.max(size, opts.ringSize || size);
    container.innerHTML =
      '<div data-ring-chart style="width:' + chartSize + 'px;height:' + chartSize + 'px;flex:none;"></div>' +
      (showList ? '<div data-ring-list style="flex:1;min-width:0;overflow:hidden;"></div>' : '');

    var chartEl = container.querySelector('[data-ring-chart]');
    var chart = echarts.init(chartEl);

    var series = [];
    if (isProgress) {
      var pct = Math.max(0, Math.min(100, Number(opts.progress)));
      var pc = colors[0];
      series.push({
        type: 'pie', radius: ['72%', '88%'], center: ['50%', '50%'],
        startAngle: 90, silent: true, label: { show: false },
        data: [
          { value: pct, itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                { offset: 0, color: lighten(pc, 0.3) }, { offset: 1, color: pc }]),
              borderRadius: 30, shadowBlur: 10, shadowColor: pc } },
          { value: 100 - pct, itemStyle: { color: isDark ? 'rgba(120,160,220,0.12)' : 'rgba(30,80,150,0.08)' } }
        ]
      });
    } else {
      series.push({
        type: 'pie',
        radius: opts.radius || ['58%', '80%'],
        center: ['50%', '50%'],
        itemStyle: {
          borderRadius: opts.borderRadius != null ? opts.borderRadius : 5,
          borderColor: gap, borderWidth: 2,
          shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)'
        },
        label: { show: false },
        emphasis: { scale: true, scaleSize: 6 },
        data: data.map(function(d, i) {
          return { name: d.name, value: d.value, itemStyle: { color: d.color || colors[i % colors.length] } };
        })
      });
      if (opts.decorRing !== false) {
        series.push({
          type: 'pie', radius: ['88%', '88.7%'], center: ['50%', '50%'],
          silent: true, label: { show: false },
          data: [{ value: 1, itemStyle: { color: isDark ? 'rgba(0,212,255,0.3)' : 'rgba(22,119,255,0.25)' } }]
        });
      }
    }

    // —— 环心文字 ——
    var centerValue = isProgress
      ? (opts.centerText || opts.progress + (opts.centerUnit || '%'))
      : (opts.centerText || String(data.reduce(function(a, d) { return a + (Number(d.value) || 0); }, 0)));
    var centerLabel = opts.centerLabel || '';
    var cValColor = opts.centerColor || (isDark ? '#ffffff' : '#1e293b');
    chart.setOption({
      tooltip: isProgress ? { show: false } : { trigger: 'item', formatter: '{b}: {c}' + (opts.unit ? ' ' + opts.unit : '') },
      graphic: [
        { type: 'text', left: 'center', top: centerLabel ? '42%' : '50%',
          style: { text: centerValue, fill: cValColor,
            font: 'bold ' + (isProgress ? Math.round(size / 5.5) : Math.round(chartSize / 7.5)) + 'px sans-serif',
            align: 'center', verticalAlign: 'middle' } },
        (centerLabel ? { type: 'text', left: 'center', top: '58%',
          style: { text: centerLabel, fill: sub, font: '12px sans-serif', align: 'center' } } : null)
      ].filter(Boolean),
      series: series
    });

    // —— 右侧分项列表（色点 + 名称 + 数值），hover 联动高亮 ——
    if (showList) {
      var total = data.reduce(function(a, d) { return a + (Number(d.value) || 0); }, 0) || 1;
      var listEl = container.querySelector('[data-ring-list]');
      listEl.innerHTML = data.map(function(d, i) {
        var c = d.color || colors[i % colors.length];
        return '<div data-ring-row="' + i + '" style="display:flex;align-items:center;gap:8px;padding:5px 4px;cursor:default;' +
          'border-bottom:1px dashed ' + (isDark ? 'rgba(120,160,220,0.15)' : 'rgba(30,80,150,0.1)') + ';">' +
          '<span style="width:8px;height:8px;border-radius:50%;flex:none;background:' + c + ';box-shadow:0 0 6px ' + c + ';"></span>' +
          '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:' + sub + ';font-size:13px;">' + d.name + '</span>' +
          '<span style="color:' + fg + ';font-size:14px;font-weight:600;">' + (Number(d.value) || 0).toLocaleString() + (opts.unit || '') + '</span>' +
          '</div>';
      }).join('');
      Array.prototype.forEach.call(listEl.querySelectorAll('[data-ring-row]'), function(row) {
        var idx = Number(row.getAttribute('data-ring-row'));
        row.addEventListener('mouseenter', function() {
          chart.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: idx });
        });
        row.addEventListener('mouseleave', function() {
          chart.dispatchAction({ type: 'downplay', seriesIndex: 0, dataIndex: idx });
        });
      });
    }

    return chart;
  };

// ==========================================
  // GIS — 真实地理底图（Leaflet 内置 + 高德瓦片，国内可达、无需 key）
  // 用法：LubanUI.gis('gisMap', {
  //   center: [113.26, 23.13], zoom: 11, style: 'dark'|'satellite'|'street',
  //   markers: [{ lng: 113.3, lat: 23.1, name: '站点A', color: '#00d4ff', pulse: true, onClick: 'onSiteClick' }],
  //   lines: [{ from: [113.3, 23.1], to: [114.3, 22.5], color: '#ffd54f', width: 2 }]
  // })
  // 优先级：涉及真实地理（城区/园区/街道级）用 gis；大区域省份态势用 LubanUI.map（逻辑地图）
  // ==========================================
  UI.gis = function(containerId, config) {
    var el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!el) return null;
    if (typeof L === 'undefined') { console.warn('LubanUI: Leaflet 未加载，GIS 地图不可用'); return null; }
    config = config || {};
    var isDark = true;
    if (config.theme === 'light') isDark = false;
    else if (UI.getTheme() === 'light') isDark = false;

    el.classList.add('luban-gis');
    if (config.style !== 'satellite' && config.style !== 'street') el.classList.add('luban-gis-dark');

    var map = L.map(el, { zoomControl: !!config.zoomControl, attributionControl: false })
      .setView(config.center || [104.07, 30.67], config.zoom || 10);

    var gaodeVec = 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';
    var gaodeSat = 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}';
    var gaodeRoad = 'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}';
    if (config.style === 'satellite') {
      L.tileLayer(gaodeSat, { subdomains: '1234', maxZoom: 18 }).addTo(map);
      L.tileLayer(gaodeRoad, { subdomains: '1234', maxZoom: 18, opacity: 0.55 }).addTo(map);
    } else {
      L.tileLayer(gaodeVec, { subdomains: '1234', maxZoom: 18 }).addTo(map);
    }

    var api = {
      map: map,
      markers: [],
      lines: [],
      addMarker: function(m) { return _addMarker(m); },
      addLine: function(l) { return _addLine(l); },
      flyTo: function(lngLat, z) { map.flyTo(lngLat, z || map.getZoom() + 1, { duration: 0.8 }); },
      remove: function() { map.remove(); }
    };

    function _addMarker(m) {
      var color = m.color || '#00d4ff';
      var icon = L.divIcon({
        className: '',
        html: '<div class="luban-gis-marker" style="color:' + color + ';">' +
              (m.pulse !== false ? '<span class="gis-pulse"></span>' : '') +
              '<span class="gis-dot"></span></div>',
        iconSize: [14, 14], iconAnchor: [7, 7]
      });
      var marker = L.marker([m.lat, m.lng], { icon: icon }).addTo(map);
      if (m.name) {
        marker.bindTooltip(m.name, { permanent: !!config.showLabels || !!m.showLabel, direction: 'top', offset: [0, -10], className: 'luban-gis-label' });
      }
      if (m.onClick) {
        var fn = typeof m.onClick === 'function' ? m.onClick : (window[m.onClick] || null);
        if (fn) marker.on('click', function() { fn(m); });
      }
      api.markers.push(marker);
      return marker;
    }

    function _addLine(l) {
      var from = l.from, to = l.to;
      // 二次贝塞尔飞线：控制点取中点法向偏移，弧线更接近真实航迹观感
      var mx = (from[0] + to[0]) / 2, my = (from[1] + to[1]) / 2;
      var dx = to[0] - from[0], dy = to[1] - from[1];
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      var bow = (l.bow != null ? l.bow : 0.22) * dist;
      var cx = mx - (dy / dist) * bow, cy = my + (dx / dist) * bow;
      var pts = [];
      for (var t = 0; t <= 1.001; t += 0.025) {
        var u = 1 - t;
        pts.push([
          u * u * from[0] + 2 * u * t * cx + t * t * to[0],
          u * u * from[1] + 2 * u * t * cy + t * t * to[1]
        ]);
      }
      var line = L.polyline(pts, {
        color: l.color || '#ffd54f',
        weight: l.width || 2,
        opacity: l.opacity != null ? l.opacity : 0.85,
        className: l.effect === false ? '' : 'luban-gis-flyline'
      }).addTo(map);
      if (l.name) line.bindTooltip(l.name, { className: 'luban-gis-label', sticky: true });
      api.lines.push(line);
      return line;
    }

    (config.markers || []).forEach(_addMarker);
    (config.lines || []).forEach(_addLine);

    if (window.__LUBAN__ && window.__LUBAN__.onPageUnload) {
      window.__LUBAN__.onPageUnload(function() { map.remove(); });
    }
    return api;
  };

// ==========================================
  // CountUp — 数字滚动动画（大屏必备）
  // 用法：LubanUI.countUp('elementId', 9999, 2000)
  // ==========================================
  UI.countUp = function(elementId, endValue, opts) {
    var el = typeof elementId === 'string' ? document.getElementById(elementId) : elementId;
    if (!el) return;
    opts = opts || {};
    var duration = opts.duration || 1500;
    var startValue = opts.startValue || 0;
    var decimals = opts.decimals != null ? opts.decimals : 0;
    var prefix = opts.prefix || '';
    var suffix = opts.suffix || '';
    var separator = opts.separator !== false;
    var delay = opts.delay || 0;
    var easingFn = opts.easing || function(t) { return 1 - Math.pow(1 - t, 3); }; // easeOutCubic

    if (delay > 0) {
      setTimeout(function() { _animate(); }, delay);
    } else {
      _animate();
    }

    function _animate() {
      var startTime = null;
      function step(timestamp) {
        if (!startTime) startTime = timestamp;
        var elapsed = timestamp - startTime;
        var progress = Math.min(elapsed / duration, 1);
        var easedProgress = easingFn(progress);
        var current = startValue + (endValue - startValue) * easedProgress;
        var display = current.toFixed(decimals);
        if (separator) {
          display = _addSeparator(display);
        }
        el.textContent = prefix + display + suffix;
        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          var finalDisplay = endValue.toFixed(decimals);
          if (separator) finalDisplay = _addSeparator(finalDisplay);
          el.textContent = prefix + finalDisplay + suffix;
          if (opts.onComplete) opts.onComplete();
        }
      }
      requestAnimationFrame(step);
    }

    function _addSeparator(numStr) {
      var parts = numStr.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return parts.join('.');
    }
  };

  // ==========================================
  // VisualStyle — 一键视觉风格预设
  // 用法：var style = LubanUI.visualStyle.neon;
  //       LubanUI.map('mapId', Object.assign({ layers: [...] }, LubanUI.visualStyle.neon.map));
  // ==========================================
  UI.visualStyle = {
    // 霓虹风格 — 赛博朋克大屏
    neon: {
      map: {
        areaColor: '#0a0f1e', borderColor: '#1a2540',
        emphasisColor: '#1a3050'
      },
      chart: {
        barColors: ['#00d4ff', '#7b61ff', '#ff3d9a', '#00e676'],
        lineColors: ['#00d4ff', '#ff3d9a', '#7b61ff', '#00e676'],
        pieColors: ['#00d4ff', '#7b61ff', '#ff3d9a', '#00e676', '#ff9100', '#00e5ff'],
        dark: true
      },
      topo: {
        normal: { fill: '#00d4ff', stroke: '#00a0cc' },
        warning: { fill: '#ff9100', stroke: '#cc7400' },
        alarm: { fill: '#ff1744', stroke: '#d50000' },
        offline: { fill: '#37474f', stroke: '#263238' },
        linkNormal: '#1a3050', linkWarning: '#ff9100', linkAlarm: '#ff1744'
      },
      containerClass: 'luban-glow-card'
    },
    // 鎏金风格 — 金色+深蓝（社区/园区综合管理类大屏）
    golden: {
      map: {
        areaColor: '#0d1420', borderColor: 'rgba(212,175,55,0.35)',
        emphasisColor: '#243040'
      },
      chart: {
        barColors: ['#d4af37', '#4dabf7', '#00e676', '#ff7043'],
        lineColors: ['#d4af37', '#4dabf7', '#00e676'],
        pieColors: ['#d4af37', '#4dabf7', '#00e676', '#ff7043', '#ab47bc', '#ffd54f'],
        dark: true
      },
      topo: {
        normal: { fill: '#d4af37', stroke: '#b8960c' },
        warning: { fill: '#ff9100', stroke: '#cc7400' },
        alarm: { fill: '#ff1744', stroke: '#d50000' },
        offline: { fill: '#37474f', stroke: '#263238' },
        linkNormal: '#3a3320', linkWarning: '#ff9100', linkAlarm: '#ff1744'
      },
      containerClass: 'luban-glow-card'
    },
    // 全息投影风格 — 科技感
    holographic: {
      map: {
        areaColor: '#0d1525', borderColor: 'rgba(77,171,247,0.3)',
        emphasisColor: '#1a3a5c'
      },
      chart: {
        barColors: ['#4dabf7', '#7bc8ff', '#3bd6c6', '#a78bfa'],
        lineColors: ['#4dabf7', '#7bc8ff', '#3bd6c6', '#a78bfa'],
        pieColors: ['#4dabf7', '#7bc8ff', '#3bd6c6', '#a78bfa', '#f59e0b', '#f87171'],
        dark: true
      },
      topo: {
        normal: { fill: '#4dabf7', stroke: '#339af0' },
        warning: { fill: '#f59e0b', stroke: '#d97706' },
        alarm: { fill: '#f87171', stroke: '#ef4444' },
        offline: { fill: '#475569', stroke: '#334155' },
        linkNormal: 'rgba(77,171,247,0.3)', linkWarning: '#f59e0b', linkAlarm: '#f87171'
      },
      containerClass: 'luban-glass-card'
    },
    // 极简商务 — 浅色专业风
    minimal: {
      map: {
        areaColor: '#f8fafc', borderColor: '#e2e8f0',
        emphasisColor: '#dbeafe'
      },
      chart: {
        barColors: ['#1e3a5f', '#2563eb', '#3b82f6', '#60a5fa'],
        lineColors: ['#1e3a5f', '#2563eb', '#3b82f6', '#60a5fa'],
        pieColors: ['#1e3a5f', '#2563eb', '#3b82f6', '#60a5fa', '#f59e0b', '#ef4444'],
        dark: false
      },
      topo: {
        normal: { fill: '#22c55e', stroke: '#16a34a' },
        warning: { fill: '#f59e0b', stroke: '#d97706' },
        alarm: { fill: '#ef4444', stroke: '#dc2626' },
        offline: { fill: '#94a3b8', stroke: '#64748b' },
        linkNormal: '#cbd5e1', linkWarning: '#f59e0b', linkAlarm: '#ef4444'
      },
      containerClass: ''
    }
  };

})();