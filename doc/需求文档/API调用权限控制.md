# API 调用权限控制需求文档

## 一、端点全景分析

### 1.1 端点清单

| # | 端点 | 控制器 | 用途 | 调用方 | 认证方式 |
|---|------|--------|------|--------|---------|
| ① | `POST /api/v1/tools/{id}/test` | ToolDefinitionController | 平台管理员手动测试工具 | 前端 ToolListPage「测试」按钮 | JWT |
| ② | `AgentService.executeTool()` | AgentService | 问数流程中 LLM 决定调用工具后，服务端内部执行 | AgentService 自身（ReAct graph） | 服务端内部（携带用户上下文） |
| ③ | `POST /api/v1/application-tools/{appId}/{id}/run` | ApplicationToolController | 应用开发中通过 SDK 调用应用级 API | 应用页面 iframe → postMessage → useQueryBridge | JWT |

### 1.2 端点关系图

```
┌─────────────────────────────────────────────────────────────────┐
│                      PLATFORM 工具（scope=PLATFORM）              │
│                                                                  │
│  平台管理员     ──→ ① /tools/{id}/test             (JWT)       │
│  Agent ReAct    ──→ ② executeTool()                (内部)      │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                    APPLICATION 工具（scope=APPLICATION）          │
│                                                                  │
│  应用页面 JS    ──→ ③ /application-tools/{appId}/{id}/run (JWT) │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 各端点当前权限状态

| 端点 | 当前权限 | 风险等级 | 问题描述 |
|------|---------|---------|---------|
| ① `/test` | KEY 存在时校验 KEY 权限，JWT 用户跳过 | 🔴 高 | 任何登录用户可测试任意工具 |
| ② `executeTool()` | 无直接校验，由概念域权限保护 | 🟢 低 | 问数流程中调用前已做概念域权限校验 |
| ③ `/run` | `authenticated()`，仅校验 scope+groupId | 🟡 中 | 任何登录用户可调用任意应用的 API |

---

## 二、PLATFORM 工具权限修复

### 2.1 端点 ① `/tools/{id}/test` — 工具维护者测试

**调用场景**：平台管理员在「工具注册表」页面点击某个工具的「测试」按钮，输入参数后执行，验证工具是否正常工作。

**权限逻辑**：谁维护的工具谁测试，这是**数据所有权**问题，不是角色权限问题。

**修复方案**：
- 删除现有 API KEY 权限校验代码块（API KEY 持有者不应使用此端点）
- 在方法内增加所有权校验：
  - 检查 `tool.createdBy == currentUserId`（工具创建者才能测试）
  - 若 `api_key_id` 不为空，直接返回 403「API KEY 不能使用此端点」

**校验链路**：
```
JWT 用户 → 认证(authenticated) → 所有权(tool.createdBy == user.id) → 执行工具
KEY 用户 → 认证(ApiKeyAuthFilter) → 拒绝(403: API KEY 不能使用此端点)
```

**为什么不是 RBAC？**
- 工具注册表是共享的，但每个工具有明确的创建者（`created_by`）
- 如果用户 A 创建了工具，用户 B 不应该测试它——即使 B 有管理员角色
- 与 APPLICATION 工具保持一致：自维护的 API 校验创建者所有权，而非全局角色

### 2.2 端点 ② `AgentService.executeTool()` — 问数内部调用

**调用场景**：Agent 问数流程中，ReAct graph 的 `tool_executor` node 执行工具。这是服务端内部调用，不经过 Controller。

**修复方案**：**不修改**。原因：
- 该调用发生在问数流程内部，调用前已通过 `roleConceptPermissionService.batchCheckQueryPermission()` 做概念域权限校验
- 概念域权限校验比角色权限更细粒度，符合"问数通过 RBAC 校验域权限"的要求
- 添加工具级权限校验会与概念域权限校验冲突

---

## 三、应用用户管理设计

### 3.1 设计目标

当前系统"应用发布后所有用户都能使用"，引入应用用户白名单后，应用创建者可以控制谁能访问应用、以及在应用内有什么权限。

**核心理念**：应用使用者面对的是**页面**和**流程**，权限围绕这两者设计。流程审批在流程设计中已配置审批人，不在应用级重复设置。

### 3.2 数据模型

复用现有 `workflow_roles` + `role_users` 表，不新增表。

**现有表结构**：

| 表 | 关键字段 | 说明 |
|----|---------|------|
| `workflow_roles` | `id`, `name`, `slug`, `scope`, `application_id`, `created_by` | 角色定义，`scope=APPLICATION` 表示应用级角色 |
| `role_users` | `role_id`, `user_id` | 用户-角色关联 |
| `role_permissions` | `role_id`, `permission` | 角色权限（当前仅 PLATFORM 级支持，需改造） |

**设计要点**：
- **白名单**：拥有该应用任一角色的用户即为白名单用户。`role_users.user_id` 集合即白名单
- **角色**：应用内可创建多个角色，每个角色可分配不同权限
- **权限**：当前 `"应用级角色不支持配置权限"` 的限制需要移除，支持应用级角色配置权限

### 3.3 默认行为

应用创建时不预置任何角色。创建者自动成为应用成员，拥有全部页面和功能权限。

**创建者自动加入白名单**：创建应用时，系统自动将创建者加入 `role_users` 表（关联一个隐式角色或直接标记），确保「白名单」校验链路对创建者同样生效。创建者无需额外操作即可访问自己的应用。

创建者可在「成员与权限」中自行设计角色体系——按需创建角色，为每个角色配置页面权限和流程发起权限，然后将用户分配到对应角色。

不预设角色名称、不预设权限组合，完全由应用开发者根据业务场景自行定义。

### 3.4 应用级权限定义

权限只有两类：**页面权限**（控制能看哪些页面）和**流程发起权限**（控制能否发起流程）。

#### 3.4.1 页面权限

页面权限以 `app:page:{pageId}` 格式存储，每个页面独立控制。

| 权限 Key | 说明 |
|----------|------|
| `app:page:{pageId}` | 可访问指定页面（控制页面可见性，菜单显示/隐藏） |

**规则**：
- 页面权限控制的是 UI 层：导航菜单可见性、直接访问 URL 返回 403
- API 调用权限不跟页面，跟白名单——用户在应用有角色即可调用该应用内所有 API
- 创建者默认拥有全部页面权限，无需逐页配置

#### 3.4.2 流程发起权限

流程发起权限以 `app:workflow:{workflowId}` 格式存储，每个流程独立控制。

| 权限 Key | 说明 |
|----------|------|
| `app:workflow:{workflowId}` | 可发起指定流程 |

**关于发起权限的位置**：放在应用角色管理中，而不是流程设计器。流程设计器管理的是流程内部逻辑（步骤、审批人），而"谁能发起流程"是应用级的访问控制，属于角色权限范畴。

API 管理和成员管理不需要权限控制，应用开发者自己管就行。

### 3.5 UI 设计

#### 3.5.1 统一入口设计

平台已有「人员管理」（`UserListPage` + `RoleManagementPage` + `OrgPage`），包含用户列表、角色管理、部门管理、组织架构。应用内不再新建独立页面，复用平台现有体系。

**整体架构**：

```
平台 - 人员管理（已有，扩展）
├── 用户列表     → 所有用户，可分配平台角色
├── 角色管理     → 所有角色（PLATFORM + APPLICATION），扩展：APPLICATION 角色支持页面/流程权限配置
├── 部门管理     → 组织架构树 CRUD
└── 组织架构     → 只读视图（部门 + 成员）

