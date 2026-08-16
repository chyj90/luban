# Sprint 1：连接企业系统 + 工具注册表

> **状态：🔴 待审阅** | **周期：4 周** | **目标：鲁班能调用企业 HTTP API，将企业 API 注册为工具，暴露为 MCP 供企业 Agent 调用**
>
> Sprint 1 的核心是「连接企业系统」。鲁班的首要价值是调用企业 API 并将传统 API 转化为 MCP 工具，而非被企业 Agent 通过 MCP 调用。

---

## 零、现有基础（基线）

Sprint 1 不是从零开始，以下能力已存在，直接复用：

| 模块 | 实现 | 对 Sprint 1 的影响 |
|------|------|------|
| 鲁班 Agent | 3 个智能体，ReAct + Plan-Execute 双模式，浏览器端运行 | 只需新增内部工具调用 API，Agent 核心逻辑不变 |
| 可视化看板 | CodePage（HTML/CSS/JS）+ iframe 实时预览 | 无需改动 |
| 人审批流程 | 拖拽设计器 + ProcessEngine（JPA 状态机） | 无需改动 |
| 数据源管理 | Datasource CRUD，MySQL 直连 | SQL 工具的数据源直接复用 |
| 查询管理 | Query CRUD，SQL 编写与执行 | SQL 执行器复用 QueryService |
| 用户认证 | Spring Security + JWT | 内部 API 沿用 JWT，外部连接新建 API Key 认证 |

## 零、二、优先级说明

Sprint 1 的三个目标，按优先级排序：

| 优先级 | 目标 | 说明 |
|:--:|------|------|
| ⭐⭐⭐ | **鲁班调用企业 HTTP API** | HTTP 执行器，核心能力，鲁班连接企业系统的基石 |
| ⭐⭐⭐ | **工具注册表** | 将企业 API 注册为工具，统一管理 |
| ⭐⭐ | **将企业工具暴露为 MCP** | MCP 网关，让企业 Agent 能调用鲁班包装好的企业工具 |

---

## 一、Sprint 目标

**核心价值：鲁班能调用企业 API，并将其转化为 MCP 工具。**

让鲁班可以连接企业系统（HTTP API / SQL），在工具注册表中统一管理，并通过 MCP 网关暴露给企业 Agent。

**关键验收标准：**

| # | 场景 | 操作 | 预期结果 |
|---|------|------|---------|
| 1 | HTTP 调用企业 API | 在控制台测试调用 Mock MES 的"查询设备状态"API | 鲁班成功调用 HTTP API，返回设备状态 JSON |
| 2 | SQL 查询企业数据库 | 创建 SQL 工具关联现有 Query，测试调用 | 鲁班成功查询数据库，返回结果 |
| 3 | 工具注册 | 在控制台注册一个 HTTP 工具和一个 SQL 工具 | 工具列表可见，可测试调用 |
| 4 | MCP 暴露工具 | Claude Desktop 配置鲁班 MCP 地址 | 连接成功，Agent 能看到鲁班注册的企业工具 |
| 5 | 鲁班内置 Agent 调用工具 | 在鲁班 Web 界面输入"查设备状态" | 鲁班 Agent 通过内部 API 调用工具，返回结果 |

---

## 二、需求列表

### 2.1 HTTP 执行器（⭐ 最高优先级）

**优先级：P0**

鲁班调用企业 HTTP API 的核心能力。这是整个平台的基石——没有它，鲁班无法连接任何企业系统。

**功能点：**

| # | 功能 | 说明 |
|---|------|------|
| 1 | 请求构造 | 根据 ToolDefinition.config 构造 HTTP 请求 |
| 2 | URL 参数替换 | 将 `{device_id}` 替换为实际参数值 |
| 3 | 鉴权注入 | 支持 API Key（Header）、Bearer Token、Basic Auth |
| 4 | 超时控制 | 默认 10 秒，可在 config 中配置 |
| 5 | 重试机制 | 网络错误重试 3 次，间隔递增 |
| 6 | 响应解析 | 返回 JSON，支持提取字段映射为 ToolCallResult |
| 7 | 错误处理 | 网络错误、超时、HTTP 4xx/5xx 统一转为 ToolCallResult.error |

