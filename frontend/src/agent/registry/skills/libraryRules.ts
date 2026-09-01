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
};