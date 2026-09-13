import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'ScreenDecor',
  category: 'layout',
  spec: `### 大屏装饰体系（decor）— 指挥中心级质感标配
统一蓝青色相色板（背景分层海军蓝 / 主发光青 #3CE4FC / 图表蓝紫 #6C90E4 / 点睛橙 #F08818）。
**两条铁律：**
1. **质感是基线**：所有大屏的边框、标题栏、面板、KPI、底部导航一律用以下 API 组装，禁止手写裸 div+border 面板
2. **布局是自由变量**：decor.panel 可建任意数量的面板，栅格比例、分区方式（左1右2 / 上下叠放 / 无地图 / 表格图表混排）必须跟随需求分析第 4 章的模块构成灵活排布——每个大屏的布局都应长得不一样，复用的只有构件和质感

#### 1. 全屏科技边框（四角装饰 + 边线扫光）
\`\`\`js
LubanUI.decor.frame('.luban-screen-tech');   // 不传参挂 body
\`\`\`

#### 2. 大屏标题栏（梯形标题座 + 翼线 + 扫光）
\`\`\`js
LubanUI.decor.header('screenHeader', { title: '全网运营指挥调度中心' });
\`\`\`

#### 3. 科技面板（斜切标题栏 + 图标 + 发光下划线），返回 body 容器
\`\`\`js
LubanUI.decor.panel('chart1Panel', { title: '告警类型构成', icon: 'radar' });
// icon 可选值见 LubanUI.iconList()，常用: radar / alert / chart-bar / chart-pie / database / gauge / server / network / satellite / shield / users / truck / camera / wifi
// 图表初始化到返回的 body: LubanUI.chart('chart1', ...) 或 chartPresets
\`\`\`

#### 4. 底部图标导航条
\`\`\`js
LubanUI.decor.iconNav('bottomNav', [
  { icon: 'dashboard', label: '总览', active: true, onClick: 'onNav' },
  { icon: 'alert', label: '告警' }
]);
\`\`\`

#### 5. 图标（内联 SVG，34 枚，Tabler 子集）
\`\`\`js
LubanUI.icon('alarm', { size: 20, strokeWidth: 1.8 })  // 返回 SVG 字符串，currentColor 跟随容器颜色
\`\`\`

#### 5.1 多时区时钟（worldClock 的正确/错误用法）
\`\`\`js
LubanUI.worldClock('worldClock', { zones: [{ label: '北京', offset: 8 }, { label: '伦敦', offset: 1 }] })  // ✅
LubanUI.worldClock('worldClock', [{ label: '北京', offset: 8 }])  // ⚠️ 数组会被容错为单时区，但应传 { zones }
\`\`\`
标题栏 clock 槽位用 decor.header 的 clock 参数创建（见第 2 条）。

#### 5.2 语义状态色（在线/离线/告警等状态着色，随主题与调色板联动）
\`\`\`js
var P = LubanUI.screenPalette;
P.success   // 正常/在线（深色 #4ADE80 / 浅色 #16A34A）
P.danger    // 异常/告警（深色 #FF6B5E / 浅色 #DC2626）
P.warning   // 警告/离线（深色 #FBBF24 / 浅色 #D97706）
// 设备状态环形图示例：colors: [P.success, P.danger, P.warning]
// 禁止硬编码 '#4ade80'/'#ff4d4f' 等状态色
\`\`\`

#### 6. 图表配色（统一取色板，禁止自配紫/粉/绿）
\`\`\`js
var P = LubanUI.screenPalette;
// P.series = ['#3CE4FC', '#6C90E4', '#F08818', '#18A8C0', '#30A8D8', '#9E86E0']
// P.barGradient()      柱状竖向渐变（顶部主色 → 底部渐隐）
// P.areaGradient()     面积图填充（主色 → 透明）
// P.ghost              柱状图 ghost 背景柱色
// P.axisLine / P.splitLine  坐标轴颜色
color: P.barGradient(P.cyan)   // 示例
\`\`\`

#### 6.1 用户指定配色/风格 → setPalette 程序化派生
\`\`\`js
LubanUI.setPalette({ primary: '#22C55E' })                  // "绿色系"——按当前主题派生全套配色
LubanUI.setPalette({ primary: '#E23A2E', mode: 'light' })   // "浅色红色党建风"
LubanUI.setPalette('golden')                                // 命名预设: neon/golden/holographic/minimal
LubanUI.resetPalette()                                      // 恢复内置色板
\`\`\`
派生范围：背景分层/面板/边框/发光/标题/图表序列全部联动；点睛橙固定保留。
**在 setTheme 之后调用；setTheme 切换时已设置的自定义调色板会自动跟随新模式重新派生。**
禁止手写覆盖 --scr-* / --luban-* CSS 变量——用户只给意图（"绿色系"），色值由派生函数生成。

#### 6.2 信息密度/组件大小 → setDensity 档位缩放
\`\`\`js
LubanUI.setDensity('compact')   // 紧凑屏：面板头 28px、KPI 值 26px、间距 8px（一屏 6-8 面板）
LubanUI.setDensity('large')     // 宽松屏：面板头 40px、KPI 值 40px（大字展示）
LubanUI.setDensity({ panelHeadH: 28, kpiValue: 26 })  // 精细指定（8-200px）
LubanUI.resetDensity()          // 恢复默认
\`\`\`
缩放范围：栅格间距(--scr-gap)/标题栏/面板头/KPI 数值与迷你图/底部导航。**面板数量多时优先配 compact。**
页面栅格间距引用 var(--scr-gap, 12px) 即可随档位联动，禁止手写覆盖组件尺寸。

#### 7. 数码字体 + 地图光环
- 大数字/时钟加 class "luban-num"（Orbitron 内置字体）
- 地图装饰光环：<div class="luban-halo" style="width:60%;height:60%"></div>（放在 position:relative 的地图包装层内）
- 页面底座 class "luban-screen-tech"（分层海军蓝渐变背景），氛围底纹加 "luban-hex-bg"
- 年/周/月切换：<div class="luban-pill-tabs"><span class="luban-pill-tab active">年</span>...</div>

#### 8. 画布尺寸（默认 1920×1080，按用户要求可变）
\`\`\`js
LubanUI.screenScaler({ width: 2560, height: 720, target: '.luban-screen-tech' })   // 超宽条屏
LubanUI.screenScaler({ width: 1080, height: 1920, target: '.luban-screen-tech' })  // 竖屏
\`\`\`
- 设计与预览都按此画布，投放时等比缩放居中（fit-contain），无需为分辨率单独适配
- **画布比例决定布局形态**：16:9 用左右三栏；超宽（宽高比>2.4）用多列横排；竖屏纵向堆叠；禁止硬套三栏
- 画布越大组件相对越小：4K 及以上配 setDensity('large')，小画布高密度配 'compact'`,
} satisfies ComponentSpec;
