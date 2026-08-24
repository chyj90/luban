# Task-08: Embedding 页面升级为语义层健康面板

## 涉及页面

| 页面 | 类型 | 说明 |
|------|------|------|
| `ConceptEmbeddingPage.tsx` | 修改 | 新增语义层健康概览卡片 + 陈旧概念检测 + 一键重建 |
| `ConceptEmbeddingPage.css` | 修改 | 新增健康卡片、告警提示样式 |

## 新增页面

无

## 具体开发工作

### 后端

| 文件 | 工作内容 |
|------|----------|
| 新建 `EmbeddingHealthService.java` | 新增方法：<br/>  1. `getHealthOverview()`：返回 FAISS 索引状态（索引概念数 / 总概念数 / 最后更新时间）<br/>  2. `getPendingCount()`：有映射但未 Embedding 的概念数<br/>  3. `getStaleCount()`：映射变更后 > 7 天未重新 Embedding 的概念数<br/>  4. `getHealthScore()`：基于上述指标的综合评分（0-100）<br/>  5. `getStaleConcepts()`：返回陈旧概念列表（概念名、上次 Embedding 时间、映射变更时间）<br/>  6. `markStaleConcepts(conceptIds)`：超管在反馈页执行变更后，标记受影响概念为"需要重新 Embedding"<br/>  7. `rebuildEmbedding(conceptIds)`：选中概念 → 触发异步 Embedding 重建任务 |
| 新建 `EmbeddingHealthController.java` | 新增接口：<br/>  - `GET /api/v1/embedding-health/overview`：健康概览<br/>  - `GET /api/v1/embedding-health/stale-concepts`：陈旧概念列表<br/>  - `POST /api/v1/embedding-health/mark-stale`：标记陈旧概念<br/>  - `POST /api/v1/embedding-health/rebuild`：一键重建 |
| `ConceptFeedbackService.java` | `applySuggestion()` 方法中调用 `EmbeddingHealthService.markStaleConcepts()` |
| `AgentMetricsService.java` | 匹配率下降告警时，自动检查 Embedding 状态，若陈旧则生成"待处理建议" |

### 前端

| 文件 | 工作内容 |
|------|----------|
| `ConceptEmbeddingPage.tsx` | **保留现有**：待处理/已处理任务管理<br/>**新增顶部健康概览卡片区**：<br/>  - FAISS 索引状态：索引概念数 / 总概念数 / 最后更新时间<br/>  - 待索引概念数：有映射但未 Embedding<br/>  - 陈旧概念数：映射变更后未重建<br/>  - 索引健康度评分：综合评分（绿/黄/红）<br/>**新增待处理建议区**：<br/>  - 当监控发现概念匹配率 < 60% 时，展示 "⚠ 概念 'Tutor' 近 7 天匹配率 52%，建议重新 Embedding"<br/>  - 超管在反馈页执行变更后，自动标记受影响概念<br/>**新增一键重建**：<br/>  - 选中陈旧概念 → 点击 [重建 Embedding] → 触发异步任务 |
| `ConceptEmbeddingPage.css` | 新增健康卡片网格布局、告警提示样式 |

### 与监控联动

```
监控面板：概念匹配率下降
  → Embedding 健康面板：自动检查 Embedding 是否过期
  → 若是 → 生成待处理建议 → 超管一键重建
  → 若否 → 问题不在 Embedding 层，需排查映射/概念定义
```

## 最终目标

ConceptEmbeddingPage 从纯运维工具升级为语义层健康面板，与监控和反馈联动，确保 FAISS 索引与概念映射保持同步。