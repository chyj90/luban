<p align="center">
  <img src="doc/images/logo.svg" alt="Luban Logo" width="80" />
</p>
<h1 align="center">鲁班 Luban</h1>
<p align="center"><strong>所见即所得 · 盘活数据资产 · 快速生成企业应用</strong></p>

---

> ⚠️ **项目状态：早期开发中**  
> 本项目目前处于快速迭代阶段，功能尚未完善，我会每天更新。欢迎 ⭐ Star 关注进度，也欢迎提 Issue / PR 一起建设！

---

## 截图

<p align="center">
  <img src="doc/images/代码编辑器.png" alt="代码编辑器" width="45%" />
  <img src="doc/images/页面管理.png" alt="页面管理" width="45%" />
</p>
<p align="center">
  <img src="doc/images/数据源管理.png" alt="数据源管理" width="45%" />
  <img src="doc/images/Query管理.png" alt="Query 管理" width="45%" />
</p>
<p align="center">
  <img src="doc/images/AI辅助-主智能体.png" alt="AI 助手" width="45%" />
  <img src="doc/images/AI辅助-数据辅助智能体.png" alt="AI 数据智能体" width="45%" />
</p>

---

## 简介

**鲁班（Luban）** 是一个 AI 驱动的所见即所得应用构建平台。连接数据库、描述需求，AI 帮你快速生成完整的 Web 应用，让企业数据资产真正活起来。

### 为什么选择鲁班？

- 🎨 **所见即所得** — 代码编辑的同时实时预览，改完立刻看到效果，不用等编译、不用切窗口
- 🗄️ **盘活数据资产** — 直连 MySQL 数据库，AI 自动生成 SQL 查询，告别手工写 CRUD，让沉睡的数据变成可用的接口
- ⚡ **快速生成应用** — 几分钟内从零到一：建表 → 配数据源 → AI 生成页面 → 发布上线，传统几天的活几小时搞定
- 🤖 **AI 全程陪伴** — 内置 AI Agent 对话面板，支持 ReAct 推理和 Plan-Execute 规划执行两种模式，随时调整页面样式、优化查询逻辑、修复 bug
- 🔒 **隐私安全第一** — AI Agent 的推理、规划、工具调用全部在浏览器端完成，你的 API Key 和对话数据只存在于本地浏览器，服务器零存储，企业数据不外泄
- 🔌 **灵活可扩展** — 支持自定义 HTML/CSS/JS，不锁死模板，专业开发者也能深度定制

> 从零重建，去除 DSL/Layout/Widget 等低代码冗余，只保留核心链路。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 19 + TypeScript + Vite 8 |
| **状态管理** | Zustand |
| **代码编辑器** | Monaco Editor |
| **AI Agent** | 纯浏览器端运行（ReAct + Plan-Execute） |
| **后端** | Java 21 + Spring Boot 3.3.2 |
| **ORM** | Spring Data JPA + Hibernate |
| **数据库** | MySQL 8.0 |
| **认证** | Spring Security + JWT |

---

## AI Agent 架构

鲁班的 AI Agent 采用**纯浏览器端运行**架构，不依赖任何后端 LLM 服务：

```
┌─────────────────────────────────────────────────┐
│  浏览器（你的电脑）                                │
│  ┌───────────────────────────────────────────┐   │
│  │  AI Agent (ReAct / Plan-Execute)          │   │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────┐  │   │
│  │  │ 思考推理 │→│ 工具调用  │→│ 观察反馈 │  │   │
│  │  └─────────┘  └──────────┘  └─────────┘  │   │
│  │       ↓                                    │   │
│  │  直接调用 DeepSeek API（你的 Key）          │   │
│  └───────────────────────────────────────────┘   │
│                     ↓ 工具调用结果                │
│              ┌──────────────┐                    │
│              │  Luban 后端   │                    │
│              │ (CRUD API)   │                    │
│              └──────────────┘                    │
└─────────────────────────────────────────────────┘
```

