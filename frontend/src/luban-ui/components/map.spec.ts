import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Map',
  category: 'data-display',
  spec: `### 地图 Map（逻辑地图——省份填色统计/无外网环境的兜底选择）
⚠️ 日常地图需求默认用 LubanUI.gis（真实瓦片底图，见 GIS 组件规范）；本组件仅在需要省份级填色统计（choropleth）或无外网部署环境时使用。
基于中国地图的站点分布与光缆路由可视化，支持散点/涟漪散点/热力图/光缆线路。
基于中国地图的站点分布与光缆路由可视化，支持散点/涟漪散点/热力图/光缆线路。
**v3 新增：多图层架构 — LLM 自由组合任意图层，支持动态增删。**
**支持图层类型：scatter / effectScatter / breathingScatter / heatmap / lines / custom。**
⚠️ 深色大屏必须先调用 LubanUI.setTheme('dark')，地图区域颜色按主题自动适配（默认浅色主题下是浅色地图）。

#### 基础用法（推荐 layers[] 多图层）
\`\`\`html
<div class="luban-chart-item">
  <div class="luban-chart-title">基站分布</div>
  <div id="siteMap" style="height:500px;"></div>
</div>
\`\`\`
\`\`\`js
LubanUI.loadChinaMap(function() {
  LubanUI.map('siteMap', {
    mapType: 'china',
    roam: true,
    zoom: 1.2,
    layers: [
      // 图层1：机房散点（核心层）
      { id: 'core-sites', type: 'scatter', data: [
        { name: '南京总部', lng: 118.78, lat: 32.04, size: 8, color: '#1677ff', tooltip: '南京核心机房' },
        { name: '北京节点', lng: 116.40, lat: 39.90, size: 6, color: '#22c55e', tooltip: '北京容灾中心' },
        { name: '广州节点', lng: 113.26, lat: 23.13, size: 5, color: '#22c55e' }
      ], zlevel: 2 },
      // 图层2：基站散点（边缘层）
      { id: 'edge-bs', type: 'scatter', data: [
        { name: '江宁基站', lng: 118.85, lat: 31.95, size: 3, color: '#f59e0b' },
        { name: '栖霞基站', lng: 118.91, lat: 32.12, size: 3, color: '#22c55e' }
      ], zlevel: 1, color: '#f59e0b', showLabel: false },
      // 图层3：告警涟漪
      { id: 'alarm-sites', type: 'effectScatter', data: [
        { name: '告警站点', lng: 121.47, lat: 31.23, color: '#ef4444', tooltip: '⚠️ 设备离线' }
      ], ripplePeriod: 4 },
      // 图层4：光缆线路
      { id: 'fiber-lines', type: 'lines', data: [
        { fromLng: 118.78, fromLat: 32.04, toLng: 116.40, toLat: 39.90, color: '#4dabf7', width: 2, effect: true, tooltip: '南京→北京 骨干光缆' },
        { fromLng: 118.78, fromLat: 32.04, toLng: 113.26, toLat: 23.13, color: '#4ade80', width: 1.5, effect: true, tooltip: '南京→广州 备用路由' }
      ]}
    ]
  });
});
\`\`\`

#### 图层 layers[] 配置
每个图层是一个独立对象，支持以下 type：
| type | 说明 | 核心配置 |
|------|------|---------|
| **scatter** | 散点图 | data[] (name/lng/lat/size/color/tooltip/onClick) |
| **effectScatter** | 涟漪散点（告警用） | data[]，ripplePeriod/rippleScale/rippleBrushType |
| **heatmap** | 热力分布 | data[] ([lng,lat,value])，heatMin/heatMax/heatColors |
| **lines** | 光缆线路 | data[] (fromLng/fromLat/toLng/toLat)，showEffect/lineColor/lineWidth |
| **custom** | LLM 自定义 ECharts series | series: { ... 完整 ECharts series 配置 }，coordinateSystem:'geo' |

**图层通用配置：**
| 字段 | 说明 |
|------|------|
| id | 图层唯一标识（addLayer 不传则自动生成） |
| type | 图层类型 |
| data | 图层数据数组 |
| zlevel | 图层叠放顺序（值越大越靠上，默认 heatmap=0, scatter/lines=1, effectScatter=2） |
| showLabel | 是否显示标签（scatter 默认 true，effectScatter 默认 false） |

#### LLM 自定义图层（type: 'custom'）
LLM 可以直接传入 ECharts native series 配置实现任意图表类型：
\`\`\`js
// 示例：用 custom 图层叠加一个飞线动画
LubanUI.loadChinaMap(function() {
  LubanUI.map('siteMap', {
    mapType: 'china',
    layers: [
      { id: 'sites', type: 'scatter', data: [
        { name: '南京', lng: 118.78, lat: 32.04, color: '#1677ff' }
      ]},
      { id: 'fly-lines', type: 'custom', zlevel: 3,
        series: {
          type: 'lines', coordinateSystem: 'geo',
          effect: { show: true, period: 4, trailLength: 0.1, symbol: 'pin' },
          lineStyle: { color: '#ffd700', width: 1, opacity: 0.6, curveness: 0.3 },
          data: [
            { coords: [[104.06, 30.67], [118.78, 32.04]] },
            { coords: [[121.47, 31.23], [118.78, 32.04]] }
          ]
        }
      }
    ]
  });
});
\`\`\`

#### 动态图层管理 API
\`LubanUI.map()\` 返回 ECharts instance，可通过 \`instance._lubanLayers\` 动态操作图层：
\`\`\`js
var map = LubanUI.map('siteMap', { mapType: 'china', layers: [...] });

// 动态添加图层（返回图层 ID）
map._lubanLayers.addLayer({ id: 'new-sites', type: 'scatter', data: [...], color: '#8b5cf6' });

// 移除图层
map._lubanLayers.removeLayer('new-sites');

// 更新图层数据/配置
map._lubanLayers.updateLayer('fiber-lines', { data: newLineData, showEffect: false });

// 查看当前所有图层
console.log(map._lubanLayers.getLayers());

// 清空全部图层
map._lubanLayers.clearLayers();
\`\`\`

#### 如何配合 LLM
Agent 可通过以下模式利用多图层：
1. **定时刷新**：setInterval 调用 updateLayer 替换 data 实现实时数据刷新
2. **开关告警层**：按钮控制 effectScatter 层添加/移除
3. **筛选展示**：根据条件 clearLayers + addLayer 重新组合图层
4. **自定义冷却**：用 custom 图层实现 ECharts 原生支持的任意图表能力

#### 单图层模式（兼容旧版，仍可用）
\`\`\`js
LubanUI.loadChinaMap(function() {
  LubanUI.map('siteMap', {
    mapType: 'china',
    scatter: [
      { name: '南京总部', lng: 118.78, lat: 32.04, size: 8, color: '#1677ff' }
    ],
    effectScatter: [
      { name: '告警站点', lng: 121.47, lat: 31.23, color: '#ef4444' }
    ],
    lines: [
      { fromLng: 118.78, fromLat: 32.04, toLng: 116.40, toLat: 39.90, color: '#4dabf7', effect: true }
    ]
  });
});
\`\`\`

#### 省份下钻
设置 \`drillDown: true\` + 图层，下钻时图层保持不变（同批图层投影到省市地图）：
\`\`\`js
LubanUI.loadChinaMap(function() {
  LubanUI.map('siteMap', {
    mapType: 'china',
    drillDown: true,
    layers: [
      { id: 'sites', type: 'scatter', data: /* ... */ },
      { id: 'fiber', type: 'lines', data: /* ... */ }
    ],
    onProvinceClick: function(provinceInfo) {
      // return false 阻止默认下钻
    }
  });
});
\`\`\`

#### LLM 可配置散点动作
散点/涟漪散点 data 项配置 \`onClick\` 字段，Agent 定义 window 函数：
\`\`\`js
window.onSiteClick = function(pointData, chartInstance, container) {
  LubanUI.modal.open({
    title: '站点详情 - ' + pointData.name,
    content: '<p>经纬度: (' + pointData.lng + ', ' + pointData.lat + ')</p>',
    width: 500
  });
};
\`\`\`
\`\`\`js
// 散点数据中引用
{ name: '南京总部', lng: 118.78, lat: 32.04, onClick: 'onSiteClick' }
\`\`\`

#### 地图参数
| 参数 | 默认值 | 说明 |
|------|--------|------|
| roam | true | 是否可缩放平移 |
| zoom | 1 | 初始缩放级别 |
| center | [lng, lat] | 视口中心经纬度 |
| showLabel | false | 是否显示省份标签 |
| areaColor | 自动 | 地图区域颜色（深色/浅色自动适配） |
| drillDown | false | 是否开启省份点击下钻 |
| onProvinceClick | - | 省份点击回调，返回 false 阻止下钻 |
| **layers** | - | **v3 新增**：图层数组，推荐使用 |

#### 典型运营商场景
1. **站点分布图**：1个 scatter 图层，onClick 跳转详情
2. **告警监控大屏**：scatter（正常）+ effectScatter（告警）+ lines（光缆），setInterval 实时刷新
3. **光缆路由图**：lines 图层，effect:true 模拟光信号流动
4. **覆盖热力图**：heatmap 图层显示信号强度
5. **省市三级下钻**：drillDown:true + layers，全国→省→市层层深入
6. **综合大屏**：scatter + effectScatter + lines + heatmap 四层叠加，custom 图层补充飞线/3D 等

#### Agent 使用建议
- 多类型数据用 layers[] 替代扁平配置，一个图层一类数据，职责清晰
- scatter/effectScatter 的 data 项挂 onClick 实现交互
- 实时数据用 updateLayer 替换 data 而非重建地图
- custom 图层可写任意 ECharts series 配置，不受内置类型限制
- 省份经纬度参考：南京(118.78,32.04) 北京(116.40,39.90) 上海(121.47,31.23) 广州(113.26,23.13) 成都(104.06,30.67)`,
} satisfies ComponentSpec;