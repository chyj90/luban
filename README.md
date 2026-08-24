<p align="center">
  <img src="doc/images/logo.svg" alt="Luban Logo" width="80" />
</p>
<h1 align="center">鲁班 Luban</h1>
<p align="center"><strong>企业 Agent 的操作系统 — 连接 · 问数 · 开发</strong></p>

---

> 📐 **产品定位**：鲁班是企业 AI 的操作系统，向下连接企业系统（HTTP/SQL/MCP），将传统 API 转化为 MCP 工具，向上通过 A2A 协议接受企业 Agent 委派。现有平台实现了三大核心能力中的「开发」模块，正在补齐「连接」和「问数」。
>
> 📋 **完整需求文档**：[鲁班-整体工作计划](doc/需求文档/鲁班-整体工作计划.md) | Sprint 详细设计：[Sprint 1](doc/需求文档/sprint/sprint-1-mcp-base.md) · [Sprint 2](doc/需求文档/sprint/sprint-2-batch-security.md) · [Sprint 3](doc/需求文档/sprint/sprint-3-ai-orchestration-inquire.md) · [Sprint 4](doc/需求文档/sprint/sprint-4-algorithm-plugin.md)
>
> 🚀 **项目状态：基线开发完成** — 已实现页面设计、流程引擎、多智能体协作、数据源管理等核心能力，正在进行 Sprint 1 建设。

---

## 截图

### 应用中心

统一管理所有应用，支持创建、切换和组织应用。

<p align="center">
  <img src="doc/images/应用中心.png" alt="应用中心" width="80%" />
</p>

### 开发助手

内置 AI Agent 对话面板，支持自然语言驱动开发：建表、配数据源、生成页面、设计流程，全程 AI 陪伴。

<p align="center">
  <img src="doc/images/开发助手.png" alt="开发助手" width="80%" />
</p>

### 页面设计

所见即所得的可视化页面构建器，支持 AI 生成 HTML/CSS/JS 页面，实时预览，支持自定义代码编辑。

<p align="center">
  <img src="doc/images/页面设计.png" alt="页面设计" width="80%" />
</p>

### 流程设计

拖拽式流程设计器，支持审批流程、条件分支、并行节点，内置 ProcessEngine 状态机驱动流程运转。

<p align="center">
  <img src="doc/images/流程设计.png" alt="流程设计" width="80%" />
</p>

### 数据连接

管理数据库连接和 API 数据源，支持 MySQL 直连查询，为 Agent 提供数据基础。

<p align="center">
  <img src="doc/images/数据连接.png" alt="数据连接" width="80%" />
</p>

### 我的工作

个人工作台，查看待办审批、流程实例、任务进度。

<p align="center">
  <img src="doc/images/我的工作.png" alt="我的工作" width="80%" />
</p>

---

## 简介

**鲁班（Luban）** 是企业 Agent 的操作系统，围绕三大核心能力构建：

| 能力 | 说明 | 状态 |
|------|------|:--:|
| 🔌 **连接** | MCP 网关、系统接入、身份认证、权限管控、安全防护 | 🚧 建设中 |
| 🔍 **问数** | NL2SQL 自然语言查询、归因分析（知识图谱 + LLM） | 📋 规划中 |
| 🛠️ **开发** | 页面设计、流程引擎、多智能体协作、数据源管理 | ✅ 已上线 |

### 为什么选择鲁班？

- 🔌 **连接一切业务系统** — 通过 MCP 协议，企业 Agent 可以像调用函数一样调用业务系统的 API 和数据库查询，零代码接入
- 🔍 **用自然语言查数据** — 不需要写 SQL，对着 Agent 说"昨天 3 号车间产量"就能得到结果，支持归因分析（"为什么下降了"）
- 🛠️ **所见即所得开发** — AI 驱动的低代码平台，从零到一：建表 → 配数据源 → AI 生成页面 → 发布上线
- 🤖 **AI Agent 全程陪伴** — 内置 AI Agent 对话面板，支持 ReAct 推理和 Plan-Execute 规划执行两种模式，多智能体协作
- 🔒 **隐私安全第一** — 浏览器端 Agent 的 API Key 加密存储（IndexedDB Vault），内部 Agent 调用走 JWT 认证，外部 Agent 调用走 API Key 认证
- 🏗️ **灵活可扩展** — 支持自定义 HTML/CSS/JS，不锁死模板，专业开发者也能深度定制

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 19 + TypeScript + Vite 8 |
| **状态管理** | Zustand（持久化 + 应用级隔离） |
| **代码编辑器** | Monaco Editor |
| **AI Agent** | 纯浏览器端运行（ReAct + Plan-Execute，多智能体协作） |
| **后端** | Java 21 + Spring Boot 3.3.2 |
| **ORM** | Spring Data JPA + Hibernate |
| **数据库** | MySQL 8.0 |
| **认证** | Spring Security + JWT + 模拟用户过滤器 |

---

## AI Agent 架构

鲁班支持两种 Agent 接入方式：

