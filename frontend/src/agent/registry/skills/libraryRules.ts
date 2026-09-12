/**
 * 第三方库使用规范
 *
 * 用于校验时按需注入，避免 Prompt 膨胀。
 * 每个库一个 key，值为该库的完整使用规范文本。
 */

export const LIBRARY_RULES: Record<string, string> = {
  'chart.js': [
    'Chart.js 使用规范：',
    '1. 初始化用 addEventListener(\'load\', fn, { once: true }) 或 addEventListener(\'DOMContentLoaded\', fn, { once: true })，必须带 { once: true }，否则 SPA 切换页面时重复初始化',
    '2. 每次渲染图表前必须先销毁旧实例并设为 null：',
    '   if (myChart) { myChart.destroy(); myChart = null; }',
    '3. 销毁后立即 set null，不能只 destroy 不设 null',
    '4. 然后再 new Chart(ctx, { ... })，否则会报 "Canvas is already in use" 错误',
  ].join('\n'),
  'leaflet': [
    '❌ Leaflet 已被禁用，禁止在任何页面中使用！',
    '原因：Leaflet 依赖国外 CDN，国内网络无法访问，会导致页面加载失败。',
    '替代方案：',
    '1. 地图可视化 → 使用 ECharts 的 map 系列（已内置，无需加载 CDN）',
    '   示例：LubanUI.chart(\'mapChart\', { series: [{ type: \'map\', map: \'china\', ... }] })',
    '2. 禁止在任何 HTML/JS/CSS 中引用 leaflet、L.map、tileLayer 等 Leaflet API',
  ].join('\n'),
  'geojson': [
    '❌ 禁止通过 libraries 引入地图 GeoJSON 数据（.json 文件、geo.datav.aliyun.com 等）！',
    '原因：libraries 会把 URL 当 <script> 注入，.json 无法作为脚本执行，必然加载失败；',
    '且中国地图已由平台内置注册（/luban/china.json），无需任何外部数据源。',
    '替代方案：直接使用 map: \'china\' 或 LubanUI.loadChinaMap() / LubanUI.map 组件；',
    '省级地图用 LubanUI.loadProvinceMap(adcode)。',
  ].join('\n'),
  'echarts': [
    '❌ 禁止通过 CDN 引入 ECharts 相关资源（echarts.min.js、echarts-gl、china.js 等地图 JS）！',
    '原因：平台已内置 ECharts 与 echarts-gl 并注入页面，重复引入会造成版本冲突和加载竞态',
    '（典型报错：china.js "ECharts is not Loaded"，地图注册失败后整块地图空白）。',
    '替代方案：',
    '1. 图表 → 直接使用全局 echarts 或 LubanUI.chart()，无需任何引入',
    '2. 中国地图 → 直接使用 map: \'china\'（平台已内置注册），或调用 LubanUI.loadChinaMap() / LubanUI.map 组件',
    '3. 省级地图下钻 → LubanUI.loadProvinceMap(adcode)（6 位行政区划编码）',
  ].join('\n'),
};