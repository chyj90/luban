# 开发助手 LLM 后端代理改造需求文档

## 一、背景与现状

### 1.1 当前架构

开发助手（右下角 AI Agent 面板）的 LLM 调用链路如下：

```
浏览器（前端）                              LLM 服务商
┌──────────────────────┐                ┌──────────────┐
│ AgentPanel           │                │  DeepSeek    │
│   └─ ChatRouter      │   HTTP POST    │  OpenAI      │
│       └─ AgentFactory │──────────────▶│  Anthropic   │
│           └─ agentLoop│  Authorization│  ...         │
│               └─ llmClient ──────────▶│              │
│                                       │              │
│  useLLMStore (localStorage)           └──────────────┘
│  vaultManager (IndexedDB, AES-GCM)
└──────────────────────┘
```

**关键问题：**
- 用户需在浏览器中手动填写 Base URL、API Key、Model
- API Key 虽然通过 IndexedDB + AES-GCM 加密存储，但在网络请求中以明文 `Authorization: Bearer sk-xxx` 发送
- 用户在浏览器开发者工具 Network 面板可直接看到 API Key
- 不同用户需各自配置，无法统一管理

### 1.2 现有后端 LLM 配置体系

后端已有一套完整的「系统配置 → 大模型配置」体系（`agent_config` 表），目前仅用于问数 Agent（NL2SQL Agent）：

| 组件 | 路径 | 说明 |
|------|------|------|
| 实体 | `backend/.../entity/AgentConfig.java` | 字段：id, name, modelEndpoint, modelName, secretKeyEnc（AES-256 加密）, isDefault, status |
| 仓库 | `backend/.../repository/AgentConfigRepository.java` | JPA Repository |
| 服务 | `backend/.../service/AgentConfigService.java` | CRUD + AES 加解密 + 连接测试 |
| 控制器 | `backend/.../controller/AgentConfigController.java` | REST API：`GET/POST/PUT/DELETE /api/v1/agent-configs` |
| 前端页面 | `frontend/src/pages/AgentConfigPage.tsx` | 系统配置菜单下的「大模型配置」管理页面 |

**API Key 保护机制：**
- 存储：`secretKeyEnc` 字段使用 AES-256-ECB 加密存储，密钥来自环境变量 `LUBAN_AGENT_AES_KEY`
- 使用：`AgentConfigService.decrypt(secretKeyEnc)` 解密后使用，不会暴露给前端

---

## 二、需求目标

### 2.1 核心目标

1. **统一 LLM 配置源**：开发助手不再需要用户在浏览器端配置 LLM，改为使用后端「系统配置 → 大模型配置」中标记为默认的配置
2. **API Key 保护**：LLM 调用不再从浏览器直连，改为通过后端 SSE 代理，API Key 永不出现在浏览器端
3. **零配置体验**：用户进入应用开发页后，开发助手直接可用，无需任何配置

### 2.2 非目标

- 不改变问数 Agent（NL2SQL Agent）现有的 LLM 调用方式
- 不改变「系统配置 → 大模型配置」管理页面的功能
- 不改变 AI Agent 的工具注册、智能体路由、Plan 管理等核心逻辑

---

## 三、架构设计

### 3.1 改造后架构

```
浏览器（前端）                   后端（Spring Boot）                LLM 服务商
┌──────────────────┐     ┌──────────────────────────┐     ┌──────────────┐
│ AgentPanel       │     │ AgentConfigController    │     │              │
│   └─ ChatRouter  │     │ AgentConfigService       │     │  DeepSeek    │
│       └─ ...     │     │   └─ getDefault()        │     │  OpenAI      │
│           └─     │     │   └─ decrypt(secretKey)  │     │  ...         │
│  llmClient ──────┼────▶│                          │────▶│              │
│  (改造后)        │ SSE │ DevelopmentAgentProxy    │ SSE │              │
│                  │     │   POST /api/v1/agent/    │     │              │
│  不再需要        │     │        dev/chat/stream   │     │              │
│  useLLMStore     │     │   └─ 从 agent_config     │     │              │
│  vaultManager    │     │      取默认配置          │     │              │
└──────────────────┘     │   └─ 解密 API Key        │     └──────────────┘
                         │   └─ 转发到 LLM API      │
                         │   └─ SSE 流式回传        │
                         └──────────────────────────┘
```

### 3.2 关键设计决策

| 决策点 | 方案 | 理由 |
|--------|------|------|
| 代理端点 | 新增 `POST /api/v1/agent/dev/chat/stream` | 与问数 Agent 的 `/api/v1/agent/chat/stream` 区分，职责清晰 |
| 配置来源 | 使用 `agent_config` 表中 `is_default=true` 的记录 | 复用现有体系，管理员统一配置 |
| 认证方式 | 复用现有 JWT 认证（`Authorization: Bearer <token>`） | 与现有接口一致 |
| 流式协议 | SSE（Server-Sent Events），事件格式与 OpenAI 兼容 | 前端已有 SSE 解析能力，改动最小 |
| 请求格式 | 与 OpenAI Chat Completions API 完全兼容的 JSON | 前端 `llmClient.ts` 改动最小 |