应用内 - 设置
└── 成员与权限   → 点击跳转到「角色管理」页面，URL 带 ?appId=xxx 自动筛选当前应用的 APPLICATION 角色
```

**设计要点**：
- 不新建「成员与权限」页面，直接复用平台 `RoleManagementPage`
- 跳转时带 `?appId=xxx` 参数，页面自动筛选展示该应用的 APPLICATION 角色
- 角色卡片增加「权限」按钮（当前 APPLICATION 角色无此按钮），点击弹出应用权限配置面板
- 组织架构（部门、成员）在平台人员管理中统一维护，应用内通过角色关联引用

#### 3.5.2 入口

```
应用编辑器 → 顶部导航「设置」→ 左侧 Tab「成员与权限」
                                            │
                                            ▼
                              跳转到平台「角色管理」页面
                              ?appId=xxx 筛选当前应用角色
```

#### 3.5.3 角色管理页（平台已有，扩展）

APPLICATION 角色按应用分组展示，PLATFORM 角色独立一组：

```
┌──────────────────────────────────────────────────────────────┐
│  平台角色                                          [+ 新建角色] │
│                                                              │
│  ■ 平台级角色                                                │
│  ┌──────────────────────┐  ┌──────────────────────┐         │
│  │ 超级管理员            │  │ 开发者               │         │
│  │ super_admin          │  │ developer            │         │
│  │ 系统最高权限          │  │ 应用开发权限         │         │
│  │                      │  │                      │         │
│  │ 平台级               │  │ 平台级               │         │
│  │ [👤] [🔒] [🔒] [✏️]  │  │ [👤] [🔒] [🔒] [✏️]  │         │
│  └──────────────────────┘  └──────────────────────┘         │
│                                                              │
│  ■ 设备监控应用                                               │
│  ┌──────────────────────┐  ┌──────────────────────┐         │
│  │ 质检主管              │  │ 操作员               │         │
│  │ quality_inspector    │  │ operator             │         │
│  │ 质量检查相关权限       │  │ 日常操作权限         │         │
│  │                      │  │                      │         │
│  │ 应用级               │  │ 应用级               │         │
│  │ [👤] [🔒] [✏️] [🗑️]  │  │ [👤] [🔒] [✏️] [🗑️]  │         │
│  └──────────────────────┘  └──────────────────────┘         │
│                                                              │
│  ■ 采购管理系统                                               │
│  ┌──────────────────────┐                                    │
│  │ 审批员                │                                    │
│  │ approver             │                                    │
│  │ 采购审批权限         │                                    │
│  │                      │                                    │
│  │ 应用级               │                                    │
│  │ [👤] [🔒] [✏️] [🗑️]  │                                    │
│  └──────────────────────┘                                    │
│                                                              │
│  [👤] 分配用户   [🔒] 配置权限   [✏️] 编辑   [🗑️] 删除        │
│  * PLATFORM 角色有两个🔒（平台权限 + 概念域权限）              │
│  * APPLICATION 角色有一个🔒（页面/流程权限）                   │
└──────────────────────────────────────────────────────────────┘
```

**分组规则**：
- PLATFORM 角色：固定第一组，标题「平台级角色」
- APPLICATION 角色：按 `application_id` 分组，标题为应用名称
- 同一应用下角色按创建时间排序
- 从应用内跳转进入时（`?appId=xxx`），自动展开目标应用分组，其他分组折叠

#### 3.5.4 权限配置面板（APPLICATION 角色专属）

点击 APPLICATION 角色的「🔒 权限」按钮，弹出面板：

```
┌──────────────────────────────────────────────┐
│  角色权限 — 质检主管                    [✕]   │
│                                              │
│  ┌──────────┬──────────┐                     │
│  │ 页面权限  │ 流程发起  │                     │
│  ├──────────┴──────────┤                     │
│  │                      │                     │
│  │  ☑ 工作台             │                     │
│  │  ☑ 设备监控           │                     │
│  │  ☑ 生产报表           │                     │
│  │  ☐ 系统配置           │                     │
│  │  ☐ 用户管理           │                     │
│  │  ☑ 质量分析           │                     │
│  │                      │                     │
│  │  [全选] [全不选]      │                     │
│  │                      │                     │
│  └──────────────────────┘                     │
│                                              │
│                    [取消]    [保存]           │
└──────────────────────────────────────────────┘
```

切换到「流程发起」Tab：

```
┌──────────────────────────────────────────────┐
│  角色权限 — 质检主管                    [✕]   │
│                                              │
│  ┌──────────┬──────────┐                     │
│  │ 页面权限  │ 流程发起  │                     │
│  ├──────────┴──────────┤                     │
│  │                      │                     │
│  │  ☑ 设备报修流程       │                     │
│  │  ☐ 采购审批流程       │                     │
│  │  ☑ 质量巡检流程       │                     │
│  │                      │                     │
│  │  [全选] [全不选]      │                     │
│  │                      │                     │
│  └──────────────────────┘                     │
│                                              │
│                    [取消]    [保存]           │
└──────────────────────────────────────────────┘
```

#### 3.5.5 交互说明

| 操作 | 触发方式 | 行为 |
|------|---------|------|
| 进入成员与权限 | 应用设置 → 成员与权限 | 跳转到平台角色管理页，URL 带 `?appId=xxx` 自动筛选 |
| 分配用户 | 角色卡片「👤」按钮 | 弹出现有用户分配弹窗，搜索用户并勾选 |
| 配置权限 | 角色卡片「🔒」按钮（仅 APPLICATION 角色） | 弹出权限配置面板，含页面/流程两个 Tab |
| 全选/全不选 | 权限面板底部按钮 | 批量操作复选框 |

#### 3.5.6 权限校验流程

**页面访问**（后端 `listPages` 内部逻辑）：
```
用户请求页面列表 → 查用户在该应用的角色 → 获取角色 app:page:{pageId} 权限
  → 逐页标记 accessible 字段 → 返回给前端
  → 前端只渲染 accessible=true 的页面
