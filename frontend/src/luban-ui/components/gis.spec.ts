import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'GIS',
  category: 'data-display',
  spec: `### GIS 地图（真实地理底图，优先于逻辑地图）
基于 Leaflet（已内置，禁止 CDN 引入）+ 高德瓦片（国内可达、无需 key）。
**优先级规则：地图默认用 LubanUI.gis（GIS 优先）。逻辑地图（LubanUI.map / map:'china'）仅作兜底，只允许两种例外：① 需要省份级填色统计（choropleth）；② 无外网部署环境。使用逻辑地图前须向用户说明理由。**

#### 基础用法
\`\`\`html
<div id="gisMap" style="height:520px;"></div>
\`\`\`
\`\`\`js
LubanUI.gis('gisMap', {
  center: [113.26, 23.13],      // [经度, 纬度]
  zoom: 11,
  style: 'dark',                 // dark=暗色底图（大屏推荐，自动滤镜） | satellite=卫星影像+路网 | street=标准
  markers: [
    { lng: 113.3, lat: 23.1, name: '站点A', color: '#00d4ff', pulse: true, onClick: 'onSiteClick' },
    { lng: 113.45, lat: 23.05, name: '站点B', color: '#ff3d6e' }
  ],
  lines: [
    { from: [113.3, 23.1], to: [114.3, 22.5], color: '#ffd54f', width: 2, name: '干线' }
  ],
  showLabels: true               // 常显标注（false 则悬浮显示）
});
\`\`\`

#### 打点（markers）
| 字段 | 说明 |
|------|------|
| lng/lat | 经纬度 |
| name | 标注名（tooltip） |
| color | 点色（发光呼吸效果） |
| pulse | 呼吸涟漪动画（默认 true） |
| onClick | 点击回调函数名（window 函数）或函数 |
| showLabel | 标注常显 |

#### 飞线（lines）
二次贝塞尔弧线 + 流动虚线动画；字段：from/to（[lng,lat]）、color、width、opacity、name（tooltip）、bow（弧度 0-1，默认 0.22）、effect（false 关闭流动动画）。

#### 返回 API
\`\`\`js
var gis = LubanUI.gis('gisMap', {...});
gis.addMarker({ lng, lat, name, color });   // 动态打点
gis.addLine({ from, to, color });           // 动态飞线
gis.flyTo([lng, lat], 13);                  // 飞行动画定位
gis.remove();                               // 销毁（页面卸载时平台自动调用）
\`\`\`

#### 选型对照
| 场景 | 用法 |
|------|------|
| 园区/社区/城区细节（街道可见） | LubanUI.gis style:'dark' |
| 卫星影像态势 | LubanUI.gis style:'satellite' |
| 全国-省份聚合态势（无街道细节） | LubanUI.map / map3d（逻辑地图）`,
} satisfies ComponentSpec;