---

## 四、详细设计

### 4.1 后端新增接口

#### 4.1.1 开发助手流式代理

```
POST /api/v1/agent/dev/chat/stream
```

**请求头：**
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**请求体（与 OpenAI Chat Completions API 兼容）：**
```json
{
  "model": "deepseek-chat",
  "messages": [
    { "role": "system", "content": "你是开发助手..." },
    { "role": "user", "content": "帮我创建一个订单列表页面" }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "page:create",
        "description": "创建页面",
        "parameters": { "type": "object", "properties": { ... } }
      }
    }
  ],
  "tool_choice": "auto",
  "temperature": 0.3,
  "stream": true
}
```

**SSE 响应事件：**

| 事件类型 | 说明 | 数据格式 |
|----------|------|----------|
| `delta` | LLM 流式输出的文本片段 | `{"content": "好的", "reasoning_content": "..."}` |
| `tool_calls` | LLM 返回的工具调用（流式全部完成后一次性发送） | `[{"id": "call_xxx", "function": {"name": "page:create", "arguments": "{...}"}}]` |
| `done` | 流式结束 | `{"usage": {"prompt_tokens": 100, "completion_tokens": 50}}` |
| `error` | 错误 | `{"message": "错误描述"}` |

**说明：** 由于 SSE 协议本身不支持在流式传输过程中动态嵌入 tool_calls（OpenAI 流式格式中 tool_calls 是通过 delta 逐片累积的），而前端当前使用 XHR `onprogress` 解析 SSE，为简化实现，`tool_calls` 事件在流式内容全部完成后一次性发送，`delta` 事件仅承载文本内容。

#### 4.1.2 后端代理实现要点

**新建类：`DevelopmentAgentProxyService`**

```java
@Service
public class DevelopmentAgentProxyService {
    
    private final AgentConfigService agentConfigService;
    
    /**
     * 获取默认 LLM 配置，解密 API Key，转发请求到 LLM API，
     * 并通过回调将 SSE 事件逐块回传给 Controller
     */
    public void proxyStream(
        Map<String, Object> requestBody,
        Consumer<String> onDelta,        // 文本片段回调
        Consumer<String> onToolCalls,    // 工具调用回调
        Consumer<String> onDone,         // 完成回调
        Consumer<String> onError         // 错误回调
    );
}
```

**核心流程：**
1. 从 `agent_config` 表查询 `is_default=true` 的记录
2. 调用 `agentConfigService.decrypt()` 解密 API Key
3. 将请求体中的 `model` 替换为配置中的 `modelName`（如果用户未指定）
4. 使用 `java.net.http.HttpClient` 向 LLM API 发起流式 POST 请求
5. 解析 LLM 返回的 SSE 流，逐行转发：
   - `data: {"choices":[{"delta":{"content":"..."}}]}` → `onDelta` 回调
   - `data: [DONE]` → 汇总 tool_calls，触发 `onToolCalls` + `onDone` 回调
6. 异常时触发 `onError` 回调

**注意：** 后端代理不解析或修改 LLM 的 tool_calls 内容，原样透传。LLM 返回的 `reasoning_content` 也原样透传。

### 4.2 前端改动

#### 4.2.1 llmClient.ts 改造

**改动文件：** `frontend/src/agent/core/llmClient.ts`

**改动内容：**

1. 新增 `callLLMAPIStreamViaProxy` 函数，替代 `callLLMAPIStream`：

```typescript
export async function* callLLMAPIStreamViaProxy(
  options: Omit<LLMCallOptions, 'baseUrl' | 'apiKey'>
): AsyncGenerator<LLMStreamChunk> {
  // 使用 fetch + ReadableStream 或 XHR 调用 POST /api/v1/agent/dev/chat/stream
  // 将 messages, tools, temperature 等发送到后端
  // 监听 SSE 事件：delta, tool_calls, done, error
  // 解析为 LLMStreamChunk 格式 yield 出去
}
```

2. 保留 `callLLMAPIStream` 原函数不变（兼容性），但 AgentLoop 改为调用新函数

**关键变化：**
- 不再需要 `baseUrl` 和 `apiKey` 参数
- 请求目标从 `{baseUrl}/chat/completions` 变为 `/api/v1/agent/dev/chat/stream`
- 认证方式从 `Authorization: Bearer {apiKey}` 变为 `Authorization: Bearer {JWT token}`
- SSE 事件解析适配新的后端事件格式

#### 4.2.2 AgentLoop 改造

**改动文件：** `frontend/src/agent/core/agentLoop.ts`

