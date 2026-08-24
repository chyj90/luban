# Task-01: Agent 核心改造

## 涉及页面

| 页面 | 类型 | 说明 |
|------|------|------|
| `AgentChatPage.tsx` | 修改 | 消息展示增加 conceptTrace、reasoning、sql 展示 |

## 新增页面

无

## 具体开发工作

### 后端

| 文件 | 工作内容 |
|------|----------|
| `AgentService.java` | 1. 新增 `nl2sql_executor` 节点注册到 LangGraph 图中<br/>2. 重写 `buildSystemPrompt()`：加入 API/SQL 决策规则（见文档 4.1）<br/>3. 新增 `buildUnifiedContextPrompt()`：将 API 工具列表 + 库表结构 + 概念关系 + JOIN 条件**统一**构建到一个 prompt 中<br/>4. 增强 `parseResponse()`：支持 LLM 响应中 `type=nl2sql` 且直接带 `sql` 字段（不再二次调用 LLM）<br/>5. 新增 `searchConcepts()`：调用 FaissService 进行概念向量检索<br/>6. 新增 `expandSemanticLayer()`：调用 OntologyService 进行 Jena 语义扩展（含深度控制 1-2-3 跳规则）<br/>7. 新增 `buildUnifiedContext()`：双路径工具检索（概念路径 + 工具向量路径）+ 表结构查询<br/>8. 新增 `executeNl2sql()`：校验 + 执行 SQL（带资源限制）<br/>9. 响应中增加 `reasoning`、`sql`、`queryResult`、`messageId` 字段 |

### 前端

| 文件 | 工作内容 |
|------|----------|
| `AgentChatPage.tsx` | 1. 消息气泡支持展示 `conceptTrace`（概念追溯面板）<br/>2. 消息气泡支持展示 `reasoning`（思维链展开/收起）<br/>3. NL2SQL 类型消息支持展示生成的 SQL 和查询结果<br/>4. 消息底部新增反馈入口按钮（简化表单，只需填写问题描述） |

## 最终目标

LLM 在一次调用中**同时看到** API 工具和库表结构，自主决策是调 API 还是拼 SQL，`nl2sql` 路径直接输出 SQL，不再二次调用 LLM 生成。用户问数后能看到用了哪些概念、推理过程、生成的 SQL 和查询结果。