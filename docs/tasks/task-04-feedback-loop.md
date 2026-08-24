# Task-04: 用户反馈闭环

## 涉及页面

| 页面 | 类型 | 说明 |
|------|------|------|
| `AgentChatPage.tsx` | 修改 | 消息底部新增反馈按钮 + 简化反馈表单 |
| `ConceptTracePanel.tsx` | 修改 | 移除独立反馈按钮，只展示概念信息 |
| `ConceptFeedbackPage.tsx` | 修改 | 详情弹窗新增 LLM 分析/预览变更/确认执行按钮 |

## 新增页面

无

## 具体开发工作

### 后端

| 文件 | 工作内容 |
|------|----------|
| `AgentService.java` | 响应中增加 `reasoning`、`sql`、`queryResult`、`messageId` 字段，`submitFeedback()` 自动携带上下文 |
| `ConceptFeedbackController.java` | 新增接口：<br/>  - `POST /api/v1/concept-feedback/{id}/analyze`：LLM 分析反馈<br/>  - `POST /api/v1/concept-feedback/{id}/preview-suggestion`：预览变更影响（dry-run）<br/>  - `POST /api/v1/concept-feedback/{id}/apply-suggestion`：执行本体变更 |
| `ConceptFeedbackService.java` | 新增方法：<br/>  1. `analyzeByLlm(feedbackId)`：构建 LLM 分析 prompt（含用户问题、反馈、概念映射、SQL、结果），调用 LLM 返回建议<br/>  2. `previewSuggestion(feedbackId, suggestionIndex)`：计算变更影响范围（rename_concept 列出所有引用实体、update_mapping 列出关联概念和 JOIN、add_relation 检查冲突）<br/>  3. `applySuggestion(feedbackId, suggestionIndex)`：执行变更（rename_concept → 更新 Concept.name + 触发 FAISS 索引重建；update_mapping → 更新 ConceptMapping；add_relation → 新增 ConceptRelation；update_join → 更新 ConceptJoinMapping），执行后 reload OntologyService |

### 安全约束

`applySuggestion` 前必须：
1. 先调用 `previewSuggestion` 获取变更影响范围
2. 超管在 UI 看到变更预览后确认
3. 不允许一键自动修改本体

### 前端

| 文件 | 工作内容 |
|------|----------|
| `AgentChatPage.tsx` | 1. 消息底部新增反馈按钮（👍/👎 或 文字按钮）<br/>2. 点击后弹出简化表单（只需填写问题描述，其余自动记录）<br/>3. `submitFeedback()` 自动携带 sessionId、messageId、conceptTrace、reasoning、sql、queryResult |
| `ConceptTracePanel.tsx` | 移除独立反馈按钮，只展示概念信息（概念名称、关联关系） |
| `ConceptFeedbackPage.tsx` | 详情弹窗新增操作按钮：<br/>  - [LLM 分析] → 展示分析结果和建议<br/>  - [预览变更] → 展示受影响实体列表<br/>  - [确认执行] → 执行本体变更<br/>  - [忽略] → 标记已忽略，附原因 |

### 状态流转

```
用户反馈 → PENDING → LLM分析中 → 待审核（有建议）
                                    ├─→ 已采纳 → 监控验证中 → 已解决
                                    └─→ 已忽略（附原因）
```

## 最终目标

用户问数后便捷反馈问题，超管在反馈页完成 LLM 分析 → 预览变更 → 确认执行的全流程，本体持续改进闭环。