```
┌──────────────────────────────────────────────────────────────────┐
│  外部 Agent（Claude Desktop / 飞书机器人 / 企业自研）              │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Agent 推理 → 工具调用                                       │  │
│  │       │                                                     │  │
│  │       │  MCP 协议（JSON-RPC over SSE）                        │  │
│  │       ▼                                                     │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │              鲁班 MCP 网关（北向入口）                  │  │  │
│  │  │   · tools/list 发现工具 · tools/call 调用工具           │  │  │
│  │  │   · API Key 认证                                      │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  内部 Agent（鲁班 Web 界面）                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  浏览器                                                        │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────┐                    │  │
│  │  │ 思考推理 │→│ 工具调用  │→│ 观察反馈 │  ReAct/Plan-Execute │  │
│  │  └─────────┘  └──────────┘  └─────────┘                    │  │
│  │       │                                                     │  │
│  │       │  POST /api/v1/mcp/internal/tools/call（JWT 认证）     │  │
│  │       ▼                                                     │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │              鲁班 后端（工具执行器）                    │  │  │
│  │  │   · HTTP 执行器 · SQL 执行器 · 工具注册表               │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Agent 模式

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| **ReAct** | 思考→行动→观察 循环推理，边想边做 | 页面生成、样式调整、Bug 修复 |
| **Plan-Execute** | 先制定完整计划，再逐步执行 | 复杂任务、多步骤操作 |

### 多智能体协作架构

鲁班采用主从式多智能体架构，通过 **Skill Registry（技能注册表）** 解耦 Agent 与工具，实现跨 Agent 技能复用。

```
用户请求
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  ChatRouter（路由层）                                             │
│  职责：Mention 识别（@数据助手 → data-assistant），首次委派注入    │
│        子智能体系统提示词，记住历史对话用于后续委派                  │
│                                                                   │
│  ┌─ 委派 ─────────────────────────────────────────────────────┐  │
│  │                                                            │  │
│  │  ┌─────────────────────────┐  ┌─────────────────────────┐ │  │
│  │  │ 需求分析助手              │  │ 数据辅助智能体            │ │  │
│  │  │ (analysis-assistant)    │  │ (data-assistant)        │ │  │
│  │  │                         │  │                         │ │  │
│  │  │ 技能：                   │  │ 技能：                   │ │  │
│  │  │ plan:create             │  │ datasource:list         │ │  │
│  │  │ plan:update             │  │ datasource:test         │ │  │
│  │  │ plan:adjust             │  │ datasource:structure    │ │  │
│  │  │ plan:confirm            │  │ datasource:connect      │ │  │
│  │  │ plan:validate           │  │ query:list              │ │  │
│  │  │ plan:list_unfinished    │  │ query:create            │ │  │
│  │  │ plan:set_focus          │  │ query:update            │ │  │
│  │  │                         │  │ query:delete            │ │  │
│  │  │ 能力：                   │  │ query:run               │ │  │
│  │  │ 话题拆解                 │  │ query:get               │ │  │
│  │  │ UI 分析（ASCII 布局）     │  │                         │ │  │
│  │  │ 数据分析（业务视角）       │  │ 能力：                   │ │  │
│  │  │ Query 分析（输入/输出）    │  │ 连接数据源               │ │  │
│  │  │ 流程分析（表单/审批）      │  │ 创建/修改/删除查询        │ │  │
│  │  │ 冲突合并                 │  │ 执行 SQL 调试             │ │  │
│  │  │ 无数据库知识，纯业务分析   │  │ 查询表结构                │ │  │
│  │  └─────────────────────────┘  └─────────────────────────┘ │ │  │
│  │                                                            │ │  │
│  │  ┌─────────────────────────┐                               │ │  │
│  │  │ 流程设计助手              │                               │ │  │
│  │  │ (workflow-assistant)    │                               │ │  │
│  │  │                         │                               │ │  │
│  │  │ 技能：                   │                               │ │  │
│  │  │ workflow:design_form    │                               │ │  │
│  │  │ workflow:design         │                               │ │  │
│  │  │ workflow:bind           │                               │ │  │
│  │  │ workflow:search_members │                               │ │  │
│  │  │ workflow:search_roles   │                               │ │  │
│  │  │ workflow:search_        │                               │ │  │
│  │  │   departments           │                               │ │  │
│  │  │ workflow:list_instances │                               │ │  │
│  │  │ workflow:approve        │                               │ │  │
│  │  │ workflow:reject         │                               │ │  │
│  │  │ workflow:freeze         │                               │ │  │
│  │  │ workflow:unfreeze       │                               │ │  │
│  │  │ workflow:cancel         │                               │ │  │
│  │  │ workflow:lint           │                               │ │  │
│  │  │ workflow:copy           │                               │ │  │
│  │  │ workflow:preview        │                               │ │  │
│  │  │                         │                               │ │  │
│  │  │ 能力：表单设计、流程设计、  │                               │ │  │
│  │  │ 组织查询、审批管理、       │                               │ │  │
│  │  │ 流程运维、代码校验、       │                               │ │  │
│  │  │ 复制预览                 │                               │ │  │
│  │  └─────────────────────────┘                               │ │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

主智能体 (main-agent) 持有委派技能：
  delegate:analysis → 需求分析助手
  delegate:query → 数据辅助智能体
  delegate:workflow → 流程设计助手