```

**SDK API 调用**（跟白名单，不跟页面）：
```
用户调用 API → 查 tool_definition（确认 scope=APPLICATION，拿到 group_id=appId）
  → 查用户在 appId 应用是否有角色（role_users JOIN workflow_roles）
  → 有角色：执行
  → 无角色：返回 403
```

**流程发起**：
```
用户发起流程 → 查用户在该应用的角色 → 获取角色 app:workflow:{workflowId} 权限
  → 该流程在权限列表中？
    → 是：允许发起
    → 否：返回 403
```

**关键规则**：
- 页面权限控制 UI 层可见性，后端 listPages 标记 accessible，前端过滤
- API 调用权限不跟页面，跟白名单——用户在应用有角色即可调用所有 API
- 流程发起权限逐流程校验，按 `app:workflow:{workflowId}` 匹配

#### 3.5.7 页面权限守卫实现

当前 `AppUserPage` 无页面权限校验，拿到所有页面就全量展示。需要补充以下能力。

**现状**：

| 组件 | 当前行为 | 问题 |
|------|---------|------|
| `ProtectedRoute`（`guards.tsx`） | 只校验登录态 | 不校验页面权限 |
| `AppUserPage` | 加载全部页面，默认选第一个，导航菜单全量展示 | 无权限页面也可见 |
| 后端 `listPages` | 返回应用下所有页面 | 不区分用户是否有权限 |

**需要增加**：

**① 后端 `listPages` 返回 `accessible` 字段**

```typescript
// 响应示例
{
  pages: [
    { id: 1, name: "工作台", isDefault: true, accessible: true },
    { id: 2, name: "设备监控", accessible: true },
    { id: 3, name: "系统配置", accessible: false },  // 用户角色无此页面权限
  ]
}
```

后端逻辑：查询用户在该应用的角色 → 获取角色 `app:page:{pageId}` 权限列表 → 逐页标记 `accessible`。

**② 前端导航菜单过滤**

`AppUserPage` 侧边栏导航只渲染 `accessible=true` 的页面，无权限页面不显示。

**③ 直接 URL 访问拦截**

如果用户通过 URL 直接访问无权限的页面（如 `?pageId=3`），前端校验 `accessible=false` 后：
- 重定向到第一个有权限的页面
- 若所有页面都无权限，显示「暂无访问权限」提示

**④ 角色无任何页面权限时**

白名单用户可能没有分配任何页面权限，此时：
- 页面列表为空
- 显示「您暂无访问此应用的权限，请联系管理员」

**实现位置**：

| 改动 | 文件 |
|------|------|
| 后端 `listPages` 增加权限过滤 | `PageController.java` |
| 前端导航菜单过滤 | `AppUserPage.tsx` |
| URL 直接访问拦截 | `AppUserPage.tsx` `handlePageNavigate` |

---

## 四、APPLICATION 工具权限修复

结合用户白名单 + 角色权限设计，重新设计 SDK 调用权限。

### 4.1 端点 ③ `/application-tools/{appId}/{id}/run` — SDK 调用

**调用场景**：应用页面中的 JS 代码通过 `__LUBAN__.callApi('apiName', { params })` 调用应用级 API。调用链：iframe JS → postMessage → useQueryBridge → HTTP POST /run。

**两类工具**：

| 类型 | Scope | 存储位置 | 授权方式 |
|------|-------|---------|---------|
| 自己维护的 API | APPLICATION | `tool_definition` 表，`groupId=applicationId` | 应用创建者直接维护 |
| 授权的 API | PLATFORM | `tool_definition` 表，通过 `api_key_tool` + `application_api_key` 关联 | 应用绑定 KEY → KEY 申请工具权限 → 审批通过 |

### 4.2 自己维护的 API（APPLICATION scope）

**校验链路**（3 步）：
```
1. 认证    → 用户已登录？JWT 校验
2. API归属 → 该 API 是 APPLICATION 级？查 tool_definition（scope=APPLICATION，拿到 group_id 即 appId）
3. 白名单  → 用户在该应用有角色？role_users JOIN workflow_roles WHERE application_id=appId（步骤2得到的）
   ↓
  执行