### Agent 模式

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| **ReAct** | 思考→行动→观察 循环推理，边想边做 | 页面生成、样式调整、Bug 修复 |
| **Plan-Execute** | 先制定完整计划，再逐步执行 | 复杂任务、多步骤操作 |

### 隐私安全 🔒

- **你的 API Key 只存在浏览器** — 在页面"设置"中配置，存入浏览器 localStorage，服务端永远不会收到你的 Key
- **对话数据零存储** — Agent 的推理过程、工具调用、对话历史全在浏览器内存中，刷新即消失
- **直连大模型** — 请求从浏览器直接发送到 DeepSeek API，不经服务端中转，无中间人风险
- **支持自定义地址** — 可配置任意兼容 OpenAI API 格式的大模型地址和 Key（目前测试了 DeepSeek）

### 配置大模型

启动前端后，在应用编辑页右上角点击 ⚙️ 设置图标，填入你的大模型配置：

| 配置项 | 说明 | 示例 |
|--------|------|------|
| API 地址 | 兼容 OpenAI 格式的 API 端点 | `https://api.deepseek.com/v1` |
| API Key | 你的大模型 API Key | `sk-xxxxxxxx` |
| 模型名称 | 模型 ID | `deepseek-chat` |

> 配置保存在浏览器本地，服务端完全不知情。每次打开页面需要重新配置，或浏览器记住上次填写的内容。

---

## 项目结构

```
luban/
├── backend/                  # Spring Boot 后端
│   ├── src/main/java/com/luban/
│   │   ├── config/           # 安全、CORS 配置
│   │   ├── controller/       # REST API 控制器
│   │   ├── dto/              # 请求/响应 DTO
│   │   ├── entity/           # JPA 实体
│   │   ├── repository/       # 数据访问层
│   │   ├── security/         # JWT 认证过滤
│   │   └── service/          # 业务逻辑层
│   └── src/main/resources/
│       └── application.yml   # 应用配置
├── frontend/                 # React + Vite 前端
│   └── src/
│       ├── pages/            # 页面组件
│       ├── components/       # 公共组件
│       ├── stores/           # Zustand 状态
│       ├── api/              # API 请求封装
│       └── types/            # TypeScript 类型
├── docker-compose.yml        # MySQL 容器
└── doc/                      # 需求文档
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

| 表名 | 说明 |
|------|------|
| `users` | 用户表（邮箱、密码、昵称） |
| `user_sessions` | 用户会话（JWT token 管理） |
| `workspaces` | 工作区 |
| `applications` | 应用 |
| `pages` | 页面 |
| `code_pages` | 页面代码（HTML/CSS/JS） |
| `datasources` | 数据源配置 |
| `queries` | 查询定义 |
| `js_functions` | JS 函数 |

> 如果使用非 JPA 自动建表方式，可参考 `backend/src/main/resources/db/migration/` 中的 Flyway 迁移脚本。

---

## API 概览

所有 API 以 `/api/v1` 为前缀，需要 JWT 认证（`Authorization: Bearer <token>`）。

| 模块 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 认证 | POST | `/api/v1/auth/register` | 注册 |
| 认证 | POST | `/api/v1/auth/login` | 登录 |
| 认证 | POST | `/api/v1/auth/logout` | 退出 |
| 用户 | GET | `/api/v1/users/me` | 当前用户信息 |
| 工作区 | GET | `/api/v1/workspaces` | 工作区列表 |
| 工作区 | POST | `/api/v1/workspaces` | 创建工作区 |
| 应用 | CRUD | `/api/v1/applications` | 应用管理 |
| 页面 | CRUD | `/api/v1/pages` | 页面管理 |
| 数据源 | CRUD | `/api/v1/datasources` | 数据源管理 |
| 查询 | CRUD | `/api/v1/queries` | 查询管理 |

---

## License

MIT