**技术实现：**

- 使用 Spring `RestTemplate` 或 `WebClient`
- 鉴权信息从 `ToolDefinition.config.auth` 和 `tool_group.default_config` 合并读取
- 支持 `{{group.xxx}}` 模板变量引用组级配置

---

### 2.2 SQL 执行器

**优先级：P0**

复用现有 Query 体系，让鲁班能通过工具调用数据库查询。

**与现有 Query 的关系：**

```
现有 Query 体系：
  Datasource → Query → 执行 SQL → 返回结果

SQL 执行器（新增）：
  创建工具时关联现有 Query 的 ID
  → 调用工具 → SQL 执行器 → QueryService.execute(queryId, params) → 返回结果
```

**功能点：**

| # | 功能 | 说明 |
|---|------|------|
| 1 | 关联 Query | 创建 SQL 工具时，选择已有的 Query |
| 2 | 参数替换 | 将传入的参数替换到 SQL 模板中（`${param}` → 实际值） |
| 3 | 只读校验 | 强制 `SELECT` 语句，拒绝 `INSERT/UPDATE/DELETE/DROP` |
| 4 | 行数限制 | 默认最多返回 1000 行，防止大查询 |
| 5 | 超时控制 | 默认 30 秒 |
| 6 | 结果映射 | 将数据库结果集转为 JSON 数组，注入 ToolCallResult |

**对现有代码的改动：**

- 不需要修改 Query 实体和 Service
- 在 `QueryService` 中增加一个公开方法 `executeQuery(queryId, params)`，返回结构化结果
- 如果现有 `QueryService` 没有此方法，新增即可

---

### 2.3 工具注册表

**优先级：P0**

统一管理所有工具（HTTP 类型、SQL 类型、后续 MCP 透传类型）。这里的「工具」本质是企业 API 的注册和描述。

**数据库表：**

```sql
CREATE TABLE tool_definition (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(128) NOT NULL UNIQUE,   -- 工具唯一名称
    description     VARCHAR(512) NOT NULL,           -- 工具描述，Agent 语义理解用
    tool_type       VARCHAR(20) NOT NULL,            -- HTTP / SQL / MCP_PASSTHROUGH
    status          VARCHAR(20) NOT NULL DEFAULT 'ENABLED',  -- ENABLED / DISABLED
    input_schema    JSON,                            -- JSON Schema 定义输入参数
    output_schema   JSON,                            -- 输出结构描述
    config          JSON NOT NULL,                   -- 类型特定配置
    group_id        BIGINT,                          -- 所属分组
    created_by      BIGINT,                          -- 创建者
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_tool_type (tool_type),
    INDEX idx_status (status),
    INDEX idx_group_id (group_id)
);

CREATE TABLE tool_group (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(128) NOT NULL,           -- 分组名称，如"MES系统"
    description     VARCHAR(256),
    default_config  JSON,                            -- 组级默认配置（Base URL、鉴权等）
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**ToolDefinition.config 格式：**

HTTP 工具：
```json
{
  "url": "http://mock-mes:8080/api/v1/device/{device_id}/status",
  "method": "GET",
  "headers": {"Content-Type": "application/json"},
  "auth": {"type": "API_KEY", "header": "X-API-Key", "value": "{{group.api_key}}"},
  "timeout": 10000,
  "retry": 3
}
```

SQL 工具：
```json
{
  "queryId": 42,
  "readOnly": true,
  "maxRows": 1000,
  "timeout": 30000
}
```

**REST API：**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/tools` | 工具列表（分页，支持按类型/分组/状态筛选） |
| GET | `/api/v1/tools/{id}` | 工具详情 |
| POST | `/api/v1/tools` | 创建工具 |
| PUT | `/api/v1/tools/{id}` | 更新工具 |
| DELETE | `/api/v1/tools/{id}` | 删除工具（软删除，status=DISABLED） |
| POST | `/api/v1/tools/{id}/test` | 测试调用工具（手动输入参数，返回结果） |
| GET | `/api/v1/tool-groups` | 分组列表 |
| POST | `/api/v1/tool-groups` | 创建分组 |

