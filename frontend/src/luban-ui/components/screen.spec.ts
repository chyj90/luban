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

#### 6. 布局启发式：按需求域选范式（不要所有大屏都套地图模板）
| 需求域 | 主视图范式 | 典型布局 |
|--------|-----------|---------|
| 地理态势/站点分布 | 中央大地图（map layers + 下钻） | KPI行 + 左右面板 + 中央地图 |
| 端到端链路/调用链/分层架构 | 中央 layered 拓扑（topology layout:'layered'） | 左侧分组KPI列 + 中央拓扑 + 右侧资源/巡检列 |
| 指标趋势网格 | sparkline KPI 阵列 + 小图网格 | luban-chart-screen-grid-3x2 |
| 混合型 | 中央主视图 + 四周面板 | 面板自由拼装 |

#### 7. 面板自由拼装（非模板布局用这个，不要硬套脚手架）
任意布局用 12 列 CSS Grid 按 grid-area 拼装，每个面板都是"标题 + divider-glow + 图表"三件套：
\`\`\`css
.screen-grid { display: grid; grid-template-columns: repeat(12, 1fr); grid-auto-rows: 90px; gap: 12px; }
.panel-kpi { grid-column: span 3; }      /* 小卡 */
.panel-chart { grid-column: span 4; }    /* 中图 */
.panel-topo { grid-column: span 6; grid-row: span 4; }  /* 主视图大块 */
\`\`\`
LubanUI.topology（含 layered）用法见 Topology 组件规范。

#### 8. 3D 场景类（指挥中心 / 园区类大屏的主视觉）
中央立体地图（geo3D 挤出 + 发光边界 + 标注点）：
\`\`\`js
LubanUI.loadChinaMap(function() {
  LubanUI.map3d('map3d', {
    mapType: 'china', regionHeight: 3,          // 挤出高度
    glowColor: 'rgba(0,212,255,0.9)', markers: [
      { name: '杭州', lng: 120.15, lat: 30.28 }
    ],
    autoRotate: true, showLabels: true
  });
});
\`\`\`
程序化城市/园区体块（3D 白模，可作楼栋点选类大屏的主视觉）：
\`\`\`js
LubanUI.cityBlocks('city3d', { rows: 10, cols: 14, centerTower: true, highlight: '#00d4ff' });
\`\`\`
⚠️ 资产边界：程序化体块是风格化近似；照片级实景园区（无人机实拍/人工建模）需要自备 3D 模型或实拍底图资产，组件库无法凭空生成。

#### 9. 风格 token（visualStyle）——整屏配色统一的关键
\`\`\`js
var style = LubanUI.visualStyle.neon;        // 青紫粉赛博朋克
var style = LubanUI.visualStyle.golden;      // 金色+深蓝（社区/园区综合管理类）
var style = LubanUI.visualStyle.holographic; // 全息蓝
var style = LubanUI.visualStyle.minimal;     // 极简商务
// 应用：图表取 style.chart.*，地图取 style.map，拓扑取 style.topo，容器加 style.containerClass
\`\`\`
⚠️ 同屏所有图表配色必须来自同一 style token，禁止逐图随意配色。

#### 10. 装饰素材速查
luban-screen-bg（整体深底）luban-bg-dots/hex/circuit（纹理）luban-corner-tech-full（四角标）
luban-divider-glow（发光分隔线）luban-data-flow（底部流光）luban-glow-card / luban-glow-text / luban-border-flow
⚠️ 深浅主题：LubanUI.setTheme('dark'|'light') 必须在任何图表初始化前调用。`,
} satisfies ComponentSpec;