```

#### 智能体总览

| ID | 名称 | 角色 | 技能数 | 委派方式 |
|----|------|------|:--:|------|
| `main-agent` | 主智能体 | 调度 + 开发 | 19 | — |
| `analysis-assistant` | 需求分析助手 | 业务分析 + 计划创建 | 7 | `delegate:analysis` |
| `data-assistant` | 数据辅助智能体 | 数据源管理 + 查询 CRUD | 10 | `delegate:query` |
| `workflow-assistant` | 流程设计助手 | 表单/流程/审批/组织/运维/校验 | 15 | `delegate:workflow` |

#### 工作流程

```
需求澄清 → 需求分析 → 创建计划 → 用户确认 → 执行计划 → 验证完成
   │          │           │          │          │
   │    delegate:         分析助手    主智能体    主智能体
   │    analysis       plan:create plan:confirm  逐个执行步骤
   │                   plan:update plan:update_item
   │          │                      │
   │    分析助手输出：               ├─ delegate:query → 数据辅助智能体
   │    · 话题拆解                   ├─ delegate:workflow → 流程设计助手
   │    · UI 布局（ASCII 框图）       ├─ code:create → 页面生成
   │    · 数据字段（业务语言）         └─ plan:validate → 验证
   │    · Query 设计（输入/输出）
   │    · 流程分析（表单/审批）
   │    · 冲突合并
```

### Skill Registry（技能注册表）

所有工具能力从 Agent 中解耦为独立 Skill，Agent 通过 Skill ID 引用技能，支持跨 Agent 复用。

```
Skill Registry
  ├─ page:create / page:delete / page:rename       → 页面管理
  ├─ code:create / code:get / code:update          → 代码生成
  ├─ plan:create / plan:update / plan:confirm / ...→ 计划管理
  ├─ datasource:list / test / structure / connect  → 数据源操作
  ├─ query:list / create / update / delete / run   → 查询操作
  ├─ workflow:design_form / design / bind / ...    → 流程设计
  ├─ delegate:analysis / query / workflow          → 智能体委派
  └─ observation:list_pages / record               → 状态观察
```

| 设计原则 | 说明 |
|---------|------|
| **Skill 定义"能做什么"** | 每个 Skill 有唯一 ID（`category:name`），包含完整的参数定义和执行逻辑 |
| **Agent 定义"谁来做"** | Agent 通过 `allowedSkills` 数组声明可用技能，不再硬编码工具 |
| **跨 Agent 复用** | 同一 Skill 可被多个 Agent 引用，如 `plan:create` 同时被 main-agent 和 analysis-assistant 使用 |
| **动态解析** | `resolveAgentTools()` 在运行时从 Skill Registry 解析 Agent 的工具列表 |

### 智能体记忆隔离

为避免子智能体重复执行初始化操作，所有子智能体支持上下文记忆：

| 隔离维度 | 机制 | 说明 |
|---------|------|------|
| 应用间隔离 | `Map<appId, Map<agentId, Message[]>>` | 切换应用后记忆自动清除 |
| 智能体间隔离 | `agentId` 作为 key | data-assistant 和 workflow-assistant 记忆互不干扰 |
| 持久化存储 | localStorage（按 appId 隔离） | 主智能体对话历史刷新不丢失 |

- 每次委派子智能体时，传入 `initialMessages`（上次对话历史）
- 子智能体完成工作后，`getMessages()` 存入缓存
- 下次再委派同一子智能体时，它能看到之前的上下文，避免重复 `list_datasources` 等初始化操作

### 隐私与安全

- **API Key Vault 加密存储** — 大模型 API Key 使用 IndexedDB 加密存储（`vaultManager`），服务端永远无法获取
- **对话数据应用隔离** — chat 记录按 `appId` 隔离，存储在 localStorage，切换应用自动切换上下文
- **直连大模型** — 请求从浏览器直接发送到大模型 API，不经服务端中转，无中间人风险
- **支持多 Provider** — 可配置 OpenAI、Anthropic、Google Gemini、DeepSeek 或任意兼容 OpenAI API 格式的端点

### 配置大模型

启动前端后，在应用编辑页右上角点击 ⚙️ 设置图标，填入你的大模型配置：

| 配置项 | 说明 | 示例 |
|--------|------|------|
| 提供商 | 大模型服务商 | DeepSeek / OpenAI / Anthropic / Google Gemini / 自定义 |
| API 地址 | 兼容 OpenAI 格式的 API 端点 | `https://api.deepseek.com/v1` |
| API Key | 你的大模型 API Key | `sk-xxxxxxxx` |
| 模型名称 | 模型 ID | `deepseek-chat` |

> 配置使用 IndexedDB 加密存储（Vault），服务端完全不知情。

---

## ROADMAP

> 详细需求文档：[鲁班-整体工作计划](doc/需求文档/鲁班-整体工作计划.md)

### 能力矩阵

| 能力 | 基线（已完成） | S1 | S2 | S3 | S4 |
|------|:--:|------|------|------|------|
| 🔌 **连接** | — | 工具注册 + MCP 网关 | 批量导入 + 安全加固 | — | — |
| 🧠 **问数** | — | — | — | NL2SQL + 归因分析 | — |
| 🛠️ **开发** | 页面 + 流程 + Agent | 工具注册表 | — | AI 生成流程 + API 编排 | 算法插件 |
| 🤝 **协同** | — | — | — | — | A2A 委派 |

### 基线（已实现）

| 能力 | 子项 |
|------|------|
| 🛠️ 开发-页面 | 可视化看板（CodePage + iframe 实时预览 + Monaco Editor） |
| 🛠️ 开发-流程 | 审批流程引擎（拖拽设计器 + ProcessEngine 状态机 + 版本管理 + 测试模式） |
| 🛠️ 开发-Agent | 4 智能体协作（主智能体 + 分析/数据/流程助手，ReAct + Plan-Execute，Skill Registry 解耦） |
| 🛠️ 开发-数据 | 数据源管理 + 查询管理（MySQL 直连 + 动态 SQL 模板 + 参数化查询） |
| 🛠️ 开发-表单 | 表单设计器（字段配置 + 代码编辑 + 表单预览 + 表单发布） |