**控制台页面：**

- 工具列表页：表格展示所有工具，支持按类型/分组/状态筛选，支持搜索
- 工具创建/编辑表单：名称、描述、类型选择、参数 Schema 编辑器、配置编辑器
- 工具测试面板：输入参数 → 点击测试 → 显示返回结果（JSON 格式化）
- 分组管理页：创建/编辑/删除分组，设置组级默认配置

---

### 2.4 MCP 网关（⭐ 将企业工具暴露为 MCP）

**优先级：P1**

对外暴露 MCP Server，让企业 Agent 能通过 MCP 协议调用鲁班注册的企业工具。**这是「将传统 API 转化为 MCP 工具」的关键环节。**

**功能点：**

| # | 功能 | 说明 |
|---|------|------|
| 1 | `initialize` 握手 | 返回 serverInfo（名称、版本），协商能力 |
| 2 | `tools/list` 工具发现 | 返回当前 Agent 可用的工具列表（含名称、描述、参数 Schema） |
| 3 | `tools/call` 工具调用 | 接收工具名 + 参数，调用执行器，返回结果 |
| 4 | SSE 长连接 | 支持 `GET /mcp/sse` 建立 SSE 连接，返回 sessionId |
| 5 | 消息端点 | 支持 `POST /mcp/messages?sessionId=xxx` 接收 JSON-RPC 请求 |
| 6 | 会话管理 | 管理 sessionId → API Key 映射，支持超时断开 |

**技术约束：**

- 基于 Spring Boot 的 `SseEmitter` 实现，不引入第三方 MCP SDK
- JSON-RPC 消息模型自行实现（`JsonRpcRequest`、`JsonRpcResponse`）
- 会话超时默认 30 分钟，可配置

**代码结构：**

```
backend/src/main/java/com/luban/mcp/
├── McpServerConfig.java          # MCP Server 配置
├── transport/
│   ├── McpSseController.java     # SSE 端点 + 消息端点
│   └── McpSessionManager.java    # 会话管理
├── protocol/
│   ├── JsonRpcMessage.java       # JSON-RPC 消息模型
│   ├── JsonRpcRequest.java
│   ├── JsonRpcResponse.java
│   └── McpMethods.java           # initialize/tools.list/tools.call
├── handler/
│   ├── InitializeHandler.java    # 握手处理
│   ├── ToolsListHandler.java     # 工具发现（从 ToolDefinition 表读取）
│   └── ToolsCallHandler.java     # 工具调用（路由到对应 Executor）
├── auth/
│   └── McpApiKeyFilter.java      # API Key 认证过滤器
└── model/
    ├── ToolDefinition.java
    └── ToolCallResult.java
```

**API 端点：**

| 端点 | 方法 | 说明 |
|------|------|------|
| `/mcp/sse` | GET | 建立 SSE 连接，返回 sessionId |
| `/mcp/messages` | POST | 接收 JSON-RPC 请求，需 `?sessionId=xxx` |

---

### 2.5 API Key 认证

**优先级：P0**

为外部连接（MCP 网关 + 后续 A2A 端点）提供令牌认证，与现有 JWT 认证独立。

**为什么不能用 JWT：**

- JWT 需要登录态，Agent 是无状态的 API 调用
- JWT 有有效期，Agent 需要长期稳定的连接
- JWT 绑定用户，一个用户可能有多把 API Key（不同 Agent 不同权限）

**数据模型：**