```

**关键变化**：不再以创建者所有权为唯一校验，而是通过白名单控制。API 调用不跟页面权限——用户在应用白名单内即可调用该应用所有 API。

### 4.3 授权的 API（PLATFORM scope via KEY）

**校验链路**（比自维护多 KEY 校验两步）：
```
1. 认证      → 用户已登录？JWT 校验
2. 白名单    → 用户在该应用有角色？
3. KEY 绑定  → 应用绑定了 KEY 且状态为 ACTIVE？
4. KEY 权限  → 该 KEY 申请了此 API 且审批通过（APPROVED）？
   ↓
  执行
```

### 4.4 SDK 工具列表统一

当前 `appTools` 只包含 APPLICATION scope 的工具，需要扩展为包含两种：

```typescript
// 获取工具列表时合并
const selfTools = await listAppTools(applicationId);         // APPLICATION scope
const keyTools = await listApplicationTools(applicationId);  // KEY 授权的 PLATFORM tools
const allTools = [...selfTools, ...keyTools];
```

`callApi` 统一通过 `POST /run` 调用，后端根据 scope 走不同校验链路。

---

## 五、移除废弃端点及 Dead Code

以下功能未启用或无调用方，端点及相关代码全部移除。

### 移除的端点

| 端点 | 方法 | 用途 | 移除原因 |
|------|------|------|---------|
| `/api/v1/mcp/internal/tools/call` | POST | 外部 MCP 客户端调用平台工具 | "平台作为 MCP Server"功能暂未启用 |
| `/api/v1/mcp/internal/tools/list` | GET | 外部 MCP 客户端获取工具列表 | 同上 |
| `/api/v1/agent/tool-call` | POST | 前端 Agent 通过后端代理执行工具 | 无调用方：前端 agentLoop 本地执行 `tool.execute()`，后端 AgentService 直接方法调用 `executeToolByName()`，均不经过此端点 |

### 移除的代码

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/.../controller/McpInternalController.java` | 删除整个文件 | 包含 MCP 两个端点的控制器 |
| `backend/.../config/SecurityConfig.java` | 删除 `.requestMatchers("/api/v1/mcp/internal/**").permitAll()` | 安全配置中的 MCP 路径白名单 |
| `backend/.../controller/AgentController.java` | 删除 `proxyToolCall()` 方法及 `@PostMapping("/tool-call")` | 无调用方的 dead code |
| `README.md` | 删除 McpInternalController 和 `/api/v1/mcp/internal` 相关描述 | 文档引用清理 |

