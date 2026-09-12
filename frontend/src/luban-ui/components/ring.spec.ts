import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Ring',
  category: 'data-display',
  spec: `### 环形占比图 Ring（环心总计 + 右侧分项列表 / 单值进度环）
**选型**：强调"占比构成、玫瑰/立体感"用 pieGlow；强调"**总计 + 分项数值列表**"或"**单值进度**"用 Ring。

#### 用法一：分项环（人口构成/设施分类/租住统计）
\`\`\`html
<div id="popRing" style="height:160px;"></div>
\`\`\`
\`\`\`js
LubanUI.ring('popRing', {
  data: [
    { name: '租赁房屋', value: 3627 },
    { name: '自住房屋', value: 2949 },
    { name: '空置房屋', value: 635 }
  ],
  centerLabel: '人口总数',      // 环心下方文字；环心数值默认自动求和
  // centerText: '23,618',      // 或手动指定环心数字
  unit: '人',                   // 列表数值单位
  size: 150,                    // 环尺寸(px)
  decorRing: true               // 外圈装饰细环（默认开）
});
\`\`\`
效果：左环（圆角扇区+间隙+外圈装饰环，环心总计）+ 右侧分项列表（发光色点+名称+数值），列表 hover 联动高亮扇区。

#### 用法二：单值进度环（占比 25%/30% 小环组，可并排多个）
\`\`\`html
<div style="display:flex; gap:12px;">
  <div id="r1" style="width:90px;height:90px;"></div>
  <div id="r2" style="width:90px;height:90px;"></div>
  <div id="r3" style="width:90px;height:90px;"></div>
</div>
\`\`\`
\`\`\`js
LubanUI.ring('r1', { progress: 73.2, size: 90 });   // 自住占比 73.2%
LubanUI.ring('r2', { progress: 25,  size: 90 });
LubanUI.ring('r3', { progress: 30,  size: 90 });
\`\`\`
渐变进度弧 + 圆角端点 + 环心百分比。

#### 参数
| 参数 | 说明 |
|------|------|
| data | 分项数组 [{ name, value, color? }]（progress 模式不需要） |
| progress | 单值 0-100，设置后进入进度环模式 |
| centerText / centerLabel | 环心数字（默认自动求和）/ 环心下方文字 |
| centerColor / centerUnit | 环心颜色 / 进度环百分比单位 |
| unit | 分项列表数值单位 |
| size | 环尺寸 px（默认 150） |
| showList | 是否显示右侧分项列表（默认 true，progress 模式无列表） |
| colors / decorRing / radius / borderRadius | 同 pieGlow 语义`,
} satisfies ComponentSpec;