```sql
CREATE TABLE api_key (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    key_hash        VARCHAR(64) NOT NULL UNIQUE,     -- SHA-256(原始 Key)
    key_prefix      VARCHAR(12) NOT NULL,            -- "lb_xxxxxxxx" 前 12 位，用于展示
    name            VARCHAR(128) NOT NULL,           -- 用途说明，如"Claude Desktop 专用"
    user_id         BIGINT,                          -- 绑定的用户
    status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE / DISABLED / REVOKED
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at      TIMESTAMP NULL,                  -- 可选过期时间
    last_used_at    TIMESTAMP NULL,                  -- 最后使用时间
    
    INDEX idx_status (status),
    INDEX idx_user_id (user_id)
);
```

**API Key 格式：**

```
lb_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
│    └─ 32 位随机字符串
└─ 前缀，便于识别
```

**认证流程：**

```
1. Agent 连接 /mcp/sse
2. 携带 Header: X-API-Key: lb_xxxxxxxx...
3. McpApiKeyFilter 拦截：
   a. 提取 X-API-Key
   b. SHA-256(原始 Key) → 与 key_hash 比对
   c. 检查 status == ACTIVE
   d. 检查 expires_at 未过期
   e. 通过 → 创建 sessionId → 绑定 ApiKey → 返回 sessionId
   f. 不通过 → 返回 401
4. 后续所有 /mcp/messages 请求：
   a. 从 sessionId 恢复 ApiKey
   b. 校验 session 未过期
   c. 处理 JSON-RPC 请求
```

**API Key 管理 API：**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/api-keys` | API Key 列表 |
| POST | `/api/v1/api-keys` | 创建 API Key（返回完整 Key，仅此一次） |
| PUT | `/api/v1/api-keys/{id}/disable` | 禁用 |
| PUT | `/api/v1/api-keys/{id}/enable` | 启用 |
| DELETE | `/api/v1/api-keys/{id}` | 删除（软删除，status=REVOKED） |

**控制台页面：**

- API Key 列表页：表格展示（名称、前缀、状态、创建时间、最后使用时间）
- 创建对话框：输入名称、可选过期时间 → 生成 Key → 展示完整 Key（仅此一次，提醒复制保存）
- 操作：禁用/启用/删除

---

### 2.6 鲁班 Agent 接入工具调用

**优先级：P1**

让鲁班内置 Agent 能通过内部 REST API 调用工具注册表中的工具，实现「人机对话控制台」的闭环。

**为什么需要这个：**

```
外部 Agent（Claude Desktop）→ MCP 协议 → 调工具
鲁班 Web 界面 Agent         → 浏览器运行 → 不能直接调 MCP 协议

需要一条内部路径：鲁班 Agent → 内部 REST API → 工具执行器 → 返回结果
```

**技术方案：**

```
浏览器端 Agent（ReAct/Plan-Execute）
  │
  │ 工具调用请求
  ▼
POST /api/v1/mcp/internal/tools/call
  │
  │ 后端接收（JWT 认证，与 API Key 认证不同）
  ▼
ToolsCallHandler（与 MCP 协议共用同一个 Handler）
  │
  ▼
