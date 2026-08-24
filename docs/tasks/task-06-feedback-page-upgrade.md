# Task-06: 反馈页面升级为反馈工作台

## 涉及页面

| 页面 | 类型 | 说明 |
|------|------|------|
| `ConceptFeedbackPage.tsx` | 重写 | 从状态流转列表升级为反馈工作台 |
| `ConceptFeedbackPage.css` | 修改 | 新增左右分栏布局、工作台操作区样式 |

## 新增页面

无

## 具体开发工作

### 后端

| 文件 | 工作内容 |
|------|----------|
| `ConceptFeedbackController.java` | 新增接口（与 Task-04 共用）：<br/>  - `POST /api/v1/concept-feedback/{id}/analyze`：LLM 分析<br/>  - `POST /api/v1/concept-feedback/{id}/preview-suggestion`：预览变更<br/>  - `POST /api/v1/concept-feedback/{id}/apply-suggestion`：执行变更 |
| `ConceptFeedbackService.java` | 新增方法（与 Task-04 共用）：`analyzeByLlm()`、`previewSuggestion()`、`applySuggestion()` |
| `AgentMetricsController.java` | 提供概念健康度查询接口供反馈工作台右侧面板使用（复用于 Task-05） |

### 前端

| 文件 | 工作内容 |
|------|----------|
| `ConceptFeedbackPage.tsx` | **列表增强**：<br/>  - 新增列：反馈类型（概念错误/映射错误/SQL 错误/其他）<br/>  - 新增列：LLM 建议状态（待分析/有建议/已采纳/已忽略）<br/>  - 新增列：关联监控（该概念当前匹配率 + 趋势箭头 ↑↓→）<br/>  - 筛选增强：新增按反馈类型筛选、按概念名搜索<br/>**详情弹窗 → 升级为反馈工作台**：<br/>  - 左侧面板：反馈详情（原有内容 + SQL + 查询结果 + 概念追溯）<br/>  - 右侧面板：监控数据（该概念近 30 天匹配率趋势 + SQL 成功率）<br/>  - 底部操作区：[LLM 分析] [预览变更] [创建快照] [确认执行] [忽略]<br/>  - 变更历史：展示此反馈关联的变更记录<br/>**状态流转升级**：<br/>  - PENDING → LLM分析中 → 待审核（有建议）→ 已采纳/已忽略 → 监控验证中 → 已解决 |
| `ConceptFeedbackPage.css` | 新增左右分栏布局样式（`.cfb-workbench`、`.cfb-left-panel`、`.cfb-right-panel`、`.cfb-action-bar`） |

### 核心交互流程

```
超管打开反馈详情
  → 左侧：查看用户问题、匹配概念、SQL、查询结果
  → 右侧：查看该概念近 30 天匹配率趋势（判断个案 or 系统性问题）
  → 点击 [LLM 分析]
      → 调用 LLM 分析，返回建议（如"建议将 Tutor 概念重命名为 Teacher"）
  → 点击 [预览变更]
      → 展示受影响实体：3 个 ConceptRelation、2 个 ToolConcept、5 个 ConceptMapping
  → 点击 [创建快照]
      → 自动创建当前状态快照（安全兜底）
  → 点击 [确认执行]
      → 执行变更 + 触发 FAISS 重建 + 标记受影响概念 Embedding 过期
  → 监控验证
      → 变更后监控指标变化 → 确认修复有效
```

## 最终目标

ConceptFeedbackPage 成为超管的反馈管理中心，在一个页面内完成：查看反馈 → 监控数据辅助判断 → LLM 分析 → 预览变更 → 快照兜底 → 执行变更 → 监控验证，完整闭环。