**改动内容：**
- `AgentLoopOptions` 接口移除 `baseUrl` 和 `apiKey` 字段
- `runAgentLoop` 函数中调用 `callLLMAPIStream` 改为调用 `callLLMAPIStreamViaProxy`
- 移除 API Key 解析逻辑

#### 4.2.3 AgentFactory 改造

**改动文件：** `frontend/src/agent/core/AgentFactory.ts`

**改动内容：**
- `AgentFactoryOptions` 接口移除 `providerType` 和 `baseUrl` 字段
- `createAgent` 函数移除 `resolveApiKey` 调用
- 传递给 `runAgentLoop` 的参数移除 `baseUrl` 和 `apiKey`

#### 4.2.4 ChatRouter 改造

**改动文件：** `frontend/src/agent/core/chatRouter.ts`

**改动内容：**
- `RouterSessionOptions` 接口移除 `providerType` 和 `baseUrl` 字段
- `createExecutor` 中不再传递 `providerType` 和 `baseUrl`

#### 4.2.5 AgentPanel 改造

**改动文件：** `frontend/src/components/AgentPanel/index.tsx`

**改动内容：**

1. **移除「设置」Tab**：移除 `activeTab === 'settings'` 的渲染逻辑，移除 Tab 切换按钮中的「设置」选项
2. **移除 LLM 配置状态**：删除以下状态和依赖：
   - `testing`, `testResult`, `availableModels`, `savedProvider`
   - `useLLMStore` 的 `activeConfig`, `configs`, `setActiveConfig`, `llmActiveId`
   - `vaultManager` 的导入
   - `handleSaveConfig`, `handleClearConfig`, `handleTest` 函数
   - `PROVIDERS` 常量
3. **简化 `runAgent` 函数**：移除 API Key 检查和配置校验逻辑，直接构造 sessionOptions 并执行
4. **保留 `model` 字段**：在 `RouterSessionOptions` 中保留 `model` 字段，允许前端传递期望的模型名（可选），后端可覆盖

#### 4.2.6 useLLMStore 与 vaultManager

**策略：保留但不强制**

- `useLLMStore` 和 `vaultManager` 保留不动，因为可能有其他功能依赖（如测试连接等）
- 开发助手不再使用这两个模块
- 后续可评估是否完全移除

### 4.3 配置获取

#### 4.3.1 前端获取后端 LLM 配置

**新增 API：**（可选，用于前端展示当前使用的模型信息）

```
GET /api/v1/agent-configs/default
```

返回默认配置（不含 secretKey）：

```json
{
  "id": 1,
  "name": "DeepSeek 默认配置",
  "modelEndpoint": "https://api.deepseek.com/v1",
  "modelName": "deepseek-chat",
  "isDefault": true,
  "status": "ENABLED"
}
```

前端可在 AgentPanel 底部或 Tooltip 中展示当前使用的模型名称，提升用户体验。

---

## 五、数据流对比

### 5.1 改造前

```
用户输入 → AgentPanel.runAgent()
  → 检查 useLLMStore 是否有 API Key
  → ChatRouter.route() → AgentFactory.createAgent()
    → resolveApiKey() → vaultManager.getApiKey() → IndexedDB 读取
    → agentLoop.runAgentLoop({baseUrl, apiKey, model, ...})
      → llmClient.callLLMAPIStream({baseUrl, apiKey, ...})
        → XHR POST {baseUrl}/chat/completions
          Authorization: Bearer {apiKey}  ← API Key 暴露在浏览器
```

### 5.2 改造后

```
用户输入 → AgentPanel.runAgent()
  → ChatRouter.route() → AgentFactory.createAgent()
    → agentLoop.runAgentLoop({model, messages, tools, ...})
      → llmClient.callLLMAPIStreamViaProxy({model, messages, tools, ...})
        → XHR POST /api/v1/agent/dev/chat/stream
          Authorization: Bearer {JWT}    ← 不再包含 API Key
          ↓
        DevelopmentAgentProxyService
          → AgentConfigService.getDefault() → 数据库查询
          → AgentConfigService.decrypt() → 服务端解密 API Key
          → HttpClient POST {modelEndpoint}/chat/completions
            Authorization: Bearer {decryptedKey}  ← API Key 仅存在于服务端
          → 解析 SSE → 通过回调回传前端
```

---

## 六、安全考量

### 6.1 API Key 保护

| 维度 | 改造前 | 改造后 |
|------|--------|--------|
| 存储位置 | 浏览器 IndexedDB（AES-GCM 加密） | 服务端数据库（AES-256-ECB 加密） |
| 网络传输 | 浏览器 → LLM API（明文 Bearer Token） | 浏览器 → 后端（JWT），后端 → LLM API（明文 Bearer Token，仅服务端内部） |
| 可见性 | 浏览器 DevTools Network 面板可见 | 浏览器不可见，仅服务端日志可见 |
| 密钥管理 | 用户自行管理 | 管理员统一管理 |

