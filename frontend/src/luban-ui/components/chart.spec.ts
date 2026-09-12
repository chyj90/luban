import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Chart',
  category: 'data-display',
  spec: `### 图表 Chart
ECharts 已内置，无需加载 CDN。支持三种使用方式：

#### ⚠️ 深色大屏必须先切换主题
平台默认浅色主题。"深色背景/科技感大屏"类页面，**必须在初始化任何图表前调用**：
\`\`\`js
LubanUI.setTheme('dark');   // 等价于 html 根元素加 data-theme="dark"
\`\`\`
否则图表/地图/组件全部按浅色渲染（白底图表配深色页面会非常突兀）。预设配色的"自动适配深浅主题"读取的就是这个主题开关。

#### 整屏配色统一：setVisualStyle（大屏必用）
\`\`\`js
LubanUI.setVisualStyle('golden');   // neon / golden / holographic / minimal
\`\`\`
设置后 bar/barGlow/line/lineGlow/pie/pieGlow/combo 等**所有预设默认从该风格取色**，整屏配色自动统一——禁止逐图随意传 colors。图表配色 token（style.chart.barColors/lineColors/pieColors）详见 Chart 组件的 visualStyle 表。

#### 方式一：图表预设（推荐，开箱即用）
内置多种美观预设，Agent 只需选择预设类型，自动适配深浅主题。
\`\`\`js
// 柱状图 — 渐变圆角、阴影效果
LubanUI.chartPresets.bar('chart1', {
  categories: ['1月','2月','3月','4月','5月'],
  data: [120, 200, 150, 80, 250],
  showLabel: true            // 显示数值标签
});

// 光晕柱状图 — 三段渐变+发光顶帽+背景柱槽（大屏推荐，对标指挥中心级）
LubanUI.chartPresets.barGlow('chart1g', {
  categories: ['1月','2月','3月','4月','5月'],
  data: [120, 200, 150, 80, 250],
  showLabel: true,             // 顶部数值（带主题色发光）
  texture: true,               // 柱内横向刻度纹理
  topCap: true,                // 柱顶发光亮点（默认开）
  background: true,            // 背景柱槽（默认开）
  colors: ['#00d4ff', '#7b61ff', '#ff3d9a', '#00e676']  // 不传则取 setVisualStyle 的风格色
});

// 折线图 — 平滑曲线、多系列、面积填充
LubanUI.chartPresets.line('chart2', {
  categories: ['周一','周二','周三','周四','周五'],
  series: [
    { name: '流量', data: [820, 932, 901, 934, 1290] },
    { name: '预测', data: [800, 910, 920, 950, 1100] }
  ],
  smooth: true,              // 平滑曲线
  area: true                 // 面积填充
});

// 光晕折线图 — 发光曲线 + 渐变面积（大屏推荐）
LubanUI.chartPresets.lineGlow('chart2g', {
  categories: ['周一','周二','周三','周四','周五'],
  series: [
    { name: '流量', data: [820, 932, 901, 934, 1290] },
    { name: '预测', data: [800, 910, 920, 950, 1100] }
  ],
  area: true, smooth: true,
  colors: ['#00d4ff', '#00e676']
});

// 饼图 — 环形/玫瑰图、圆角、hover 放大
LubanUI.chartPresets.pie('chart3', {
  data: [
    { name: '移动', value: 435 },
    { name: '联通', value: 310 },
    { name: '电信', value: 274 },
    { name: '广电', value: 128 }
  ],
  rose: true,
  radius: ['40%', '75%']
});

// 光晕饼图 — 径向渐变扇区+外圈装饰环+中心数字（大屏推荐，对标指挥中心级）
LubanUI.chartPresets.pieGlow('chart3g', {
  data: [
    { name: '移动', value: 435 },
    { name: '联通', value: 310 },
    { name: '电信', value: 274 }
  ],
  rose: true,
  centerText: '9,467',         // 环心大数字
  centerSub: '总数',            // 环心副文字
  decorRing: true,             // 外圈装饰环+刻度（默认开）
  colors: ['#00d4ff', '#7b61ff', '#ff3d9a']  // 不传则取 setVisualStyle 的风格色
});

// 仪表盘 — 适用于 KPI 指标
LubanUI.chartPresets.gauge('chart4', {
  name: '网络覆盖率',
  value: 87.5,
  unit: '%',
  min: 0, max: 100,
  thresholds: [60, 85]       // 绿→黄→红 分界值
});

// 雷达图 — 多维指标对比
LubanUI.chartPresets.radar('chart5', {
  indicators: [
    { name: '覆盖率', max: 100 },
    { name: '速率', max: 100 },
    { name: '延迟', max: 100 },
    { name: '可靠性', max: 100 },
    { name: '容量', max: 100 }
  ],
  series: [{ name: '4G', value: [95, 72, 68, 88, 76] }],
  area: true
});

// 漏斗图 — 转化分析
LubanUI.chartPresets.funnel('chart6', {
  data: [
    { name: '浏览', value: 1000 },
    { name: '点击', value: 680 },
    { name: '咨询', value: 320 },
    { name: '下单', value: 150 },
    { name: '支付', value: 98 }
  ]
});

// 散点图 — 分布分析
LubanUI.chartPresets.scatter('chart7', {
  data: [[10, 20], [15, 30], [22, 18], [28, 35]],
  xName: '用户数', yName: '收入'
});

// 组合图表 — 柱状图 + 折线图双 Y 轴（运营商监控大屏常用）
LubanUI.chartPresets.combo('chart8', {
  categories: ['1月','2月','3月','4月','5月'],
  bars: [{ name: '工单数', data: [120, 200, 150, 180, 220] }],
  lines: [{ name: '处理率', data: [85, 92, 88, 95, 90] }],
  yLeftName: '工单量（件）', yRightName: '处理率（%）',
  area: true, smooth: true
});
\`\`\`

#### colors + overrides（灵活定制）
所有预设均支持 \`colors\` 自定义配色和 \`overrides\` 深合并 ECharts 配置：
\`\`\`js
LubanUI.chartPresets.bar('chart1', {
  data: [120, 200, 150],
  colors: ['#f97316', '#fb923c', '#fdba74'],    // 自定义配色
  borderRadius: [12, 12, 0, 0],                   // 自定义圆角
  overrides: {                                     // 深合并任意 ECharts 属性
    animation: false,
    yAxis: { max: 300, name: '单位：件' },
    series: [{ markLine: { data: [{ type: 'average', name: '均值' }] } }]
  }
});
\`\`\`

#### 方式二：3D 图表（需 echarts-gl，已内置）
\`\`\`js
// 3D 柱状图 — 自动旋转、光影着色
LubanUI.chartPresets.bar3d('chart3d', {
  data: [120, 200, 150, 80, 250],
  xLabels: ['1月','2月','3月','4月','5月'],
  zLabels: ['销售额'],
  autoRotate: true,
  rotateSpeed: 6
});

// 3D 折线图
LubanUI.chartPresets.line3d('chart3d2', {
  data: [120, 200, 150, 80, 250],
  autoRotate: true
});
\`\`\`
如果 echarts-gl 未加载，3D 图表会自动降级为美观的 2D 版本。

#### 方式三：原生 ECharts（高级自定义）
\`\`\`js
LubanUI.chart('myChart', {
  tooltip: { trigger: 'axis' },
  xAxis: { type: 'category', data: ['1月','2月','3月'] },
  yAxis: { type: 'value' },
  series: [{ name: '销售额', type: 'bar', data: [120,200,150] }]
});
\`\`\`

#### 大屏图表布局
深色大屏推荐使用以下 CSS 类名组合：
\`\`\`html
<!-- 带发光效果的大屏图表 -->
<div class="luban-chart-style-glow luban-chart-screen-grid luban-chart-screen-grid-2x2">
  <div class="luban-chart-item"><div class="luban-chart-title">流量趋势</div><div id="chart1" style="height:280px;"></div></div>
  <div class="luban-chart-item"><div class="luban-chart-title">用户分布</div><div id="chart2" style="height:280px;"></div></div>
  <div class="luban-chart-item"><div class="luban-chart-title">告警统计</div><div id="chart3" style="height:280px;"></div></div>
  <div class="luban-chart-item"><div class="luban-chart-title">KPI 仪表盘</div><div id="chart4" style="height:280px;"></div></div>
</div>
\`\`\`
- \`luban-chart-style-card\`: 卡片风格
- \`luban-chart-style-glow\`: 发光边框（大屏推荐）
- \`luban-chart-screen-grid-2x2\`: 2×2 网格
- \`luban-chart-screen-grid-3x2\`: 3×2 网格

#### 数字滚动动画 countUp（大屏 KPI 必备）
\`\`\`html
<span id="userCount" class="luban-count-up">0</span>
\`\`\`
\`\`\`js
LubanUI.countUp('userCount', 98234, {
  duration: 2000,        // 动画时长 ms
  prefix: '',            // 前缀（如 '¥'）
  suffix: ' 人',        // 后缀（如 ' 人'、'%'）
  decimals: 0,           // 小数位数
  separator: true,       // 千分位逗号
  delay: 300             // 延迟启动 ms
});
\`\`\`

#### 视觉风格预设 visualStyle（一键大屏风格）
提供三套完整配色预设，覆盖图表/地图/拓扑：
\`\`\`js
var style = LubanUI.visualStyle.neon;  // 或 holographic / minimal

// 应用到地图
LubanUI.map('mapId', Object.assign({ layers: [...], drillDown: true }, style.map));

// 应用到图表（取配色）
LubanUI.chartPresets.barGlow('chartId', { data: [...], colors: style.chart.barColors });

// 应用到拓扑（取状态色）
LubanUI.topology('topoId', Object.assign({ nodes: [...], links: [...] }, style.topo));

// 容器加特效 class
// <div class="luban-chart-item luban-glow-card">  → style.containerClass
\`\`\`
| 预设 | 风格 | 配色 |
|------|------|------|
| \`visualStyle.neon\` | 赛博朋克大屏 | 青色 #00d4ff + 紫色 #7b61ff + 粉色 #ff3d9a |
| \`visualStyle.holographic\` | 全息科技感 | 蓝色 #4dabf7 + 冰蓝 #7bc8ff + 青绿 #3bd6c6 |
| \`visualStyle.minimal\` | 极简商务 | 深蓝 #1e3a5f + 蓝色 #2563eb |

#### CSS 视觉特效（可直接用于卡片容器）
| class | 效果 | 适用 |
|-------|------|------|
| \`luban-glow-card\` | 霓虹渐变边框+hover光晕 | 核心指标卡片 |
| \`luban-glass-card\` | 毛玻璃模糊效果 | 浮动面板 |
| \`luban-border-flow\` | 流动旋转光效边框 | 告警高亮容器 |
| \`luban-glow-text\` | 文字发光（text-shadow） | 大屏标题 |
| \`luban-pulse-dot\` | 脉冲呼吸点（.warning/.danger） | 状态指示灯 |
\`\`\`html
<div class="luban-chart-item luban-glow-card">
  <div class="luban-chart-title glow">核心指标</div>
  <span id="kpi1" class="luban-count-up luban-glow-text">0</span>
  <span class="luban-pulse-dot danger"></span> 告警中
</div>
\`\`\`

#### 大屏装饰素材（纯 CSS，无需图片）
| class | 效果 | 用法 |
|-------|------|------|
| \`luban-bg-dots\` | 圆点网格背景 | 页面/卡片背景纹理 |
| \`luban-bg-hex\` | 六边形蜂窝网格 | 科技感背景 |
| \`luban-bg-circuit\` | 斜线电路板纹理 | 深色大屏背景 |
| \`luban-screen-bg\` | 径向光晕+深色底 | 大屏整体背景（推荐） |
| \`luban-corner-tech\` | 顶部双 L 角标 | 卡片/面板装饰 |
| \`luban-corner-tech-full\` | 四角 L 角标 | 核心面板装饰 |
| \`luban-divider-glow\` | 发光渐变分隔线 | 标题下方 |
| \`luban-data-flow\` | 流动光点线条 | 大屏底部/侧边装饰 |
| \`luban-ring\` | 科技圆环 | 装饰光环（.glow .spin 增强） |
| \`luban-dot-matrix\` | 装饰点阵线 | 标题上下点缀 |
\`\`\`html
<!-- 标准大屏完整结构 -->
<body class="luban-screen-bg luban-bg-dots" style="margin:0; min-height:100vh;">
  <div style="padding:20px;">
    <div class="luban-chart-item luban-corner-tech">
      <div class="luban-chart-title glow">核心指标</div>
      <div class="luban-divider-glow"></div>
      <!-- 图表区域 -->
    </div>
  </div>
  <!-- 底部流动装饰 -->
  <div class="luban-data-flow" style="position:fixed; bottom:20px; left:10%; width:80%;"></div>
</body>
\`\`\`

#### 图表预设速查
| 预设 | 函数 | 效果 |
|------|------|------|
| 柱状图 | \`chartPresets.bar()\` | 渐变圆角 + 阴影 |
| 光晕柱 | \`chartPresets.barGlow()\` | 霓虹发光 + 深阴影 |
| 折线图 | \`chartPresets.line()\` | 平滑曲线 + 面积 |
| 光晕线 | \`chartPresets.lineGlow()\` | 发光曲线 + 渐变面积 |
| 饼图 | \`chartPresets.pie()\` | 环形/玫瑰 |
| 光晕饼 | \`chartPresets.pieGlow()\` | 立体阴影 + 深色边框 |
| 3D柱 | \`chartPresets.bar3d()\` | 自动旋转 + 光影 |
| 3D线 | \`chartPresets.line3d()\` | 自动旋转 |
| 仪表盘 | \`chartPresets.gauge()\` | KPI 仪表 |
| 雷达图 | \`chartPresets.radar()\` | 多维对比 |
| 漏斗图 | \`chartPresets.funnel()\` | 转化分析 |
| 散点图 | \`chartPresets.scatter()\` | 分布分析 |
| 组合图 | \`chartPresets.combo()\` | 柱+线双Y轴 |`,
} satisfies ComponentSpec;