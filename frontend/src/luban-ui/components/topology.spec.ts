import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Topology',
  category: 'data-display',
  spec: `### 拓扑图 Topology（运营商网络拓扑）
专门为运营商场景设计的网络拓扑组件，支持节点状态、链路类型、告警闪烁、力导向布局。
**v2 新增：支持下钻展开 + LLM 可配置节点点击动作。**

#### 基础用法
\`\`\`html
<div class="luban-chart-item">
  <div class="luban-chart-title">网络拓扑</div>
  <div id="netTopology" style="height:500px;"></div>
</div>
\`\`\`
\`\`\`js
LubanUI.topology('netTopology', {
  nodes: [
    { id: 'nj-core', name: '南京核心', type: 'router', status: 'normal', fixed: true, x: 400, y: 300, tooltip: '南京核心路由器<br/>负载: 65%' },
    { id: 'nj-sw1', name: '鼓楼交换机', type: 'switch', status: 'normal', tooltip: '端口: 24/48<br/>流量: 2.3Gbps' },
    { id: 'jx-bs1', name: '江宁基站', type: 'baseStation', status: 'warning', tooltip: '信号强度: -75dBm<br/>在线用户: 128' },
    { id: 'jx-bs2', name: '百家湖基站', type: 'baseStation', status: 'alarm', alarming: true, tooltip: '⚠️ 信号中断<br/>最后上报: 3分钟前' },
    { id: 'srv-web', name: 'Web服务器', type: 'server', status: 'normal', tooltip: 'CPU: 45%<br/>内存: 62%' }
  ],
  links: [
    { source: 'nj-core', target: 'jx-bs1', type: 'fiber', status: 'normal', label: '万兆光缆' },
    { source: 'nj-core', target: 'jx-bs2', type: 'fiber', status: 'alarm', label: '光缆中断' },
    { source: 'nj-core', target: 'srv-web', type: 'fiber', status: 'normal' }
  ],
  repulsion: 350,
  gravity: 0.08,
  edgeLength: [180, 400]
});
\`\`\`

#### 下钻展开（点击节点展开子拓扑）
节点配置 \`children\` 字段，点击后自动展开子拓扑，顶部显示面包屑导航。
\`\`\`js
LubanUI.topology('netTopology', {
  nodes: [
    {
      id: 'nj-core', name: '南京核心', type: 'router', status: 'normal', fixed: true, x: 400, y: 300,
      // 下钻：点击展开南京核心下挂的子网拓扑
      children: {
        nodes: [
          { id: 'nj-sub1', name: '核心CRS-1', type: 'router', status: 'normal', tooltip: '集群主节点' },
          { id: 'nj-sub2', name: '核心CRS-2', type: 'router', status: 'warning', tooltip: '备节点，延迟偏高' },
          { id: 'nj-fw1', name: '防火墙-1', type: 'server', status: 'normal' },
          { id: 'nj-fw2', name: '防火墙-2', type: 'server', status: 'offline', alarming: true }
        ],
        links: [
          { source: 'nj-sub1', target: 'nj-sub2', type: 'fiber', status: 'normal' },
          { source: 'nj-sub1', target: 'nj-fw1', type: 'fiber', status: 'normal' },
          { source: 'nj-sub2', target: 'nj-fw2', type: 'fiber', status: 'alarm' }
        ]
      }
    },
    { id: 'bj-core', name: '北京核心', type: 'router', status: 'normal', fixed: true, x: 200, y: 100 }
  ],
  links: [
    { source: 'nj-core', target: 'bj-core', type: 'fiber', status: 'normal', label: '京宁干线' }
  ]
});
\`\`\`
下钻后自动出现面包屑：**全网拓扑 > 南京核心**，点击可返回任意层级。

#### LLM 可配置节点动作
节点配置 \`onClick\` 字段（函数名字符串），Agent 在页面内定义同名 window 函数即可。
\`\`\`js
// Agent 生成的页面脚本中定义动作函数
window.onTopoNodeClick = function(nodeData, chartInstance, container) {
  alert('点击了: ' + nodeData.name + '\\n状态: ' + nodeData.status);
  // 可以在这里打开弹窗、跳转页面、调用 API 等
};

window.onAlarmNodeClick = function(nodeData, chartInstance, container) {
  // 弹出告警详情
  LubanUI.modal.open({
    title: '告警详情 - ' + nodeData.name,
    content: '<p>节点: ' + nodeData.name + '</p><p>状态: ' + (nodeData.status || 'unknown') + '</p>',
    width: 500
  });
};
\`\`\`
\`\`\`js
LubanUI.topology('netTopology', {
  nodes: [
    { id: 'nj-core', name: '南京核心', type: 'router', status: 'normal', onClick: 'onTopoNodeClick' },
    { id: 'jx-bs2', name: '百家湖基站', type: 'baseStation', status: 'alarm', alarming: true, onClick: 'onAlarmNodeClick' }
  ],
  links: [/* ... */]
});
\`\`\`

**注意**：如果节点同时配置了 \`onClick\` 和 \`children\`，\`onClick\` 优先执行，不会触发下钻。Agent 可在 onClick 回调中通过 \`LubanUI.topology()\` 重新渲染来实现自定义下钻逻辑。

#### 节点配置 nodes[]
| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识（必填） |
| name | string | 显示名称 |
| type | 'router' / 'switch' / 'server' / 'baseStation' / 'default' | 设备类型，不同图标 |
| status | 'normal' / 'warning' / 'alarm' / 'offline' | 状态颜色 |
| alarming | boolean | 是否闪烁告警（红色边框+脉冲） |
| fixed | boolean | 是否固定位置（核心节点建议固定） |
| x, y | number | 固定坐标（fixed=true 时生效） |
| category | number | 分组索引（配合 categories 使用） |
| tooltip | string | 悬浮提示 HTML |
| symbolSize | number | 图标大小（默认按类型自动适配） |
| **onClick** | string | **v2 新增**：点击回调函数名（window 上注册的函数），接收 (nodeData, chartInstance, containerEl) |
| **children** | object | **v2 新增**：子拓扑配置 { nodes: [...], links: [...], categories?: [...] }，点击展开下钻 |

#### 链路配置 links[]
| 字段 | 类型 | 说明 |
|------|------|------|
| source | string | 源节点 ID |
| target | string | 目标节点 ID |
| type | 'fiber' / 'wireless' / 'default' | 链路类型（实线/虚线） |
| status | 'normal' / 'warning' / 'alarm' | 链路颜色 |
| width | number | 线宽 |
| label | string | 链路标签 |
| color | string | 自定义颜色 |

#### 布局参数
| 参数 | 默认值 | 说明 |
|------|--------|------|
| repulsion | 300 | 节点斥力（越大越散开） |
| gravity | 0.1 | 重力（越大越向中心聚拢） |
| edgeLength | [150, 350] | 边长范围 |
| roam | true | 是否可缩放拖拽 |
| draggable | true | 节点是否可拖拽 |

#### 节点类型图标
- **router**: 路由器图标（地球/网络）
- **switch**: 交换机图标（交换矩阵）
- **server**: 服务器图标（机架）
- **baseStation**: 基站图标（信号塔）
- **default**: 圆形（不指定类型时使用）

#### 状态颜色
- **normal**: 绿色
- **warning**: 橙色
- **alarm**: 红色 + 脉冲闪烁（alarming: true）
- **offline**: 灰色

Agent 使用时建议：
1. 将核心节点（如省干、核心路由）设为 fixed: true
2. 为告警节点设置 alarming: true 实现闪烁效果
3. 光纤链路用 type:'fiber'（实线），微波链路用 type:'wireless'（虚线）
4. 复杂拓扑可配合 categories 实现分组着色
5. 多层级网络（省→市→区县）用 children 下钻，每层职责清晰
6. 告警节点配置 onClick 关联告警弹窗或详情跳转`,
} satisfies ComponentSpec;