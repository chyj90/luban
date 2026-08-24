# Task-05: 监控与可观测性

## 涉及页面

无（新增页面）

## 新增页面

| 页面 | 路径 | 说明 |
|------|------|------|
| `AgentMetricsPage.tsx` | 全新 | 监控面板，展示概念健康度、异常告警、聚合指标 |

## 具体开发工作

### 后端

| 文件 | 工作内容 |
|------|----------|
| 新建 `AgentQueryLog.java` | 监控数据实体，表名 `agent_query_log`，字段见文档 11.3 请求级指标 |
| 新建 `AgentQueryLogRepository.java` | JPA Repository，支持按 sessionId/messageId 查询、按概念聚合统计、按时间范围查询 |
| 新建 `AgentMetricsService.java` | 1. 聚合指标计算：概念匹配率、决策分布、SQL 成功率、平均 LLM 延迟、平均执行延迟、用户反馈率、反馈解决率、无权限拒绝率<br/>2. 告警检测：匹配率 < 60%、SQL 成功率 < 85%、LLM P95 延迟 > 5s、执行 P95 延迟 > 10s、反馈率 > 10%<br/>3. 异步写入：AgentService 每次请求结束时异步写入监控数据 |
| 新建 `AgentMetricsController.java` | 监控面板 API：<br/>  - `GET /api/v1/agent-metrics/overview`：总览指标（总请求、决策分布、SQL 成功率、平均延迟）<br/>  - `GET /api/v1/agent-metrics/concept-health`：概念健康度列表（匹配率、SQL 成功率、反馈数、趋势）<br/>  - `GET /api/v1/agent-metrics/recent-anomalies`：最近异常列表<br/>  - `GET /api/v1/agent-metrics/query-detail?messageId=xxx`：单条请求详情（关联反馈） |
| `AgentService.java` | 每次请求结束时异步写入 AgentQueryLog |

### 数据存储

```
热数据（7 天）：Redis Stream
  → 实时聚合指标，供监控面板展示
  → 7 天后自动过期

冷数据（90 天）：MySQL 表 agent_query_log
  → 长期趋势分析
  → 与 concept_feedback 表关联（session_id + message_id 联合键）
```

### 前端

| 文件 | 工作内容 |
|------|----------|
| 新建 `AgentMetricsPage.tsx` | 监控面板（见文档 11.5 节布局）：<br/>  - 顶部：4 个指标卡片（总请求、决策分布、SQL 成功率、平均延迟）<br/>  - 中部：概念健康度表格（概念名、匹配率、SQL 成功率、反馈数、趋势、操作）<br/>  - 底部：最近异常列表（异常类型、描述、时间）<br/>  - 复用现有 PageTopbar、Select 组件 |

## 最终目标

监控面板自动采集每次 Agent 调用的指标，展示概念健康度、异常告警，与概念反馈形成互补（监控发现趋势性问题，反馈提供根因）。