### 增量里程碑

| 能力 | 里程碑 | Sprint | 标志性事件 |
|------|------|:--:|------|
| 🔌 连接 | 工具注册 | S1 W2 | HTTP 执行器调用企业 API，工具注册表 CRUD 上线 |
| 🔌 连接 | MCP 暴露 | S1 W4 | MCP 网关上线，Claude Desktop 能调用鲁班包装的企业工具 |
| 🔒 连接 | 批量导入 | S2 W2 | OpenAPI 一键导入，100+ 接口 5 分钟生成工具 |
| 🔒 连接 | 安全加固 | S2 W3 | RBAC 权限 + HMAC 签名 + SSO 单点登录 |
| 🧠 问数 | NL2SQL 查询 | S3 W2 | 自然语言提问，自动生成 SQL 查询数据库 |
| 🛠️ AI 开发 | 智能生成流程 | S3 W2 | AI 根据自然语言描述自动生成 DAG 工具链 |
| 🧠 问数 | 归因分析 | S3 W3 | 多维度交叉归因，"为什么 X 下降了" |
| 🛠️ AI 开发 | API 编排 | S3 W3 | DAG 引擎自动串联 MCP 工具，无需人工编排 |
| 🏗️ 开发 | 算法插件 | S4 W1 | 外部算法注册 → 数据供给 → 结果回写 |
| 🤝 协同 | A2A 委派 | S4 W2 | 企业 Agent 通过 A2A 委派任务给鲁班 Agent |

---

## 项目结构