---

## 六、修改清单

### 6.1 后端修改

| 文件 | 修改内容 |
|------|---------|
| `ToolDefinitionController.java` | `testTool()` 方法增加 `@AuthenticationPrincipal`、所有权校验 `tool.createdBy == currentUserId` |
| `ApplicationToolController.java` | `run()` 方法增加：`@AuthenticationPrincipal`、白名单校验、KEY 绑定校验；新增成员管理接口：`GET /{appId}/roles`、`POST /{appId}/members`、`DELETE /{appId}/members/{userId}`；新增 `GET /{appId}/pages` 获取页面列表供角色配置使用 |
| `RoleController.java` | 移除 `"应用级角色不支持配置权限"` 限制，支持 APPLICATION scope 角色配置权限 |
| `RolePermission.java` | 扩展 `permission` 字段支持应用级权限 Key（如 `app:page:{pageId}`、`app:workflow:{workflowId}`） |
| `PageController.java` | `listPages` 增加 `accessible` 字段，根据用户角色 `app:page:{pageId}` 权限标记 |

### 6.2 前端修改

| 文件 | 修改内容 |
|------|---------|
| `AppEditorPage.tsx` | `appTools` 合并 KEY 授权工具，传给 `InteliPreview` |
| `AppUserPage.tsx` | `appTools` 合并 KEY 授权工具，传给 `useQueryBridge`；导航菜单过滤：只展示 `accessible=true` 的页面；URL 直接访问无权限页面时拦截重定向；无页面权限时展示提示 |
| `ApiPanel/index.tsx` | `onToolsChange` 暴露完整工具列表（自维护 + 授权） |
| 扩展 `RoleManagementPage` | APPLICATION 角色卡片增加「权限」按钮，弹出页面/流程权限配置面板（复用平台角色管理页，不新建独立页面） |
| 应用设置页面 | 新增「成员与权限」Tab，点击跳转到平台角色管理页（`?appId=xxx`） |