Executor（HTTP/SQL，与 MCP 协议共用同一个执行器）
```

**功能点：**

| # | 功能 | 说明 |
|---|------|------|
| 1 | 内部工具调用 API | `POST /api/v1/mcp/internal/tools/call`，JWT 认证 |
| 2 | 内部工具列表 API | `GET /api/v1/mcp/internal/tools/list`，返回当前用户有权限的工具 |
| 3 | Agent 工具注册 | 将 MCP 工具注册为 Agent 可用的 Tool（前端 agentRegistry） |
| 4 | 工具发现同步 | 前端定期/按需拉取工具列表，更新 Agent 的可用工具池 |

**前端改动：**

- 在 `agentRegistry` 中新增 `mcp_tool_call` 工具类型
- 工具调用时，通过 `POST /api/v1/mcp/internal/tools/call` 转发到后端
- 不需要改动 Agent 核心推理逻辑（ReAct/Plan-Execute）

---

### 2.7 预置工具与 Mock MES

**优先级：P1**

为了演示和验证，预置 5 个工具。

**Mock MES（Docker 容器）：**

提供 3 个 HTTP API：

| 端点 | 方法 | 说明 |
|------|------|------|
| `GET /api/v1/device/{deviceId}/status` | GET | 查询设备状态 |
| `POST /api/v1/work-order` | POST | 创建维修工单 |
| `GET /api/v1/production/stats` | GET | 查询产量统计（参数：`?startDate=xxx&endDate=xxx`） |

Mock 数据使用固定种子，确保可重复验证。

**5 个预置工具：**

| # | 工具名称 | 类型 | 关联 |
|---|---------|------|------|
| 1 | `query_device_status` | HTTP | Mock MES：查询设备状态 |
| 2 | `create_work_order` | HTTP | Mock MES：创建维修工单 |
| 3 | `query_production_stats` | HTTP | Mock MES：查询产量统计 |
| 4 | `query_daily_output` | SQL | 现有 Query：查询日产量 |
| 5 | `query_device_list` | SQL | 现有 Query：查询设备列表 |

SQL 工具需要现有数据库中有对应的表和数据。如果没有，创建示例表和种子数据。

---

## 三、非功能需求

### 3.1 性能

| 指标 | 要求 |
|------|------|
| SSE 连接建立 | < 500ms |
| tools/list 响应 | < 200ms |
| HTTP 工具调用 | < 10s（含外部 API 调用） |
| SQL 工具调用 | < 30s |
| 并发 SSE 连接 | 支持 100 个同时连接 |

### 3.2 安全

| 要求 | 说明 |
|------|------|
| API Key 哈希存储 | 数据库只存 SHA-256 哈希，不存明文 |
| API Key 仅展示一次 | 创建后立即展示完整 Key，后续只能看到前缀 |
| Session 隔离 | 不同 session 的请求互不影响 |
| 输入校验 | 所有参数校验，防止 SQL 注入（使用参数化查询） |
| SQL 只读 | 强制执行 SELECT 语句，拒绝写操作 |

### 3.3 可观测性

| 要求 | 说明 |
|------|------|
| 连接日志 | 记录每次 SSE 连接建立（来源 IP、API Key 前缀、时间） |
| 调用日志 | 记录每次 tools/call（工具名、参数、耗时、结果） |
| 错误日志 | 记录所有异常，含完整堆栈 |

---

## 四、UI 设计

### 4.1 工具注册表控制台

#### 工具列表页

```
┌──────────────────────────────────────────────────────────────┐
│  工具管理                                          [+ 创建工具] │
│                                                              │
│  [🔍 搜索工具名称...]  [类型 ▼]  [分组 ▼]  [状态 ▼]          │
│                                                              │
│  ┌──────────┬──────────┬────────┬────────┬────────┬──────┐  │
│  │ 工具名称  │ 分组      │ 类型    │ 状态    │ 更新时间  │ 操作 │  │
│  ├──────────┼──────────┼────────┼────────┼────────┼──────┤  │
│  │ 查询设备  │ MES系统   │ HTTP   │ 启用    │ 07-15   │ 测试 │  │
│  │ 状态      │          │        │        │         │ 编辑 │  │
│  │           │          │        │        │         │ 禁用 │  │
│  ├──────────┼──────────┼────────┼────────┼────────┼──────┤  │
│  │ 维保任务  │ MES系统   │ HTTP   │ 启用    │ 07-15   │ ...  │  │
│  ├──────────┼──────────┼────────┼────────┼────────┼──────┤  │
│  │ 销售查询  │ 数据查询  │ SQL    │ 启用    │ 07-14   │ ...  │  │
│  └──────────┴──────────┴────────┴────────┴────────┴──────┘  │
│                                                              │
│  共 3 个工具                             [< 1 2 3 ... >]     │
└──────────────────────────────────────────────────────────────┘
```

**交互说明：**
- 搜索框：支持按工具名称模糊搜索，实时过滤
- 类型筛选：下拉选择 HTTP / SQL / MCP_PASSTHROUGH
- 分组筛选：下拉选择已有分组
- 状态筛选：启用 / 禁用
- 操作列：测试（打开测试面板）、编辑、启用/禁用切换
- 点击工具名称进入编辑页

#### 工具创建/编辑表单

```
┌──────────────────────────────────────────────────────────────┐
│  创建工具                                          [× 关闭]   │
│                                                              │
│  基本信息                                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 工具名称 *  [查询设备状态________________]              │  │
│  │ 工具描述 *  [根据设备编号查询设备运行状态和维保信息____]  │  │
│  │ 所属分组    [MES系统 ▼]  [新建分组]                     │  │
│  │ 工具类型    [● HTTP  ○ SQL  ○ MCP透传]                 │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  接口配置（HTTP 类型）                                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 请求方法    [GET ▼]                                     │  │
│  │ 请求 URL    [http://192.168.1.100:8080/api/device/___] │  │
│  │             路径参数 {device_id} 自动识别               │  │
│  │                                                        │  │
│  │ 请求头      [Content-Type] [application/json] [+ 添加]  │  │
│  │                                                        │  │
│  │ 鉴权方式    [● 无  ○ API Key  ○ Bearer  ○ Basic]      │  │
│  │             [Header 名称] [X-API-Key]                  │  │
│  │             [Key 值____] [🔒 使用分组默认配置]          │  │
│  │                                                        │  │
│  │ 超时设置    [10] 秒   重试次数 [3]                      │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  参数定义                                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 输入参数（JSON Schema）                                 │  │
│  │ ┌──────────────────────────────────────────────────┐   │  │
│  │ │ {                                               │   │  │
│  │ │   "device_id": { "type": "string",              │   │  │
│  │ │     "description": "设备编号" }                  │   │  │
│  │ │ }                                               │   │  │
│  │ └──────────────────────────────────────────────────┘   │  │
│  │                                        [从 URL 自动生成] │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│                                    [取消]  [测试调用]  [保存]  │
└──────────────────────────────────────────────────────────────┘
```

**交互说明：**
- 类型切换时，接口配置区域动态切换（HTTP 显示 URL 配置，SQL 显示 Query 选择）
- "从 URL 自动生成"按钮：解析 URL 中的 `{xxx}` 路径参数，自动生成 JSON Schema
- 鉴权方式的 Key 值支持 `{{group.xxx}}` 引用分组默认配置
- 保存前校验必填项（名称、描述、URL/Query）

#### 工具测试面板

```
┌──────────────────────────────────────────────────────────────┐
│  测试工具：查询设备状态                                       │
│                                                              │
│  输入参数                                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ device_id  [CNC-07________________]                    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│                            [▶ 发送请求]                       │
│                                                              │
│  请求详情                                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ GET http://192.168.1.100:8080/api/device/CNC-07/status │  │
│  │ Headers: X-API-Key: lb_xxxx, Content-Type: app/json    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  响应结果                                 耗时: 234ms         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ {                                                      │  │
│  │   "device_id": "CNC-07",                               │  │
│  │   "status": "运行中",                                   │  │
│  │   "last_maintenance": "2026-07-15"                     │  │
│  │ }                                                      │  │
│  └────────────────────────────────────────────────────────┘  │
│                                              [关闭]          │
└──────────────────────────────────────────────────────────────┘
```

**交互说明：**
- 从创建/编辑表单点击"测试调用"打开，从列表页点击"测试"也打开
- "发送请求"按钮：调用 `POST /api/v1/tools/{id}/test`，显示 Loading
- 请求详情折叠展示，默认展开
- 响应结果 JSON 格式化高亮，错误时红色标记

#### 分组管理页

```
┌──────────────────────────────────────────────────────────────┐
│  分组管理                                          [+ 创建分组] │
│                                                              │
│  ┌──────────────┬──────────────────────────┬────────────┐   │
│  │ 分组名称      │ 默认配置                  │ 工具数       │   │
│  ├──────────────┼──────────────────────────┼────────────┤   │
│  │ MES系统       │ Base URL: 192.168.1.100  │ 2          │   │
│  │              │ API Key: {{group.key}}    │            │   │
│  ├──────────────┼──────────────────────────┼────────────┤   │
│  │ 数据查询      │ —                        │ 1          │   │
│  └──────────────┴──────────────────────────┴────────────┘   │
│                                                              │
│  点击分组名称 → 编辑分组弹窗：                                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 编辑分组：MES系统                                       │  │
│  │                                                        │  │
│  │ 分组名称  [MES系统________________]                     │  │
│  │ 描述      [生产执行系统接口分组____]                     │  │
│  │                                                        │  │
│  │ 默认配置（JSON）                                        │  │
│  │ ┌──────────────────────────────────────────────────┐   │  │
│  │ │ {                                               │   │  │
│  │ │   "base_url": "http://192.168.1.100:8080",      │   │  │
│  │ │   "api_key": "lb_xxxxxxxxxxxx"                  │   │  │
│  │ │ }                                               │   │  │
│  │ └──────────────────────────────────────────────────┘   │  │
│  │                       [取消]  [保存]                    │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 API Key 管理页

```
┌──────────────────────────────────────────────────────────────┐
│  API Key 管理                                      [+ 创建 Key]│
│                                                              │
│  ⚠️ API Key 创建后仅展示一次，请妥善保管                       │
│                                                              │
│  ┌────────────┬──────────┬────────┬──────────┬────────────┐  │
│  │ 名称        │ Key 前缀   │ 状态    │ 创建时间    │ 最后使用    │  │
│  ├────────────┼──────────┼────────┼──────────┼────────────┤  │
│  │ Claude测试  │ lb_a1b2.. │ 启用    │ 07-15     │ 07-16     │  │
│  │            │          │        │          │           │  │
│  │ 飞书机器人  │ lb_c3d4.. │ 启用    │ 07-15     │ —         │  │
│  │            │          │        │          │           │  │
│  │ 旧Key       │ lb_e5f6.. │ 已禁用  │ 06-01     │ 07-01     │  │
│  └────────────┴──────────┴────────┴──────────┴────────────┘  │
│                                                              │
│  创建 Key 弹窗：                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 创建 API Key                                            │  │
│  │                                                        │  │
│  │ 名称 *    [Claude Desktop 专用________]                 │  │
│  │ 过期时间  [2027-07-15]  [📅]  (留空永不过期)            │  │
│  │                                                        │  │
│  │                           [取消]  [生成 Key]            │  │
│  │                                                        │  │
│  │ ── 生成成功后展示 ──                                    │  │
│  │ ┌──────────────────────────────────────────────────┐   │  │
│  │ │ ⚠️ 此 Key 仅展示一次，请立即复制保存              │   │  │
│  │ │                                                  │   │  │
│  │ │ lb_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0   │   │  │
│  │ │                                    [📋 复制]     │   │  │
│  │ └──────────────────────────────────────────────────┘   │  │
│  │                                              [关闭]     │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**交互说明：**
- 列表展示 Key 前缀（前 12 位），完整 Key 不可见
- 状态列：启用/禁用/已删除（软删除）
- 点击"创建 Key"→ 填写名称和过期时间 → 生成 → 展示完整 Key 一次 → 关闭后不再可见
- 操作：禁用（确认弹窗）、启用、删除（确认弹窗）

### 4.3 导航结构

Sprint 1 新增的导航入口：

```
鲁班 导航栏
├── 看板          （现有）
├── 流程          （现有）
├── 数据源        （现有）
├── 查询          （现有）
├── 🆕 工具管理    （新增）
│   ├── 工具列表
│   └── 分组管理
├── 🆕 API Key     （新增）
└── 设置          （现有）
```

---

## 五、数据库变更

### 新增表

| 表名 | 说明 |
|------|------|
| `tool_definition` | 工具定义 |
| `tool_group` | 工具分组 |
| `api_key` | API Key |

### 种子数据

- 1 个默认工具分组：`MES系统`
- 3 个 HTTP 工具（关联 Mock MES）
- 2 个 SQL 工具（关联现有 Query，需先创建 Query）

---

## 六、部署与交付

### Docker Compose 编排

```yaml
services:
  luban-backend:
    # 现有后端服务
  luban-frontend:
    # 现有前端服务
  mysql:
    # 现有数据库
  mock-mes:
    image: luban/mock-mes:latest
    ports:
      - "9090:8080"
```

### 验收材料

- [ ] Claude Desktop 接入指南（Markdown 文档）
- [ ] 端到端验证脚本（curl 脚本，模拟 Agent 完整流程）
- [ ] API 文档（Swagger/OpenAPI 自动生成）

---

## 七、研发排期

| 周 | 工作内容 | 人天 |
|----|---------|:--:|
| **Week 1** | MCP 协议层 + 工具注册表 | 5 |
| | MCP SSE 传输层（SseEmitter + Controller） | 2 |
| | JSON-RPC 消息模型 + 路由分发 | 1 |
| | initialize 握手 + tools/list + tools/call 骨架 | 1 |
| | ToolDefinition 实体 + CRUD API | 1 |
| **Week 2** | HTTP 执行器 + SQL 执行器 + 工具注册表控制台 | 5 |
| | HttpExecutor（RestTemplate + 鉴权注入 + 超时） | 1.5 |
| | SqlExecutor（复用 QueryService + 只读校验 + 行数限制） | 1.5 |
| | 工具注册表控制台页面（列表 + 创建表单 + 测试调用） | 2 |
| **Week 3** | 认证 + Agent 接入 + 预置工具 | 5 |
| | ApiKey 实体 + CRUD + McpApiKeyFilter | 1.5 |
| | 鲁班 Agent 接入 MCP 工具链（内部 API + Tool 注册） | 2 |
| | 预置 5 个工具 + Mock MES（3 HTTP + 2 SQL） | 1.5 |
| **Week 4** | 部署 + 验收 + 文档 | 5 |
| | Docker Compose + 一键安装脚本 | 1.5 |
| | Claude Desktop 接入指南 | 1 |
| | 端到端验证脚本 | 1 |
| | 验收文档 + Bug 修复 | 1.5 |

---

## 八、风险与应对

| 风险 | 影响 | 概率 | 应对 |
|------|------|:--:|------|
| SSE 长连接不稳定 | 高 | 中 | 实现心跳机制，超时自动重连 |
| SQL 执行器与 Query 体系集成困难 | 中 | 低 | QueryService 已有公开方法，确认后可复用 |
| Mock MES 数据太假，演示无效 | 中 | 低 | 使用真实场景数据（设备名称、工单内容），Mock 只是后端 |
| 前端 Agent 改造过大 | 中 | 中 | 只新增工具类型，不改造 Agent 核心逻辑 |

---

## 九、Sprint 1 完成后的状态

```
Sprint 1 完成后：
  ✅ MCP 网关已运行
  ✅ 工具注册表已就绪
  ✅ 5 个预置工具可调用
  ✅ 外部 Agent（Claude Desktop）可连接鲁班
  ✅ 鲁班 Web 内置 Agent 可调用 MCP 工具
  ✅ API Key 认证已生效

  企业 Agent 可以：
    → 连接鲁班 MCP 网关
    → 发现可用工具
    → 调用 HTTP 工具（查设备状态、创建工单）
    → 调用 SQL 工具（查产量、查设备列表）
    → 在鲁班 Web 界面通过 Agent 对话完成同样操作
```