```
luban/
├── backend/                        # Spring Boot 后端
│   ├── src/main/java/com/luban/
│   │   ├── config/                 # 安全配置、CORS、拦截器
│   │   ├── controller/             # 基础 REST API 控制器
│   │   │   ├── ApplicationController.java
│   │   │   ├── AuthController.java
│   │   │   ├── DatasourceController.java
│   │   │   ├── JsFunctionController.java
│   │   │   ├── PageController.java
│   │   │   └── QueryController.java
│   │   ├── dto/                    # 请求/响应 DTO
│   │   ├── entity/                 # JPA 实体（Application/Page/CodePage/Datasource/Query/User/...）
│   │   ├── repository/             # 数据访问层
│   │   ├── security/               # JWT 认证 + 模拟用户过滤器
│   │   │   ├── JwtAuthFilter.java
│   │   │   ├── JwtTokenProvider.java
│   │   │   └── ImpersonationFilter.java
│   │   ├── service/                # 业务逻辑层（含动态 SQL 模板引擎）
│   │   ├── util/                   # AgentLogger 调试日志
│   │   └── workflow/               # 流程引擎模块
│   │       ├── config/             # 数据初始化 + 测试数据服务 + 自动配置
│   │       ├── controller/         # 流程 API（表单/流程/实例/任务/成员/部门/角色/管理/校验/Excel/绑定/同步）
│   │       ├── entity/             # 流程实体（FormDefinition/WorkflowDefinition/WorkflowInstance/WorkflowTask/WorkflowHistory/Member/Department/Role/...）
│   │       ├── repository/         # 流程数据访问层
│   │       └── service/            # 流程引擎（ProcessEngine 状态机）+ 表单/绑定/校验/Excel 导入服务
│   └── src/main/resources/
│       ├── application.yml         # 应用配置
│       └── db/migration/           # Flyway 迁移脚本
├── frontend/                       # React + Vite 前端
│   └── src/
│       ├── agent/                  # AI Agent 核心（纯浏览器端）
│       │   ├── core/               # Agent 引擎
│       │   │   ├── AgentFactory.ts  # Agent 工厂（创建 + 执行）
│       │   │   ├── agentLoop.ts     # ReAct 循环（推理→行动→观察）
│       │   │   ├── chatRouter.ts    # 多智能体路由（Mention 识别 + 委派 + 记忆管理）
│       │   │   ├── llmClient.ts     # LLM API 调用（流式 + Function Calling）
│       │   │   ├── memoryManager.ts # IndexedDB 对话持久化
│       │   │   ├── planContext.ts   # 计划上下文管理
│       │   │   ├── credentialAdapter.ts  # 凭证适配
│       │   │   ├── eventAdapter.ts  # 事件适配
│       │   │   ├── memoryAdapter.ts # 记忆适配
│       │   │   ├── toolAdapter.ts   # 工具适配
│       │   │   └── vaultManager.ts  # API Key 加密存储（IndexedDB Vault）
│       │   ├── llm/                # LLM 流式解析
│       │   │   └── streamParser.ts
│       │   ├── prompts/            # 系统提示词
│       │   │   ├── systemPrompt.ts  # 主智能体提示词
│       │   │   ├── dbaPrompt.ts     # 数据辅助智能体提示词
│       │   │   ├── workflowAgent.ts # 流程设计助手提示词
│       │   │   ├── analysisAgent.ts # 需求分析助手提示词
│       │   │   ├── designSpec.ts    # 设计规范
│       │   │   └── behaviorRules.ts # 行为准则
│       │   ├── registry/           # 注册表
│       │   │   ├── agentRegistry.ts # Agent 定义（ID/名称/角色/技能列表）
│       │   │   ├── skillRegistry.ts # Skill 注册表（解耦 Agent 与工具）
│       │   │   ├── agentMemory.ts   # 智能体记忆缓存（应用级隔离）
│       │   │   ├── skills/          # 技能实现
│       │   │   │   ├── pageSkills.ts       # 页面管理技能
│       │   │   │   ├── codeSkills.ts       # 代码生成技能
│       │   │   │   ├── planSkills.ts       # 计划管理技能
│       │   │   │   ├── datasourceSkills.ts # 数据源操作技能
│       │   │   │   ├── querySkills.ts      # 查询操作技能
│       │   │   │   ├── workflowSkills.ts   # 流程设计技能
│       │   │   │   ├── delegateSkills.ts   # 智能体委派技能
│       │   │   │   ├── observationSkills.ts# 状态观察技能
│       │   │   │   ├── promptFragments.ts  # 提示词片段（需求分析规范 + 强制规则）
│       │   │   │   └── index.ts            # 统一注册入口
│       │   │   └── test/
│       │   │       └── testCases.ts        # 测试用例
│       │   └── config.ts           # Agent 配置（迭代次数/温度/预算等）
│       ├── api/                    # API 请求封装
│       │   ├── auth.ts             # 认证（登录/注册/退出）
│       │   ├── application.ts      # 应用管理
│       │   ├── page.ts             # 页面管理
│       │   ├── datasource.ts       # 数据源管理
│       │   ├── query.ts            # 查询管理
│       │   ├── jsFunction.ts       # JS 函数
│       │   ├── workflow.ts         # 流程 API（表单/流程/实例/任务/成员/部门/角色/校验/管理/绑定）
│       │   ├── client.ts           # Axios 实例（拦截器 + JWT）
│       │   └── index.ts            # 统一导出
│       ├── pages/                  # 页面组件
│       │   ├── Login/              # 登录/注册
│       │   ├── AppLayout/          # 应用布局（侧边栏 + 全局 Header）
│       │   ├── AppList/            # 应用列表
│       │   ├── AppHub/             # 应用中心
│       │   ├── AppEntry/           # 应用入口（用户视角）
│       │   ├── AppEditor/          # 应用编辑器（开发视角）
│       │   └── workflow/           # 流程模块页面
│       │       ├── WorkflowDesigner.tsx   # 拖拽式流程设计器
│       │       ├── WorkflowViewer.tsx     # 流程查看器
│       │       ├── ProcessList.tsx        # 流程列表
│       │       ├── FormList.tsx           # 表单列表
│       │       ├── FormDesigner.tsx       # 表单设计器
│       │       ├── FormPreview.tsx        # 表单预览
│       │       ├── FormRenderer.tsx       # 表单渲染器
│       │       ├── FormDataView.tsx       # 表单数据查看
│       │       ├── MyWorkflow.tsx         # 我的工作台
│       │       ├── MyTasks.tsx            # 我的待办
│       │       ├── MyInstances.tsx        # 我的流程实例
│       │       ├── InstanceDetail.tsx     # 实例详情
│       │       ├── ProcessTimeline.tsx    # 流程时间线
│       │       ├── Organization.tsx       # 组织管理
│       │       ├── OrganizationTree.tsx   # 组织树
│       │       ├── MemberPicker.tsx       # 成员选择器
│       │       ├── ApproverSelector.tsx   # 审批人选择器
│       │       ├── ConditionEditor.tsx    # 条件编辑器
│       │       ├── FieldPermissionGrid.tsx# 字段权限网格
│       │       └── Select.tsx             # 通用选择器
│       ├── components/             # 公共组件
│       │   ├── AgentPanel/          # AI Agent 对话面板
│       │   ├── EditorSidebar/       # 编辑器侧边栏（页面/查询/流程/数据源 Tab）
│       │   ├── QueryPanel/          # 查询面板（列表 + CRUD）
│       │   ├── QueryEditor/         # 查询编辑器（SQL 模板编辑）
│       │   ├── DatasourcePanel/     # 数据源面板
│       │   ├── InteliEditor/        # Monaco 代码编辑器
│       │   ├── InteliPreview/       # iframe 实时预览
│       │   ├── ResizablePanel/      # 可调整面板
│       │   ├── DevToolbar/          # 开发工具栏（模拟用户 + 流程测试）
│       │   ├── GlobalHeader/        # 全局 Header
│       │   ├── GlobalLoading/       # 全局加载
│       │   ├── ConfirmDialog/       # 确认对话框
│       │   └── Toast/               # Toast 通知
│       ├── stores/                  # Zustand 状态管理
│       │   ├── authStore.ts         # 认证状态（JWT + 用户信息）
│       │   ├── applicationStore.ts  # 应用列表状态
│       │   ├── pageStore.ts         # 当前页面状态
│       │   ├── agentStore.ts        # Agent 对话状态（应用级隔离 + 持久化）
│       │   ├── llmStore.ts          # LLM 配置状态（Provider/API Key/Model + Vault 加密）
│       │   ├── toastStore.ts        # Toast 通知状态
│       │   ├── confirmStore.ts      # 确认对话框状态
│       │   ├── impersonationStore.ts# 模拟用户状态
│       │   └── loadingStore.ts      # 全局加载状态
│       ├── types/                   # TypeScript 类型定义
│       │   ├── agent.ts             # Agent 类型
│       │   ├── workflow.ts          # 流程类型（Form/Workflow/Instance/Task/Member/Department/Role/...）
│       │   ├── user.ts              # 用户类型
│       │   ├── application.ts       # 应用类型
│       │   ├── page.ts              # 页面类型
│       │   ├── query.ts             # 查询类型
│       │   ├── datasource.ts        # 数据源类型
│       │   └── api.ts               # API 通用类型
│       ├── hooks/                   # 自定义 Hooks
│       │   ├── useAutoSave.ts       # 自动保存
│       │   ├── usePreviewSync.ts    # 预览同步
│       │   └── useQueryBridge.ts    # 查询桥接
│       ├── router/                  # 路由配置
│       │   ├── index.tsx            # 路由定义
│       │   └── guards.tsx           # 路由守卫（登录/认证）
│       ├── utils/
│       │   └── impersonation.ts     # 模拟用户工具
│       ├── debugTrace.ts            # 调试日志（F12 调用 copy_bug_trace() 导出）
│       ├── App.tsx                  # 根组件
│       ├── main.tsx                 # 入口
│       └── index.css                # 全局样式
├── docker-compose.yml               # MySQL 容器
└── doc/                             # 需求文档 + 迁移脚本
```