### 6.2 接口安全

- 新增的 `/api/v1/agent/dev/chat/stream` 需要 JWT 认证
- 复用现有的 Spring Security 过滤器链
- 建议添加速率限制（Rate Limiting），防止滥用

### 6.3 日志安全

- 后端日志中不应打印完整的 API Key
- 日志中打印 API Key 时只显示前 4 位和后 4 位，中间用 `****` 替代

---

## 七、兼容性与回滚

### 7.1 兼容性

- 前端保留 `callLLMAPIStream` 原函数，新增 `callLLMAPIStreamViaProxy` 函数
- `useLLMStore` 和 `vaultManager` 保留不动
- 如需回滚，只需将 AgentFactory 中的调用切换回原函数

### 7.2 回滚方案

若代理出现问题，可通过以下步骤快速回滚：
1. 前端 `AgentFactory.ts` 中恢复 `providerType` 和 `baseUrl` 的传递
2. `agentLoop.ts` 中恢复使用 `callLLMAPIStream` 替代 `callLLMAPIStreamViaProxy`
3. `AgentPanel` 中恢复「设置」Tab

---

## 八、实施计划

### 8.1 阶段划分

| 阶段 | 内容 | 预估工时 |
|------|------|----------|
| Phase 1 | 后端新增 `DevelopmentAgentProxyService` 和 `/api/v1/agent/dev/chat/stream` 接口 | 1 天 |
| Phase 2 | 前端 `llmClient.ts` 新增 `callLLMAPIStreamViaProxy` 函数 | 0.5 天 |
| Phase 3 | 前端 `AgentLoop`、`AgentFactory`、`ChatRouter` 适配 | 0.5 天 |
| Phase 4 | 前端 `AgentPanel` 移除「设置」Tab，简化 UI | 0.5 天 |
| Phase 5 | 联调测试 + 异常处理 | 0.5 天 |

### 8.2 测试要点

- [ ] 后端代理正确获取默认 `agent_config` 配置
- [ ] 后端代理正确解密 API Key 并转发到 LLM API
- [ ] SSE 流式输出正常，文本逐字显示
- [ ] tool_calls 正确解析并回传前端
- [ ] reasoning_content 正确透传
- [ ] 异常情况处理：LLM API 不可达、超时、返回错误
- [ ] 并发请求隔离（多个用户同时使用）
- [ ] JWT 过期后的处理
- [ ] 前端 AgentPanel 移除设置 Tab 后，功能正常

---

## 九、附录

### 9.1 涉及文件清单

#### 后端新增
| 文件 | 说明 |
|------|------|
| `backend/.../service/DevelopmentAgentProxyService.java` | SSE 代理服务 |
| `backend/.../controller/AgentController.java` | 新增 `/dev/chat/stream` 端点 |

#### 前端改动
| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `frontend/src/agent/core/llmClient.ts` | 修改 | 新增 `callLLMAPIStreamViaProxy` |
| `frontend/src/agent/core/agentLoop.ts` | 修改 | 移除 baseUrl/apiKey，改用代理 |
| `frontend/src/agent/core/AgentFactory.ts` | 修改 | 移除 providerType/baseUrl，移除 resolveApiKey |
| `frontend/src/agent/core/chatRouter.ts` | 修改 | 移除 providerType/baseUrl |
| `frontend/src/components/AgentPanel/index.tsx` | 修改 | 移除设置 Tab，简化 LLM 配置逻辑 |
| `frontend/src/types/agent.ts` | 修改 | AgentLoopOptions 移除 baseUrl/apiKey |

#### 不动
| 文件 | 说明 |
|------|------|
| `frontend/src/stores/llmStore.ts` | 保留不动 |
| `frontend/src/agent/core/vaultManager.ts` | 保留不动 |
| `frontend/src/pages/AgentConfigPage.tsx` | 保留不动 |
| `backend/.../entity/AgentConfig.java` | 保留不动 |
| `backend/.../service/AgentConfigService.java` | 保留不动 |
| `backend/.../controller/AgentConfigController.java` | 保留不动 |

### 9.2 关键代码路径

```
前端调用链：
AgentPanel/index.tsx#runAgent()
  → chatRouter.ts#route()
    → AgentFactory.ts#createAgent()
      → agentLoop.ts#runAgentLoop()
        → llmClient.ts#callLLMAPIStreamViaProxy()  ← 新增，替代原 callLLMAPIStream

后端代理链：
AgentController.java#devChatStream()  ← 新增端点
  → DevelopmentAgentProxyService.java#proxyStream()  ← 新增服务
    → AgentConfigService.java#getDefault() + decrypt()
    → java.net.http.HttpClient → LLM API
```