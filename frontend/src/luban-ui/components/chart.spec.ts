import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Chart',
  category: 'data-display',
  spec: `### 图表 Chart
\`\`\`html
<div class="luban-chart-item"><div class="luban-chart-title">图表标题</div><div class="luban-chart"><div id="myChart" style="height:300px;"></div></div></div>
\`\`\`
\`\`\`js
LubanUI.chart('myChart', { tooltip: { trigger: 'axis' }, xAxis: { type: 'category', data: ['1月','2月','3月'] }, yAxis: { type: 'value' }, series: [{ name: '销售额', type: 'bar', data: [120,200,150] }] });
\`\`\`
ECharts 已内置，无需加载 CDN。`,
} satisfies ComponentSpec;