---

## 核心数据模型

### User 与 Member 的关系（重要）

```
members（超集：组织通讯录）
  │
  ├── 有 userId → 正式用户 ──→ users（子集：登录账号）
  │     └── 可登录、可被分配任务、可审批
  │
  └── 无 userId → 测试用户
        └── 仅用于流程模拟，不可登录
```

| 表 | 用途 | 类比 |
|----|------|------|
| **users** | 登录认证（邮箱、密码、JWT） | 门禁卡 |
| **members** | 组织信息（姓名、部门、职位、工号、上级） | 公司花名册 |

**关键规则：**

- 用户注册时自动同步创建 Member（`AuthService.register()`）
- Member 是超集：包含正式用户（有 userId）和测试用户（userId = NULL）
- 每个 User 对应唯一一个 Member（`Member.userId`），一对一
- 流程设计器选人从 `members` 表读，DevToolbar 模拟用户也从 `members` 表读
- 测试用户不可登录，仅通过 DevToolbar 模拟使用

### 模拟用户（Impersonation）

DevToolbar 开发工具栏支持模拟任意用户身份，用于测试流程审批：

- 后端 `ImpersonationFilter` 过滤器拦截请求，检测 `X-Impersonate-User-Id` 请求头
- 前端 `impersonationStore` 管理模拟状态，axios 拦截器自动注入请求头
- 模拟用户信息存储在 `localStorage`（`impersonate_user_id`），刷新不丢失
- 切换用户后自动 `bump` 版本号，触发全局数据刷新

---

## 本体权限体系：角色 → 域 → 行业

### 核心链路

```
┌──────────┐    ┌───────────────────────┐    ┌──────────────┐    ┌──────────────┐
│  用户     │    │ role_concept_permission│    │ ontology_group│    │   industry   │
│  user_id │───→│ role_id              │───→│ group_id      │───→│ industry_id  │
│          │    │ group_id             │    │ industry_id   │    │ name         │
│  role_id │    └───────────────────────┘    └──────────────┘    └──────────────┘
└──────────┘                                                          │
                                                            ┌───────────┘
                                                            ↓
                                                  ┌──────────────────────┐
                                                  │  industry_relation    │
                                                  │  relation_type        │
                                                  │  is_transitive ←── 控制 Jena 推理
                                                  │  is_symmetric  ←── 控制 Jena 推理
                                                  └──────────────────────┘
```

### 两层含义

| 层级 | 用途 | 触发时机 |
|------|------|:--:|
| **角色 → 域** | 问数权限：用户能否查该域的概念 | 每次 NL2SQL 请求 |
| **域 → 行业** | 推理规则：该行业的关系类型是否具备传递性/对称性 | Jena 模型构建时 |

### 问数权限校验（自动）

```
用户登录 → 查 user_role 表获取角色列表
         → 查 role_concept_permission 表获取授权的域列表
         → 用户问"本月产量"
         → Agent 识别概念「产量」→ 所属域「生产域」
         → 权限校验：用户角色是否包含「生产域」的授权？
         → 是 → 生成 SQL 执行
         → 否 → 拒绝，提示"您没有该域的查询权限"
```