### 6.3 不受影响的部分

| 组件 | 原因 |
|------|------|
| `AgentService.executeTool()` | 问数流程内部调用，已由概念域权限保护 |
| `useQueryBridge.ts` | 已通过 `appTools` 查找，无需修改 |
| `InteliPreview/index.tsx` | 已透传 `appTools`，无需修改 |

---

## 七、最终权限模型

| 场景 | 认证 | 白名单 | 角色权限 | KEY 绑定 | KEY 权限 | RBAC |
|------|------|--------|---------|---------|---------|------|
| ① 管理员测试工具 | ✅ | — | — | — | — | 创建者 |
| ② 问数内部调用 | ✅ | — | — | — | — | ✅ 概念域 |
| ③ 应用自维护 API | ✅ | ✅ 有角色 | — | — | — | — |
| ④ 应用授权 API | ✅ | ✅ 有角色 | — | ✅ ACTIVE | ✅ APPROVED | — |
| ⑤ 页面访问 | ✅ | ✅ 有角色 | ✅ `app:page:{pageId}` | — | — | — |
| ⑥ 流程发起 | ✅ | ✅ 有角色 | ✅ `app:workflow:{workflowId}` | — | — | — |

**说明**：
- ③④ 为 API 调用场景，不进页面权限校验，白名单即通过
- ⑤⑥ 为应用内交互场景，需校验角色权限
- 创建者自动在白名单中，无需额外配置