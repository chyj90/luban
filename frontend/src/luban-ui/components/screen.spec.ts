import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Screen',
  category: 'layout',
  spec: `### 指挥中心大屏（Screen）
构建照片级指挥中心大屏的完整范式：固定设计稿等比缩放 + 密集区块 + 统一装饰。
**强烈建议：大屏类需求直接以 create_page_scaffold(type='dashboard') 的骨架为起点填充数据，而不是从空白页拼布局。**

#### 1. 底座：1920×1080 设计稿等比缩放
任意分辨率下布局不散架——大屏的行业标准做法：
\`\`\`js
LubanUI.setTheme('dark');   // 或 'light'，按用户需求
LubanUI.screenScaler({ width: 1920, height: 1080, target: '.screen-wrap' });
\`\`\`
目标元素按 1920×1080 固定布局，整体随窗口等比缩放居中。

#### 2. 标题栏：发光标题 + 多时区时钟
\`\`\`html
<div class="screen-header luban-corner-tech">
  <div class="screen-title luban-glow-text">全球智能运营指挥调度中心</div>
  <div id="worldClock"></div>
</div>
\`\`\`
\`\`\`js
LubanUI.worldClock('worldClock', { zones: [
  { label: '北京', offset: 8 }, { label: '莫斯科', offset: 3 },
  { label: '伦敦', offset: 1 }, { label: '纽约', offset: -4 }
]});   // 内部自动每秒刷新并注册定时器清理
\`\`\`

#### 3. KPI 卡 + 内嵌迷你趋势图（sparkline）
\`\`\`html
<div class="kpi-card luban-glow-card">
  <div class="kpi-label">量子到家活跃效率</div>
  <div class="kpi-value" id="kpi1">0</div>
  <div class="kpi-spark" id="kpi1Spark"></div>
</div>
\`\`\`
\`\`\`js
LubanUI.countUp('kpi1', 97.15, { decimals: 2, suffix: '%' });
LubanUI.chartPresets.spark('kpi1Spark', { data: [5,9,4,7,6,8,5], type: 'bar' });  // 或 type:'line'
\`\`\`

#### 4. 密度要求（大屏质感的第一要素）
一屏至少 10-12 个数据区块，参考结构：
\`\`\`
┌─────────────────── 标题栏（发光标题 + 多时区时钟）───────────────────┐
├─────────┬─────────┬─────────┬─────────┐                              │
│ KPI+趋势 │ KPI+趋势 │ KPI+趋势 │ KPI+趋势 │                              │
├──────┬──┴──────┬──┴──────────────────────────┬─────────┬──────────┤
│ 面板1 │  中央大地图（3fr:5fr:3fr，地图占最大）  │  面板3    │
│ 面板2 │  scatter + effectScatter + lines 飞线 │  面板4    │
└──────┴─────────────────────────────────────┴──────────┘
底部：luban-data-flow 流动装饰
\`\`\`
左右面板建议：排名条/环形占比/柱线组合/雷达/仪表盘混搭（chartPresets 全家桶），每个面板都是"标题 + divider-glow + 图表"三件套。

#### 5. 中央地图：多层组合
\`\`\`js
LubanUI.loadChinaMap(function() {
  LubanUI.map('mapChart', {
    mapType: 'china', roam: true, drillDown: true,
    layers: [
      { id: 'sites', type: 'scatter', data: [...], zlevel: 2 },
      { id: 'alarms', type: 'effectScatter', data: [...], ripplePeriod: 3, zlevel: 3 },
      { id: 'fiber', type: 'lines', data: [...], effect: true, zlevel: 1 }   // 飞线
    ]
  });
});
\`\`\`

#### 6. 装饰素材速查
luban-screen-bg（整体深底）luban-bg-dots/hex/circuit（纹理）luban-corner-tech-full（四角标）
luban-divider-glow（发光分隔线）luban-data-flow（底部流光）luban-glow-card / luban-glow-text / luban-border-flow
⚠️ 深浅主题：LubanUI.setTheme('dark'|'light') 必须在任何图表初始化前调用。`,
} satisfies ComponentSpec;