**关键代码**：[RoleConceptPermissionService.java](file:///Users/chengyajie/Project/luban/backend/src/main/java/com/luban/service/RoleConceptPermissionService.java)

```java
// checkQueryPermission(userId, conceptId)
Concept concept = conceptRepository.findById(conceptId).orElseThrow(...);
Long groupId = concept.getGroupId();                          // 概念 → 域
List<Long> roleIds = roleUserRepository.findByUserId(userId)  // 用户 → 角色
        .stream().map(ru -> ru.getRoleId()).toList();
return permissionRepository.existsByRoleIdInAndGroupId(       // 角色 → 域权限
        roleIds, groupId);
```

### Jena 推理规则（自动）

```
问数时 → expandByConcepts() 展开概念
       → 对每个概念，resolveIndustryId(groupId)
       → 域.industryId → 行业
       → 找到该行业对应的 Jena OntModel
       → 该 Model 中的 Property 已按 industry_relation 表的
         isTransitive / isSymmetric 配置了推理规则
       → 推理引擎自动推导子概念和传递关系
```

**关键代码**：[OntologyService.java](file:///Users/chengyajie/Project/luban/backend/src/main/java/com/luban/service/OntologyService.java)

```java
// buildModels() 时，每个行业独立构建 Jena Model
Map<Long, Set<String>> industryTransitiveTypes = ...;  // 从 industry_relation 表读取
Map<Long, Set<String>> industrySymmetricTypes = ...;

// getOrCreateProperty(industryId, model, type, transitiveTypes, symmetricTypes)
if (transitiveTypes.contains(type)) {
    prop.convertToTransitiveProperty();   // 仅该行业配置为传递性的类型才生效
}
```

### 行业维护（手动）

| 操作 | 说明 |
|------|------|
| 新增行业 | 在行业管理页面创建，如「工业」「医疗」「金融」 |
| 配置关系清单 | 为每个行业定义关系类型，设置 isTransitive/isSymmetric |
| 导入概念 | 选择行业 → LLM 使用该行业的关系类型白名单 → 自动或手动选择域 |
| 创建域 | 选择行业，该域下的概念自动继承行业的关系类型规则 |

### 设计原则

- **权限只到域**：不问行业，角色授权域→域下所有概念自动可用
- **行业只管推理**：行业只控制 Jena 的 transitivity 规则和 LLM 的关系类型白名单
- **自动推导**：用户 → 角色 → 域 → 行业，整条链路对用户透明，无需手动选择
- **行业隔离**：每个行业的 Jena 模型独立构建，互不干扰

---

## 快速开始

### 环境要求

- **JDK 21**（或更高，推荐 21）
- **Maven 3.9+**
- **Node.js 22+**
- **MySQL 8.0**（或使用 Docker）

### 1. 克隆项目

```bash
git clone https://gitee.com/chyj90/luban.git
cd luban
```

### 2. 启动 MySQL

方式一：使用 Docker（推荐）

```bash
docker-compose up -d
```

方式二：本地安装 MySQL 8.0，手动创建数据库：

```sql
CREATE DATABASE luban CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 3. 配置数据库连接

编辑 `backend/src/main/resources/application.yml`，修改数据库用户名和密码：

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/luban?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC&createDatabaseIfNotExist=true
    username: root
    password: 你的密码
```

### 4. 启动后端

```bash
cd backend
mvn spring-boot:run
```

后端启动后访问 `http://localhost:8080`。JPA 会自动建表（`ddl-auto: update`），无需手动执行 SQL。

### 5. 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端开发服务器运行在 `http://localhost:5173`，API 请求会自动代理到 `http://localhost:8080`。

### 6. 打开浏览器

访问 **http://localhost:5173**，注册账号后即可开始使用。

---

## 数据库表结构

项目使用 JPA `ddl-auto: update` 自动建表，首次启动后会自动创建以下表：

### 基础表

| 表名 | 说明 |
|------|------|
| `users` | 用户表（邮箱、密码、昵称） |
| `user_sessions` | 用户会话（JWT token 管理） |
| `applications` | 应用 |
| `pages` | 页面 |
| `code_pages` | 页面代码（HTML/CSS/JS） |
| `datasources` | 数据源配置 |
| `queries` | 查询定义（SQL 模板 + 参数绑定） |
| `js_functions` | JS 函数 |

### 流程引擎表

| 表名 | 说明 |
|------|------|
| `members` | 组织成员（姓名、部门、职位、工号、上级） |
| `departments` | 部门（树形结构） |
| `roles` | 角色（应用级，含成员列表） |
| `form_definitions` | 表单定义（字段配置 + 版本管理） |
| `workflow_definitions` | 流程定义（节点 + 连线 + 版本管理） |
| `form_workflow_bindings` | 表单-流程绑定（一对一/一对多） |
| `workflow_instances` | 流程实例（运行中/已完成/已拒绝/已取消/已冻结） |
| `workflow_tasks` | 流程任务（待审批/已审批/已拒绝/转交/加签） |
| `workflow_history` | 流程历史（操作记录 + 节点流转） |

> 如果使用非 JPA 自动建表方式，可参考 `backend/src/main/resources/db/migration/` 中的 Flyway 迁移脚本。

### 清理测试数据

DevToolbar 模拟用户发起的测试流程会写入 `is_test = true` 的实例，需要清理时执行：

```sql
DELETE FROM workflow_history WHERE instance_id IN (SELECT id FROM workflow_instances WHERE is_test = true);
DELETE FROM workflow_tasks WHERE instance_id IN (SELECT id FROM workflow_instances WHERE is_test = true);
DELETE FROM workflow_instances WHERE is_test = true;
```

### 清理正式数据

```sql
DELETE FROM workflow_history WHERE instance_id IN (SELECT id FROM workflow_instances WHERE is_test = false);
DELETE FROM workflow_tasks WHERE instance_id IN (SELECT id FROM workflow_instances WHERE is_test = false);
DELETE FROM workflow_instances WHERE is_test = false;
```

按外键依赖顺序：history → tasks → instances。

---

## 角色系统

鲁班采用两级角色体系：**平台级角色**（PLATFORM）和**应用级角色**（APPLICATION），通过 `role_users` 关联表将用户与角色绑定。

### 角色类型

| 类型 | scope 值 | slug 格式 | 说明 | 可见范围 |
|------|----------|-----------|------|----------|
| 平台级 | `PLATFORM` | 简短标识，全局唯一 | 所有应用共享，控制跨应用权限 | 仅超管可见 |
| 应用级 | `APPLICATION` | `{slug}_{applicationId}`，应用内唯一 | 绑定到指定应用，应用内生效 | 仅创建者可见 |

> **slug 命名规则**：`super_admin`、`flow_tester`、`user` 为系统保留，不可使用。平台级角色 slug 全局唯一，应用级角色 slug 在同一应用下唯一。

### 系统内置角色（不可删除）

| 角色 | slug | 类型 | 说明 |
|------|------|------|------|
| 超级管理员 | `super_admin` | PLATFORM | 拥有全部权限，可操作所有平台级角色，不受创建者限制 |
| 流程测试 | `flow_tester` | PLATFORM | 流程测试专用角色，详见下方详述 |
| 普通用户 | `user` | PLATFORM | 默认注册角色，无特殊权限 |

### 流程测试角色（flow_tester）

`flow_tester` 是系统内置的流程测试专用角色，用于流程引擎的端到端测试场景。

| 特性 | 说明 |
|------|------|
| **密码** | 设为该角色时自动清空密码，仅通过模拟用户过滤器登录 |
| **角色互斥** | 不能与其他任何角色同时持有，角色选择中与其他角色互斥 |
| **角色锁定** | 一旦成为流程测试用户，角色不可再变更 |
| **用户管理** | 在用户管理页面中，将用户设为流程测试角色时：清空密码 + 清空所有其他角色，仅保留 `flow_tester` |
| **人员管理** | 在人员管理（Member）中，`flow_tester` 仅出现在 PLATFORM scope 角色下拉中，不出现在 APP 级角色选择中 |

### 权限规则

| 规则 | 说明 |
|------|------|
| **可见性** | 平台级角色仅超管可见；应用级角色仅创建者可见（超管也看不到他人的应用级角色） |
| **操作权限** | 平台级角色仅超管可编辑/删除；应用级角色仅创建者可编辑/删除 |
| **创建限制** | 非超管用户只能创建应用级角色，超管可创建平台级角色 |
| **API 校验** | 所有角色编辑/删除/权限配置/用户分配接口均通过 `checkOwnership` 硬校验，前端隐藏 + 后端拦截双重保障 |

### 角色与用户分配

| 规则 | 说明 |
|------|------|
| **多角色** | 一个用户可拥有多个角色，角色列表以逗号分隔显示 |
| **互斥** | 流程测试角色与其他角色互斥，不能同时勾选 |
| **锁定** | 一旦成为流程测试用户，角色不可再变更 |
| **密码** | 设为流程测试角色时，自动清空密码 |

### 数据库表

| 表名 | 说明 |
|------|------|
| `workflow_roles` | 角色定义（name, slug, scope, application_id, created_by） |
| `role_users` | 角色-用户关联（role_id, user_id） |
| `role_permissions` | 角色-权限关联（role_id, permission） |

---

## API 概览

所有 API 以 `/api/v1` 为前缀，需要 JWT 认证（`Authorization: Bearer <token>`）。

### 基础 API

| 模块 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 认证 | POST | `/api/v1/auth/register` | 注册 |
| 认证 | POST | `/api/v1/auth/login` | 登录 |
| 认证 | POST | `/api/v1/auth/logout` | 退出 |
| 用户 | GET | `/api/v1/users/me` | 当前用户信息 |
| 应用 | CRUD | `/api/v1/applications` | 应用管理 |
| 页面 | CRUD | `/api/v1/pages` | 页面管理 |
| 数据源 | CRUD | `/api/v1/datasources` | 数据源管理 |
| 查询 | CRUD | `/api/v1/queries` | 查询管理 |
| 查询 | POST | `/api/v1/queries/{id}/run` | 执行查询 |
| 查询 | POST | `/api/v1/queries/sql` | 执行原始 SQL |
| JS 函数 | CRUD | `/api/v1/js-functions` | JS 函数管理 |

### 流程 API

| 模块 | 路径 | 说明 |
|------|------|------|
| 表单 | `/api/v1/forms` | 表单 CRUD + 发布/复制/预览 |
| 流程定义 | `/api/v1/workflows` | 流程 CRUD + 发布/取消发布/校验/复制/版本管理 |
| 流程实例 | `/api/v1/workflow-instances` | 发起流程 + 实例列表/详情/取消/冻结/解冻/驳回/强制跳转/重新提交 |
| 流程任务 | `/api/v1/tasks` | 待办/已办列表 + 审批/驳回/转交/委派/加签/驳回至上一步 |
| 表单-流程绑定 | `/api/v1/form-workflow-bindings` | 绑定管理 + 默认绑定查询 |
| 组织成员 | `/api/v1/members` | 成员查询（按部门/关键词） |
| 部门 | `/api/v1/departments` | 部门树 + 部门成员 |
| 角色 | `/api/v1/roles` | 角色 CRUD（应用级） |
| 管理 | `/api/v1/admin` | 管理员操作（强制跳转/强制终止/强制撤回/改派） |
| 校验 | `/api/v1/lint` | 表单代码校验 + 字段 Schema 校验 + 流程校验 |
| Excel | `/api/v1/excel` | Excel 解析/导入/导出 |
| 同步 | `/api/v1/sync` | 组织同步 |

---

## 调试

### 前端调试日志

鲁班内置了浏览器端调试日志系统，可在代码中调用以下方法：

```js
// 记录调试日志
bug_trace_log('key', value);

// 导出所有调试日志到剪贴板
copy_bug_trace();

// 清空调试日志
clear_bug_trace();
```

### 后端调试日志

使用 `AgentLogger.bug()` 方法将调试日志写入 `backend/` 目录下的日志文件，用于排查动态 SQL 解析、参数绑定等问题。

---

## License

MIT