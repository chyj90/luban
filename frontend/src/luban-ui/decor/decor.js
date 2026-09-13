// LubanUI.decor — 大屏装饰 API（全屏边框 / 图标 / 标题栏 / 面板 / 图标导航）
// 依赖 LubanUI 主文件先注入；配合 decor.css 使用
(function() {
  'use strict';
  var UI = window.LubanUI;
  if (!UI) return;
  UI.decor = UI.decor || {};

  // ==========================================
  // icon — 内联 SVG 图标（Tabler Icons MIT 子集，见 icons.js 的 LUBAN_ICONS）
  // 用法: LubanUI.icon('alarm')  → 返回 SVG 字符串
  //       LubanUI.icon('alarm', { size: 20, strokeWidth: 1.8 })
  // ==========================================
  UI.icon = function(name, opts) {
    opts = opts || {};
    var inner = (window.LUBAN_ICONS || {})[name];
    if (!inner) return '';
    var size = opts.size || 18;
    var sw = opts.strokeWidth || 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + size +
      '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="' + sw +
      '" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  };

  // 可用图标名列表（供 get_component_spec 展示）
  UI.iconList = function() {
    return Object.keys(window.LUBAN_ICONS || {});
  };

  // ==========================================
  // decor.frame — 全屏科技边框（四角装饰 + 边线扫光）
  // 用法: LubanUI.decor.frame()        → 挂到 body
  //       LubanUI.decor.frame('.screen-wrap')
  // 页面卸载时随 DOM 一起销毁，无需手动清理
  // ==========================================
  var CORNER_SVG =
    '<svg class="scr-corner tl" viewBox="0 0 132 132" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M132 7 H38 L7 38 V132" stroke="var(--scr-frame-line)" stroke-width="2"/>' +
    '<path d="M132 16 H43 L16 43 V132" stroke="currentColor" stroke-width="3" opacity="0.95"/>' +
    '<path d="M132 27 H48 L27 48 V132" stroke="var(--scr-frame-line-soft)" stroke-width="1"/>' +
    '<path d="M52 7 v10 M7 52 h10" stroke="var(--scr-frame-line)" stroke-width="2"/>' +
    '<path d="M62 7 v5 M7 62 h5" stroke="var(--scr-frame-line-soft)" stroke-width="1.5"/>' +
    '<rect x="20" y="20" width="7" height="7" fill="currentColor" opacity="0.9"/>' +
    '<rect x="33" y="33" width="4" height="4" fill="var(--scr-frame-line-soft)"/>' +
    '</svg>';

  UI.decor.frame = function(target) {
    var host = target ? document.querySelector(target) : document.body;
    if (!host) return null;
    var old = host.querySelector(':scope > .luban-scr-frame');
    if (old) old.remove();

    var corners = ['tl', 'tr', 'bl', 'br'].map(function(pos) {
      return CORNER_SVG.replace('scr-corner tl', 'scr-corner ' + pos);
    }).join('');
    var wrap = document.createElement('div');
    wrap.className = 'luban-scr-frame';
    wrap.innerHTML =
      corners +
      '<div class="scr-edge top"></div>' +
      '<div class="scr-edge bottom"></div>' +
      '<div class="scr-edge-v left"></div>' +
      '<div class="scr-edge-v right"></div>';
    host.appendChild(wrap);
    return wrap;
  };

  // ==========================================
  // decor.header — 大屏标题栏（梯形标题座 + 两侧翼线 + 扫光）
  // 用法: LubanUI.decor.header('headerId', { title: '全网运营指挥调度中心', clock: 'worldClock' })
  // clock 传容器 id 时在标题栏右侧生成时钟槽位，随后 LubanUI.worldClock('worldClock', {...}) 填充
  // ==========================================
  UI.decor.header = function(containerId, opts) {
    var el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!el) return null;
    opts = opts || {};
    el.className = 'luban-screen-header ' + (el.className || '');
    el.innerHTML =
      '<div class="luban-screen-header-wing left"></div>' +
      '<div class="luban-screen-header-title">' + (opts.title || '') + '</div>' +
      '<div class="luban-screen-header-wing right"></div>' +
      (opts.clock ? '<div class="luban-screen-header-clock luban-num" id="' + opts.clock + '"></div>' : '');
    return el;
  };

  // ==========================================
  // decor.panel — 科技面板（斜切标题栏 + 图标 + 发光下划线）
  // 用法: LubanUI.decor.panel('panel1', { title: '告警类型构成', icon: 'radar' })
  //       面板内容写入 #panel1 的 .luban-panel-body
  // ==========================================
  UI.decor.panel = function(containerId, opts) {
    var el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!el) return null;
    opts = opts || {};
    el.className = 'luban-panel-tech ' + (el.className || '');
    el.innerHTML =
      '<div class="luban-panel-head">' +
      (opts.icon ? '<span class="luban-panel-head-icon">' + UI.icon(opts.icon, { size: 17 }) + '</span>' : '') +
      '<span>' + (opts.title || '') + '</span>' +
      '</div>' +
      '<div class="luban-panel-body"></div>';
    return el.querySelector('.luban-panel-body');
  };

  // ==========================================
  // decor.iconNav — 底部图标导航条
  // 用法: LubanUI.decor.iconNav('navId', [
  //         { icon: 'dashboard', label: '总览', onClick: 'onNavClick' },
  //         { icon: 'alert', label: '告警' }
  //       ])
  // onClick 可传全局函数名字符串或函数
  // ==========================================
  UI.decor.iconNav = function(containerId, items) {
    var el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!el) return null;
    el.className = 'luban-icon-nav ' + (el.className || '');
    el.innerHTML = (items || []).map(function(it, i) {
      return '<div class="luban-icon-nav-item' + (it.active ? ' active' : '') + '" data-nav-index="' + i + '">' +
        '<div class="luban-icon-nav-ring">' + UI.icon(it.icon || 'dashboard', { size: 26, strokeWidth: 1.6 }) + '</div>' +
        '<div class="luban-icon-nav-label">' + (it.label || '') + '</div>' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('.luban-icon-nav-item'), function(node) {
      var idx = parseInt(node.getAttribute('data-nav-index'), 10);
      var item = items[idx];
      node.addEventListener('click', function() {
        if (!item || !item.onClick) return;
        var fn = typeof item.onClick === 'function' ? item.onClick : window[item.onClick];
        if (typeof fn === 'function') fn(item);
      });
    });
    return el;
  };

  // ==========================================
  // screenPalette — 指挥中心级图表配色（与 decor.css 色板一致，随 setTheme 深浅自动切换）
  // 用法: setTheme 后取色 var P = LubanUI.screenPalette;
  //       柱状渐变 P.barGradient()，面积图 P.areaGradient()
  // ==========================================
  var DARK_PALETTE = {
    cyan: '#3CE4FC',
    cyanMid: '#18A8C0',
    blue: '#1890D8',
    blueLine: '#30A8D8',
    royal: '#6C90E4',
    orange: '#F08818',
    textDim: '#A8CDEB',
    textFaint: '#5E82A8',
    ghost: '#2A3C52',
    series: ['#3CE4FC', '#6C90E4', '#F08818', '#18A8C0', '#30A8D8', '#9E86E0'],
    axisLine: 'rgba(94, 130, 168, 0.4)',
    splitLine: 'rgba(94, 130, 168, 0.18)',
    barEnd: 'rgba(24,144,216,0.06)',
    areaTop: 0.32,
    success: '#4ADE80',
    danger: '#FF6B5E',
    warning: '#FBBF24'
  };
  var LIGHT_PALETTE = {
    cyan: '#1890D8',
    cyanMid: '#18A8C0',
    blue: '#1677FF',
    blueLine: '#4096FF',
    royal: '#5A7BE0',
    orange: '#E07C08',
    textDim: '#47566B',
    textFaint: '#8494A8',
    ghost: '#E2E8F0',
    series: ['#1890D8', '#5A7BE0', '#E07C08', '#18A8C0', '#4096FF', '#7C6FD9'],
    axisLine: 'rgba(100, 116, 139, 0.45)',
    splitLine: 'rgba(100, 116, 139, 0.18)',
    barEnd: 'rgba(24,144,216,0.18)',
    areaTop: 0.22,
    success: '#16A34A',
    danger: '#DC2626',
    warning: '#D97706'
  };
  var P = Object.assign({}, DARK_PALETTE);
  UI.screenPalette = P;

  function applyScreenPalette(theme) {
    Object.assign(P, theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE);
  }
  // setTheme 时同步切换图表配色（保持对象引用不变，页面已捕获的 var P 依然生效）
  var _origSetTheme = UI.setTheme;
  UI.setTheme = function(theme) {
    var r = _origSetTheme(theme);
    // 用户自定义调色板优先：跟随新主题模式重新派生，否则回到内置深浅色板
    if (UI._customPalette) {
      UI.setPalette({ primary: UI._customPalette.primary, mode: theme });
    } else {
      applyScreenPalette(theme);
    }
    return r;
  };
  applyScreenPalette(UI.getTheme());

  // ==========================================
  // setPalette — 按主色程序化派生整套大屏配色（质感纪律由派生函数保证，模型只传意图）
  // 用法: LubanUI.setPalette({ primary: '#22C55E' })                    // 按当前主题模式派生
  //       LubanUI.setPalette({ primary: '#E23A2E', mode: 'light' })    // 指定深浅
  //       LubanUI.setPalette('golden')                                 // 命名预设
  //       LubanUI.resetPalette()                                       // 恢复内置色板
  // 派生规则：背景=主色色相同系深浅分层；发光色=主色提亮；图表序列=主色+邻近色+点睛橙；
  //           边框/渐变=主色半透明。setTheme 时自定义调色板自动跟随新模式重新派生
  // ==========================================
  var PRESET_PALETTES = {
    neon: { primary: '#22D3EE', mode: 'dark' },
    golden: { primary: '#D4AF37', mode: 'dark' },
    holographic: { primary: '#4DABF7', mode: 'dark' },
    minimal: { primary: '#1677FF', mode: 'light' }
  };

  function hexToRgb(hex) {
    var n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  }
  function hexFromHsl(h, s, l) {
    h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    var rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
              h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    var to = function(v) { return ('0' + Math.round((v + m) * 255).toString(16)).slice(-2); };
    return ('#' + to(rgb[0]) + to(rgb[1]) + to(rgb[2])).toUpperCase();
  }
  function rgbaFromHex(hex, a) {
    var c = hexToRgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  function deriveScreenPalette(primaryHex, mode) {
    var rgb = hexToRgb(primaryHex);
    var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    var h = hsl[0];
    var s = Math.max(hsl[1], 48);
    var base = hexFromHsl(h, s, mode === 'light' ? 48 : 55);
    var glow = mode === 'light' ? hexFromHsl(h, s, 34) : hexFromHsl(h, Math.min(s + 15, 100), 62);
    var v = {};
    if (mode === 'light') {
      v['--scr-bg-deep'] = hexFromHsl(h, 40, 96);
      v['--scr-bg-base'] = '#ffffff';
      v['--scr-bg-map'] = hexFromHsl(h, 45, 93);
      v['--scr-bg-raised'] = hexFromHsl(h, 50, 89);
      v['--scr-band'] = hexFromHsl(h, 55, 86);
      v['--scr-band-hi'] = hexFromHsl(h, 50, 80);
      v['--scr-cyan'] = glow;
      v['--scr-cyan-mid'] = hexFromHsl(h, s, 45);
      v['--scr-blue'] = hexFromHsl(h, s, 48);
      v['--scr-blue-line'] = hexFromHsl(h, s, 58);
      v['--scr-royal'] = hexFromHsl(h + 40, s * 0.8, 52);
      v['--scr-orange'] = '#E07C08';
      v['--scr-text'] = hexFromHsl(h, 30, 17);
      v['--scr-text-dim'] = hexFromHsl(h, 18, 35);
      v['--scr-text-faint'] = hexFromHsl(h, 12, 58);
      v['--scr-border'] = rgbaFromHex(base, 0.28);
      v['--scr-border-faint'] = rgbaFromHex(base, 0.12);
      v['--scr-glow'] = 'none';
      v['--scr-panel-grad'] = 'linear-gradient(165deg, ' + rgbaFromHex(base, 0.05) + ' 0%, rgba(255,255,255,0.6) 34%, #ffffff 100%)';
      v['--scr-kpi-grad'] = 'linear-gradient(180deg, ' + rgbaFromHex(base, 0.07) + ' 0%, #ffffff 100%)';
      v['--scr-panel-head-grad'] = 'linear-gradient(90deg, ' + rgbaFromHex(base, 0.13) + ' 0%, ' + rgbaFromHex(base, 0.04) + ' 62%, transparent 100%)';
      v['--scr-header-grad'] = 'linear-gradient(180deg, rgba(0,0,0,0) 62%, ' + rgbaFromHex(base, 0.1) + ' 100%)';
      v['--scr-navring-grad'] = 'radial-gradient(circle at 50% 32%, ' + rgbaFromHex(base, 0.14) + ' 0%, ' + rgbaFromHex(base, 0.05) + ' 58%, transparent 72%), linear-gradient(180deg, #ffffff, ' + hexFromHsl(h, 45, 94) + ')';
      v['--scr-pill-active-grad'] = 'linear-gradient(180deg, ' + rgbaFromHex(base, 0.2) + ', ' + rgbaFromHex(base, 0.08) + ')';
      v['--scr-frame-line'] = rgbaFromHex(base, 0.5);
      v['--scr-frame-line-soft'] = rgbaFromHex(base, 0.28);
      v['--scr-title-glow'] = '0 1px 2px rgba(15, 40, 80, 0.15)';
      v['--scr-num-glow'] = 'none';
      return {
        vars: v,
        chart: {
          cyan: glow, cyanMid: hexFromHsl(h, s, 45), blue: hexFromHsl(h, s, 48),
          blueLine: hexFromHsl(h, s, 58), royal: hexFromHsl(h + 40, s * 0.8, 52),
          orange: '#E07C08', textDim: hexFromHsl(h, 18, 35), textFaint: hexFromHsl(h, 12, 58),
          ghost: hexFromHsl(h, 25, 90),
          series: [hexFromHsl(h, s, 45), hexFromHsl(h + 40, s * 0.8, 52), '#E07C08', hexFromHsl(h, s, 55), hexFromHsl(h + 70, s * 0.7, 50), hexFromHsl(h - 40, s * 0.7, 55)],
          axisLine: 'rgba(100, 116, 139, 0.45)', splitLine: 'rgba(100, 116, 139, 0.18)',
          barEnd: rgbaFromHex(base, 0.18), areaTop: 0.22
        }
      };
    }
    v['--scr-bg-deep'] = hexFromHsl(h, 68, 7);
    v['--scr-bg-base'] = hexFromHsl(h, 72, 11);
    v['--scr-bg-map'] = hexFromHsl(h, 65, 15);
    v['--scr-bg-raised'] = hexFromHsl(h, 58, 18);
    v['--scr-band'] = hexFromHsl(h, 70, 26);
    v['--scr-band-hi'] = hexFromHsl(h, 50, 33);
    v['--scr-cyan'] = glow;
    v['--scr-cyan-mid'] = hexFromHsl(h, s, 48);
    v['--scr-blue'] = hexFromHsl(h, s, 45);
    v['--scr-blue-line'] = hexFromHsl(h, s, 58);
    v['--scr-royal'] = hexFromHsl(h + 40, s * 0.75, 66);
    v['--scr-orange'] = '#F08818';
    v['--scr-text'] = hexFromHsl(h, 65, 96);
    v['--scr-text-dim'] = hexFromHsl(h, 38, 78);
    v['--scr-text-faint'] = hexFromHsl(h, 28, 52);
    v['--scr-border'] = rgbaFromHex(base, 0.32);
    v['--scr-border-faint'] = rgbaFromHex(base, 0.14);
    v['--scr-glow'] = '0 0 10px ' + rgbaFromHex(glow, 0.45);
    v['--scr-panel-grad'] = 'linear-gradient(165deg, ' + rgbaFromHex(hexFromHsl(h, 70, 30), 0.22) + ' 0%, ' + rgbaFromHex(hexFromHsl(h, 72, 14), 0.55) + ' 34%, ' + rgbaFromHex(hexFromHsl(h, 72, 12), 0.88) + ' 100%)';
    v['--scr-kpi-grad'] = 'linear-gradient(180deg, ' + rgbaFromHex(hexFromHsl(h, 70, 30), 0.28) + ' 0%, ' + rgbaFromHex(hexFromHsl(h, 72, 12), 0.85) + ' 100%)';
    v['--scr-panel-head-grad'] = 'linear-gradient(90deg, ' + rgbaFromHex(hexFromHsl(h, 70, 26), 0.85) + ' 0%, ' + rgbaFromHex(hexFromHsl(h, 70, 26), 0.3) + ' 62%, transparent 100%)';
    v['--scr-header-grad'] = 'linear-gradient(180deg, rgba(0,0,0,0) 62%, ' + rgbaFromHex(hexFromHsl(h, 55, 32), 0.55) + ' 100%)';
    v['--scr-navring-grad'] = 'radial-gradient(circle at 50% 32%, ' + rgbaFromHex(glow, 0.22) + ' 0%, ' + rgbaFromHex(hexFromHsl(h, 70, 26), 0.12) + ' 58%, transparent 72%), linear-gradient(180deg, ' + rgbaFromHex(hexFromHsl(h, s, 40), 0.24) + ', ' + rgbaFromHex(hexFromHsl(h, 72, 12), 0.6) + ')';
    v['--scr-pill-active-grad'] = 'linear-gradient(180deg, ' + rgbaFromHex(hexFromHsl(h, s, 45), 0.5) + ', ' + rgbaFromHex(hexFromHsl(h, 70, 26), 0.4) + ')';
    v['--scr-frame-line'] = rgbaFromHex(hexFromHsl(h, s, 58), 0.75);
    v['--scr-frame-line-soft'] = rgbaFromHex(hexFromHsl(h, s, 58), 0.35);
    v['--scr-title-glow'] = '0 0 18px ' + rgbaFromHex(glow, 0.75) + ', 0 2px 4px rgba(0, 0, 0, 0.6)';
    v['--scr-num-glow'] = '0 0 14px ' + rgbaFromHex(glow, 0.55);
    return {
      vars: v,
      chart: {
        cyan: glow, cyanMid: hexFromHsl(h, s, 48), blue: hexFromHsl(h, s, 45),
        blueLine: hexFromHsl(h, s, 58), royal: hexFromHsl(h + 40, s * 0.75, 66),
        orange: '#F08818', textDim: hexFromHsl(h, 38, 78), textFaint: hexFromHsl(h, 28, 52),
        ghost: hexFromHsl(h, 20, 25),
        series: [glow, hexFromHsl(h + 40, s * 0.75, 66), '#F08818', hexFromHsl(h, s, 48), hexFromHsl(h, s, 58), hexFromHsl(h - 40, s * 0.7, 62)],
        axisLine: 'rgba(94, 130, 168, 0.4)', splitLine: 'rgba(94, 130, 168, 0.18)',
        barEnd: rgbaFromHex(hexFromHsl(h, s, 45), 0.06), areaTop: 0.32
      }
    };
  }

  UI.setPalette = function(opts) {
    if (typeof opts === 'string') {
      var preset = PRESET_PALETTES[opts];
      if (!preset) {
        console.warn('LubanUI: 未知调色板预设 "' + opts + '"，可选：' + Object.keys(PRESET_PALETTES).join('、') + '，或传 { primary, mode }');
        return null;
      }
      opts = preset;
    }
    opts = opts || {};
    var primary = opts.primary || (UI._customPalette && UI._customPalette.primary) || '#3CE4FC';
    if (!/^#[0-9a-fA-F]{6}$/.test(primary)) {
      console.warn('LubanUI: setPalette primary 必须是 #RRGGBB 格式，收到: ' + primary);
      return null;
    }
    var mode = opts.mode || UI.getTheme();
    if (mode !== UI.getTheme()) {
      _origSetTheme(mode); // 预设/显式 mode 与当前主题不同时同步主题（不经 wrapper，避免递归）
    }
    var derived = deriveScreenPalette(primary, mode);
    for (var k in derived.vars) {
      document.documentElement.style.setProperty(k, derived.vars[k]);
    }
    var SEMANTIC = mode === 'light'
      ? { success: '#16A34A', danger: '#DC2626', warning: '#D97706' }
      : { success: '#4ADE80', danger: '#FF6B5E', warning: '#FBBF24' };
    Object.assign(derived.chart, SEMANTIC);
    Object.assign(P, derived.chart);
    // 同步命名风格取色（setVisualStyle 后再 setPalette 时图表跟随新主色）
    if (UI._activeStyle && UI.visualStyle && UI.visualStyle[UI._activeStyle] && UI.visualStyle[UI._activeStyle].chart) {
      var stChart = UI.visualStyle[UI._activeStyle].chart;
      stChart.barColors = derived.chart.series.slice();
      stChart.lineColors = derived.chart.series.slice();
      stChart.pieColors = derived.chart.series.concat(derived.chart.series).slice(0, 8);
    }
    UI._customPalette = { primary: primary, mode: mode };
    return { primary: primary, mode: mode };
  };

  UI.resetPalette = function() {
    if (UI._customPalette) {
      var derived = deriveScreenPalette(UI._customPalette.primary, UI._customPalette.mode);
      for (var k in derived.vars) {
        document.documentElement.style.removeProperty(k);
      }
    }
    UI._customPalette = null;
    applyScreenPalette(UI.getTheme());
  };

  // 命名视觉风格（neon/golden/holographic/minimal）联动 CSS 调色板
  var _origSetVisualStyle = UI.setVisualStyle;
  UI.setVisualStyle = function(name) {
    var r = _origSetVisualStyle(name);
    if (PRESET_PALETTES[name]) UI.setPalette(PRESET_PALETTES[name]);
    return r;
  };

  // ==========================================
  // setDensity — 大屏信息密度（组件尺寸档位，禁止手写覆盖尺寸）
  // 用法: LubanUI.setDensity('compact')   // 紧凑：一屏 6-8 面板的高密度指挥屏
  //       LubanUI.setDensity('normal')   // 默认档（4 面板标准布局）
  //       LubanUI.setDensity('large')    // 宽松：大字展示屏
  //       LubanUI.setDensity({ panelHeadH: 28, kpiValue: 26 })  // 精细指定（px）
  //       LubanUI.resetDensity()        // 恢复默认
  // 可调项: gap/headerH/headerTitleSize/panelHeadH/panelHeadFont/
  //         kpiPadY/kpiPadX/kpiLabelSize/kpiValueSize/kpiSparkH/
  //         navRing/navIcon/navLabel/navGap/clockSize
  // ==========================================
  var DENSITY_PRESETS = {
    compact: { gap: 8, headerH: 52, headerTitleSize: 24, panelHeadH: 28, panelHeadFont: 13,
               kpiPadY: 8, kpiPadX: 12, kpiLabelSize: 12, kpiValueSize: 26, kpiSparkH: 28,
               navRing: 44, navIcon: 20, navLabel: 12, navGap: 48, clockSize: 12 },
    normal: { gap: 12, headerH: 64, headerTitleSize: 30, panelHeadH: 34, panelHeadFont: 15,
              kpiPadY: 12, kpiPadX: 16, kpiLabelSize: 13, kpiValueSize: 32, kpiSparkH: 34,
              navRing: 54, navIcon: 26, navLabel: 13, navGap: 72, clockSize: 13 },
    large: { gap: 16, headerH: 76, headerTitleSize: 36, panelHeadH: 40, panelHeadFont: 17,
             kpiPadY: 16, kpiPadX: 20, kpiLabelSize: 14, kpiValueSize: 40, kpiSparkH: 42,
             navRing: 62, navIcon: 30, navLabel: 14, navGap: 96, clockSize: 14 }
  };
  var DENSITY_VAR_MAP = {
    gap: '--scr-gap', headerH: '--scr-header-h', headerTitleSize: '--scr-header-title-size',
    panelHeadH: '--scr-panel-head-h', panelHeadFont: '--scr-panel-head-font',
    kpiPadY: '--scr-kpi-pad-y', kpiPadX: '--scr-kpi-pad-x',
    kpiLabelSize: '--scr-kpi-label-size', kpiValueSize: '--scr-kpi-value-size', kpiSparkH: '--scr-kpi-spark-h',
    navRing: '--scr-nav-ring', navIcon: '--scr-nav-icon', navLabel: '--scr-nav-label',
    navGap: '--scr-nav-gap', clockSize: '--scr-clock-size'
  };

  function applyDensity(d) {
    for (var key in DENSITY_VAR_MAP) {
      if (d[key] != null) {
        document.documentElement.style.setProperty(DENSITY_VAR_MAP[key], d[key] + 'px');
      }
    }
  }

  UI.setDensity = function(opts) {
    if (typeof opts === 'string') {
      var preset = DENSITY_PRESETS[opts];
      if (!preset) {
        console.warn('LubanUI: 未知密度档位 "' + opts + '"，可选：compact / normal / large，或传 { panelHeadH: 28, ... }');
        return null;
      }
      opts = preset;
    }
    opts = opts || {};
    var d = Object.assign({}, DENSITY_PRESETS.normal, opts);
    for (var key in d) {
      var v = Number(d[key]);
      if (!isFinite(v) || v < 8 || v > 200) {
        console.warn('LubanUI: setDensity.' + key + ' 必须是 8-200 的数值(px)，收到: ' + d[key]);
        return null;
      }
      d[key] = v;
    }
    applyDensity(d);
    UI._customDensity = d;
    return d;
  };

  UI.resetDensity = function() {
    for (var key in DENSITY_VAR_MAP) {
      document.documentElement.style.removeProperty(DENSITY_VAR_MAP[key]);
    }
    UI._customDensity = null;
  };

  // 竖向渐变柱（echarts LinearGradient）：顶部主色 → 底部渐隐
  UI.screenPalette.barGradient = function(color, colorEnd) {
    if (typeof echarts === 'undefined') return color || P.cyan;
    return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: color || P.cyan },
      { offset: 1, color: colorEnd || P.barEnd }
    ]);
  };

  // 面积图渐变：line 下方填充主色 → 透明
  UI.screenPalette.areaGradient = function(color, opacityTop) {
    if (typeof echarts === 'undefined') return 'rgba(24,144,216,0.2)';
    var c = color || P.cyan;
    var top = opacityTop == null ? P.areaTop : opacityTop;
    function rgba(hex, a) {
      var n = parseInt(hex.slice(1), 16);
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: rgba(c, top) },
      { offset: 1, color: rgba(c, 0.02) }
    ]);
  };
})();
