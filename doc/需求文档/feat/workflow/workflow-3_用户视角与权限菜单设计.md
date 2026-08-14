# feat/workflow-3_用户视角与权限菜单设计 需求文档

> **创建日期**：2026-08-14
> **关联文档**：[workflow-2_工作区开发生产模式隔离](./workflow-2_工作区开发生产模式隔离.md)
> **关系说明**：本文档与 workflow-2 正交互补。workflow-2 定义流程版本化与开发生产隔离的**内部机制**，本文档定义不同角色看到什么、如何导航、如何分配权限的**外部视角**。两份文档可独立实施，但需互相参照确保一致性。

---

## 一、现状与问题

### 1.1 当前导航结构

从 [router/index.tsx](../../../frontend/src/router/index.tsx) 可见，当前路由是扁平的：

```
/login           → 登录
/register        → 注册
/workspace       → 应用列表（WorkspacePage，实际已是 AppListPage）
/app/:appId      → 应用编辑器（AppEditorPage，含侧边栏+预览+工作流全功能）
/workflow/tasks  → 我的工作
/workflow/forms  → 表单管理
/workflow/designer/:id → 流程设计器
... 其他 workflow 子路由
```

当前 AppEditorPage 是一个**全功能页面**，包含侧边栏（页面/查询/工作流/数据源）、代码预览、Agent 面板。它没有考虑"普通用户不需要看到代码编辑器"的场景。

### 1.2 核心问题

| 问题 | 描述 |
|------|------|
| **无全局导航** | 各页面独立，没有统一的顶部导航栏，用户无法在不同应用间切换 |
| **无角色区分** | AppEditorPage 同时服务于开发者和普通用户，普通用户看到代码编辑器和侧边栏 |
| **无应用中心** | 普通用户登录后看到的是应用列表（仅为创建者设计），缺少"有哪些应用可用"的入口 |
| **多应用割裂** | 一个用户可能同时使用多个应用（报销审批、请假审批），当前无法在一个页面看到所有应用的待办 |
| **菜单无权限** | 所有菜单对所有登录用户可见，没有基于角色的显示/隐藏 |
| **普通用户无页面** | 当前普通用户视图设计为流程列表，但应用的核心交互是页面（表单、看板），流程只是背后的审批引擎 |
| **Query 参数不可信** | 页面中 Query 的用户身份参数（如 userId）来自前端内存，可被篡改，存在越权风险 |

### 1.3 与 workflow-2 的关系

workflow-2 解决的是"一个应用内，草稿和已发布如何共存"的问题。本文档解决的是"多个应用如何呈现给一个用户"的问题。

```
用户登录
  │
  ├── 顶部导航栏（全局）  ← 本文档设计
  │     ├── 应用中心
  │     └── 我的工作
  │
  └── 进入某个应用
        │
        ├── 开发者视图（编辑器+侧边栏+DevToolbar）  ← workflow-2 设计
        └── 普通用户视图（页面优先：iframe 渲染页面 + 流程按钮 + 我的申请）  ← 本文档设计
```

**安全基础**：普通用户页面中的 Query 通过 `this.auth.userId` 获取可靠用户身份（详见 workflow-2 §4.4），确保页面可在不被越权的前提下安全使用。**普通用户看不到 Query 管理入口**，Query 对他们是透明的。

---

## 二、设计目标

1. 登录后统一落地页，开发者与普通用户看到不同但一致的入口
2. 全局导航栏，支持跨应用操作（如"我的工作"汇总所有应用的待办）
3. 普通用户进入应用后看到**页面优先**的视图（iframe 渲染页面 + 流程入口），不暴露代码编辑器
4. 普通用户页面中的 Query 使用 `this.auth.userId` 获取可靠用户身份，不可越权
5. 无需显式权限配置，角色由"是否创建过应用"自动推断
6. 与 workflow-2 的版本化方案无缝衔接

---

## 三、用户角色与权限模型

### 3.1 角色定义

**不引入显式角色表**。用户类型由数据动态判断：

| 条件 | 角色 | 能力 |
|------|------|------|
| 用户创建了 ≥1 个应用 | **开发者** | 创建/编辑/删除应用、设计流程、模拟测试、发布流程、使用所有应用 |
| 用户未创建任何应用 | **普通用户** | 使用已发布应用、发起流程、审批任务、查看自己的工单 |

**动态切换**：普通用户创建第一个应用后，自动变为开发者。

### 3.2 权限判断逻辑

```
用户 → 查询 applications WHERE createdBy = userId
     → count > 0 → 开发者（看到所有开发者功能）
     → count = 0 → 普通用户（看到简化功能）
```

### 3.3 权限矩阵

| 操作 | 普通用户 | 开发者（自己创建的应用） | 开发者（别人创建的应用） |
|------|----------|--------------------------|--------------------------|
| 查看应用列表 | 有已发布流程的应用 | 全部（自己+别人已发布） | 全部（自己+别人已发布） |
| 创建应用 | 可（创建后变为开发者） | 可 | 可 |
| 查看应用页面 | 可（iframe 渲染，无编辑器） | 可（含代码编辑器） | 可（iframe 渲染，无编辑器） |
| 编辑应用（代码/页面） | 不可 | 可 | 不可 |
| 查看/管理 Query | 不可 | 可 | 不可 |
| 设计流程 | 不可 | 可 | 不可 |
| 管理表单 | 不可 | 可 | 不可 |
| 发起流程 | 可（已发布版本） | 可（已发布版本） | 可（已发布版本） |
| 发起测试 | 不可 | 可（草稿版本） | 不可 |
| 模拟用户 | 不可 | 可（仅自己应用） | 不可 |
| 查看测试数据 | 不可 | 可（仅自己应用） | 不可 |
| 审批任务 | 可 | 可 | 可 |
| 查看我的工作 | 可 | 可 | 可 |
| 管理测试组织数据 | 不可 | 可（仅自己应用） | 不可 |

---

## 四、全局导航结构

### 4.1 顶部导航栏（所有页面通用）

```
┌──────────────────────────────────────────────────────────────────┐
│  🏠 鲁班   应用中心   我的工作         [通知]  [用户头像 ▼]       │
└──────────────────────────────────────────────────────────────────┘
```

| 元素 | 行为 | 所有用户可见 |
|------|------|-------------|
| 鲁班 Logo | 点击回到应用中心 `/apps` | 是 |
| 应用中心 | 导航到 `/apps`，当前页高亮 | 是 |
| 我的工作 | 导航到 `/work`，当前页高亮 | 是 |
| 用户头像 | 下拉菜单：个人信息、退出登录 | 是 |

### 4.2 路由重构

**旧路由** → **新路由**：

| 旧路由 | 新路由 | 说明 |
|--------|--------|------|
| `/workspace` | `/apps` | 应用中心（重命名，语义更清晰） |
| `/app/:appId` | `/apps/:appId` | 进入应用（统一前缀） |
| `/workflow/tasks` | `/work` | 我的工作（全局，跨应用） |
| `/workflow/my-workflow` | 移除 | 合并到 `/work` |
| `/workflow/forms` | `/apps/:appId/forms` | 表单管理（应用内） |
| `/workflow/designer/:id` | `/apps/:appId/designer/:id` | 流程设计器（应用内） |
| `/workflow/processes` | `/apps/:appId/processes` | 流程列表（应用内） |
| `/workflow/instances/:id` | `/apps/:appId/instances/:id` | 实例详情（应用内） |
| `/workflow/organization` | `/apps/:appId/organization` | 组织架构（应用内） |
| `/login` | `/login` | 不变 |
| `/register` | `/register` | 不变 |

新路由结构：

```typescript
// frontend/src/router/index.tsx
{
  path: '/apps',
  element: <AppLayout />,  // 带顶部导航栏的布局
  children: [
    { index: true, element: <AppHubPage /> },        // 应用中心
    { path: ':appId', element: <AppEntryPage /> },    // 进入应用（分流）
  ]
},
{
  path: '/work',
  element: <AppLayout />,  // 同样的顶部导航栏布局
  children: [
    { index: true, element: <MyWorkPage /> },         // 我的工作
  ]
},
{
  path: '/login',
  element: <LoginPage />,
},
{
  path: '/register',
  element: <RegisterPage />,
},
{
  path: '*',
  element: <Navigate to="/apps" replace />,
}
```

### 4.3 AppLayout 组件（新增）

所有需要顶部导航栏的页面共享此布局：

```typescript
function AppLayout() {
  return (
    <div className="app-layout">
      <TopNavbar />           {/* 固定顶部导航栏 */}
      <main className="app-layout-content">
        <Outlet />            {/* 子路由内容 */}
      </main>
    </div>
  );
}
```

---

## 五、应用中心（Application Hub）

### 5.1 页面布局

```
┌──────────────────────────────────────────────────────────────────┐
│  🏠 鲁班   [应用中心]   我的工作                   [用户头像 ▼]    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  应用中心                                                        │
│                                                                  │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │
│  │ 📋 报销审批       │ │ 🏖 请假审批       │ │ 📄 合同审批       │  │
│  │ 我创建的          │ │ 张三创建的        │ │ 李四创建的        │  │
│  │ 3 个流程         │ │ 2 个流程         │ │ 1 个流程         │  │
│  │ [进入] [管理]     │ │ [进入]            │ │ [进入]            │  │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘  │
│                                                                  │
│  ┌──────────────────┐                                            │
│  │ ＋ 创建新应用      │  ← 所有用户可见                           │
│  └──────────────────┘                                            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 5.2 应用卡片状态

| 卡片类型 | 显示条件 | 操作按钮 |
|----------|----------|----------|
| 我创建的应用 | `createdBy = 当前用户` | [进入] [管理] |
| 别人创建的应用（有已发布流程） | `createdBy ≠ 当前用户` 且存在 `status = PUBLISHED` 的流程 | [进入] |
| 我创建的应用（无已发布流程） | `createdBy = 当前用户` 且无 PUBLISHED 流程 | [进入] [管理] 标记"未发布" |

### 5.3 按钮行为

| 按钮 | 行为 |
|------|------|
| [进入] | 导航到 `/apps/:appId`，以当前角色身份进入应用 |
| [管理] | 导航到 `/apps/:appId`，以开发者身份进入应用（仅创建者可见） |

### 5.4 API

```http
GET /api/v1/applications
```

返回两类应用（详见 workflow-2 §5.2.2）：
- 我是创建者 → 我创建的所有应用
- 我不是创建者 → 有已发布流程的应用

---

## 六、进入应用 —— 角色分流

### 6.1 分流逻辑

`/apps/:appId` 的 AppEntryPage 根据用户角色渲染不同视图：

```
用户进入 /apps/:appId
  │
  ├── 我是创建者 → 开发者视图（AppEditorPage，含侧边栏+代码编辑器+DevToolbar）
  │
  └── 我不是创建者 → 普通用户视图（AppUserPage，页面优先，流程为辅）
```

### 6.2 普通用户视图（AppUserPage — 新增）

**设计原则：页面优先，流程为辅**。普通用户进入应用，核心交互发生在应用的页面中（表单、看板、数据展示），流程是页面背后的审批引擎。因此主视觉区域是应用的默认页面（iframe 渲染），流程入口为次要位置。

```
┌──────────────────────────────────────────────────────────────────┐
│  🏠 鲁班   应用中心   [我的工作]                   [用户头像 ▼]    │
├──────────────────────────────────────────────────────────────────┤
│  报销审批应用                      [报销审批] [出差报销] [请假]    │
│                                                                  │
│  ┌─ 页面标签 ─────────────────────────────────────────────────┐  │
│  │ [📋 报销申请] [📊 报销记录] [📈 审批进度]                    │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │              （默认页面在 iframe 中渲染）                     │ │
│  │              用户在此填写表单、查看数据                       │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ 我的申请（该应用内）───────────────────────────────────────┐  │
│  │ 流程名称  │ 发起时间  │ 当前状态  │ 操作                    │  │
│  │ 报销审批  │ 08-14    │ 审批中    │ 查看详情                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**各区域说明**：

| 区域 | 内容 | 说明 |
|------|------|------|
| 顶部流程按钮 | 该应用所有已发布流程的快捷入口 | 点击后弹出表单填写页面，提交时创建 `is_test = false` 的正式实例 |
| 页面标签 | 该应用所有页面的标签页 | 切换不同页面，当前高亮显示。默认展示 `application.defaultPageId` 对应的页面 |
| 页面内容区 | iframe 渲染当前页面 | 页面内的 Query 使用 `this.auth.userId` 获取可靠用户身份（详见 workflow-2 §4.4） |
| 我的申请 | 当前用户在该应用内的流程实例 | 仅展示该应用内的实例（与全局 `/work` 不同，不需要"应用"列） |

**关键设计**：
- 主视觉区域是应用的页面（iframe），不是流程列表。流程是页面的附属功能
- 页面内容区高度自适应，撑满剩余空间，iframe 内无滚动条（页面内容滚动）
- 仅显示已发布版本的流程（`status = PUBLISHED`）
- 流程按钮产生 `is_test = false` 的正式实例
- 无侧边栏、无代码编辑器、无 DevToolbar、无 Query/数据源入口
- 页面中的 Query 使用 `this.auth.userId` 获取可靠用户身份（详见 workflow-2 §4.4）

### 6.3 开发者视图（沿用现有 AppEditorPage）

开发者进入自己的应用，看到现有 AppEditorPage（含侧边栏、代码编辑器、DevToolbar），但需包裹在 AppLayout 中。

**对现有 AppEditorPage 的改动**：
- 从独立页面改为 AppLayout 的子路由
- 顶部自动出现导航栏（应用中心、我的工作）
- DevToolbar 仍在底部（workflow-2 设计）

### 6.4 开发者进入别人创建的应用

开发者点击别人创建的已发布应用 → 看到普通用户视图（AppUserPage）。开发者的"开发者权限"仅对自己创建的应用生效。

---

## 七、我的工作（全局）

### 7.1 页面布局

```
┌──────────────────────────────────────────────────────────────────┐
│  🏠 鲁班   应用中心   [我的工作]                   [用户头像 ▼]    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  我的工作                                                        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ [我发起的]  [待审批]  [已处理]                              │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │ 应用   │ 流程名称 │ 发起时间 │ 当前状态 │ 操作              │  │
│  ├────────┼─────────┼─────────┼─────────┼───────────────────┤  │
│  │ 报销审批│ 报销审批 │ 08-14   │ 审批中   │ 查看详情           │  │
│  │ 请假审批│ 年假申请 │ 08-13   │ 已通过   │ 查看详情           │  │
│  │ 合同审批│ 合同审批 │ 08-12   │ 已驳回   │ 查看详情           │  │
│  └────────┴─────────┴─────────┴─────────┴───────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 7.2 关键行为

| 特性 | 说明 |
|------|------|
| **跨应用汇总** | 列表包含所有应用的流程实例，增加"应用"列区分来源 |
| **is_test 过滤** | 默认仅展示 `is_test = false` 的生产数据 |
| **模拟时自动切换** | ImpersonationFilter 生效时，自动展示 `is_test = true` 的测试数据（详见 workflow-2 §6.11） |
| **点击进入详情** | 导航到 `/apps/:appId/instances/:id`，保持应用上下文 |

### 7.3 与现有 MyWorkflow 的关系

现有 [MyWorkflow.tsx](../../../frontend/src/pages/workflow/MyWorkflow.tsx) 已实现三个标签页，改动点：
- 增加"应用"列
- 集成 `is_test` 过滤和模拟视图切换
- 包裹在 AppLayout 中，路由从 `/workflow/tasks` 改为 `/work`

---

## 八、菜单与权限的集成

### 8.1 无显式菜单配置

**本期不引入菜单配置表**。菜单可见性通过以下规则自动判断：

```typescript
// 前端判断逻辑
const { user } = useAuthStore();
const { applications } = useApplicationStore();

const isDeveloper = applications.some(app => app.createdBy === user.id);

// 顶部导航栏：所有用户都看到应用中心和我的工作
// 进入应用后：
//   if (isDeveloper && app.createdBy === user.id) → 开发者视图
//   else → 普通用户视图
```

### 8.2 不需要显式权限分配的理由

| 理由 | 说明 |
|------|------|
| 应用创建者即管理员 | 创建应用的人天然拥有该应用的全部管理权限 |
| 已发布即公开 | 应用发布后，所有用户都可以使用，无需邀请/授权 |
| 无部门/组织隔离 | 当前系统不按组织隔离用户，所有用户共享应用池 |
| 简化实现 | 避免引入 RBAC 表、权限配置页面等复杂功能 |

**后续版本**可引入"应用成员"概念，支持私有应用和邀请制。

---

## 九、与 workflow-2 的衔接点

| workflow-2 概念 | 本文档中的体现 |
|-----------------|---------------|
| 流程定义版本化（DRAFT/PUBLISHED） | 普通用户视图中仅展示 PUBLISHED 流程 |
| DevToolbar | 仅在开发者视图（自己创建的应用）中显示 |
| 发起测试 | 仅在开发者视图的流程编辑器中可用 |
| 发起流程 | 开发者和普通用户均可在应用内发起（使用 PUBLISHED 版本） |
| 模拟用户 | 仅在 DevToolbar 中可用，普通用户视图无此功能 |
| is_test 过滤 | 我的工作页面默认过滤，模拟时自动切换 |
| 表单快照 | 普通用户发起流程时使用快照表单，开发者编辑时使用最新表单 |
| 应用列表 API | 普通用户返回有已发布流程的应用，开发者返回所有自己的应用 |

### 9.1 需要互相调整的项

以下内容在实施时需要两份文档协同调整：

1. **应用列表 API**（workflow-2 §5.2.2）：本文档要求返回"我创建的应用"和"别人创建的已发布应用"，workflow-2 已按此设计。前端通过 `createdBy === currentUserId` 判断是否为创建者，通过 `publishedWorkflowCount > 0` 判断是否已发布，无需额外布尔字段。
2. **我的工作 API**（workflow-2 §5.4.3）：本文档要求跨应用汇总 + "应用"列，workflow-2 已将 `applicationId` 改为可选参数，不传时返回所有应用的任务，响应中增加 `applicationName` 字段。
3. **我的实例 API**（workflow-2 §5.4.2）：与 tasks API 同理，`applicationId` 改为可选参数，支持跨应用查询。
4. **AppEntryPage 分流**：本文档新增此页面，需配合 workflow-2 的 DevToolbar 显示逻辑（仅创建者+存在草稿版本时显示）。
5. **路由变更**：workflow 子路由全部移到 `/apps/:appId/` 下，需同步调整前端所有导航链接。`/work` 页面通过 AppLayout 的顶部导航栏在应用间切换。
6. **Query 模板安全注入**（workflow-2 §4.4）：本文档的普通用户视图（AppUserPage）中，页面渲染依赖 `this.auth.userId` 保证用户身份可靠。后端 `QueryService.run()` 需在模板解析前注入 `auth` 上下文。
7. **Agent 技能调整**（workflow-2 §十二）：`carocut-builder-compositor` 生成 Query 模板时需使用 `this.auth.userId`，`carocut-planner-planning` 规划页面时需区分普通用户视图（页面优先，无 Query 入口）。

---

## 十、UI 设计规范

本节定义 workflow-3 新增页面的 UI 规范，设计 tokens 与 workflow-2 §6.13.1 共享，此处仅列出新增组件。

> **设计原则**：所有新增页面必须与现有页面（MyWorkflow、ProcessList、FormList、AppListPage）保持视觉一致。参考设计 tokens 见 workflow-2 §6.13.1。

### 10.1 AppLayout 全局布局

**结构**：顶部导航栏（固定） + 内容区（滚动）

```css
.app-layout {
  min-height: 100vh;
  background: #f4f6f9;
}

.app-layout-content {
  padding-top: 50px; /* 与导航栏高度一致，避免内容被遮挡 */
  min-height: calc(100vh - 50px);
}
```

**布局示意**：

```
┌──────────────────────────────────────────────────────────────────┐
│  🏠 鲁班   应用中心   我的工作                     [用户头像 ▼]    │  ← 固定 50px
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  （子路由内容：应用中心 / 我的工作 / 进入应用）                     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 10.2 TopNavbar 顶部导航栏

**CSS**：

```css
.topnav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  height: 50px;
  padding: 0 20px;
  background: #fff;
  border-bottom: 1px solid #e8edf3;
  gap: 10px;
}

.topnav-logo {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  text-decoration: none;
  cursor: pointer;
}

.topnav-logo-text {
  font-size: 15px;
  font-weight: 600;
  color: #1f1f1f;
}

.topnav-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 24px;
}

.topnav-link {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #5a6a7e;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s;
}

.topnav-link:hover {
  color: #1677ff;
  background: #f0f5ff;
}

.topnav-link-active {
  composes: topnav-link;
  color: #1677ff;
  background: #e6f4ff;
}

.topnav-spacer {
  flex: 1;
}

.topnav-user {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  cursor: pointer;
  position: relative;
}

.topnav-user-name {
  font-size: 13px;
  color: #5a6a7e;
}

.topnav-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #e6f4ff;
  color: #1677ff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 500;
}

.topnav-dropdown {
  position: absolute;
  top: 42px;
  right: 0;
  background: #fff;
  border: 1px solid #e8edf3;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  min-width: 140px;
  overflow: hidden;
  z-index: 200;
}

.topnav-dropdown-item {
  display: block;
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: #fff;
  font-size: 13px;
  color: #1f1f1f;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}

.topnav-dropdown-item:hover {
  background: #fafafa;
}

.topnav-dropdown-item-danger {
  composes: topnav-dropdown-item;
  color: #cf1322;
}
```

**交互细节**：
- 点击用户头像展开下拉菜单（个人信息、退出登录）
- 点击页面其他区域关闭下拉菜单
- 当前路由匹配时，对应导航链接高亮（`topnav-link-active`）
- 退出登录清除 token，跳转 `/login`

### 10.3 AppHubPage 应用中心

**页面布局**：

```
┌──────────────────────────────────────────────────────────────────┐
│  🏠 鲁班   [应用中心]   我的工作                   [用户头像 ▼]    │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  应用中心                                                        │
│                                                                  │
│  [+ 创建新应用]                                                  │
│                                                                  │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │
│  │ 📋 报销审批       │ │ 🏖 请假审批       │ │ 📄 合同审批       │  │
│  │ 我创建的          │ │ 张三创建的        │ │ 李四创建的        │  │
│  │ 3 个流程         │ │ 2 个流程         │ │ 1 个流程         │  │
│  │ [进入]  [管理]    │ │ [进入]            │ │ [进入]            │  │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**CSS**：

```css
.apphub {
  max-width: 1200px;
  margin: 0 auto;
  padding: 32px 24px;
}

.apphub-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.apphub-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f1f1f;
  margin: 0;
}

.apphub-create-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: #1677ff;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.apphub-create-btn:hover {
  background: #4096ff;
}

.apphub-create-form {
  background: #fff;
  border: 1px solid #e8edf3;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.apphub-create-form input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid #e8edf3;
  border-radius: 6px;
  font-size: 14px;
  color: #1f1f1f;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.apphub-create-form input:focus {
  border-color: #1677ff;
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.1);
}

.apphub-create-form input::placeholder {
  color: #8c9cab;
}

.apphub-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.apphub-card {
  background: #fff;
  border-radius: 8px;
  border: 1px solid #eee;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.2s, transform 0.2s;
}

.apphub-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}

.apphub-card-header {
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
}

.apphub-card-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  margin: 16px 0 0 16px;
}

.apphub-card-body {
  padding: 12px 16px 16px;
}

.apphub-card-name {
  font-size: 15px;
  font-weight: 600;
  color: #1f1f1f;
  margin: 0 0 4px;
}

.apphub-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #8c9cab;
  margin-bottom: 12px;
}

.apphub-card-owner-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  background: #e6f4ff;
  border-radius: 4px;
  font-size: 11px;
  color: #1677ff;
  font-weight: 500;
}

.apphub-card-unpublished-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  background: #fffbe6;
  border-radius: 4px;
  font-size: 11px;
  color: #ad6800;
  font-weight: 500;
}

.apphub-card-actions {
  display: flex;
  gap: 8px;
}

.apphub-card-btn {
  padding: 5px 14px;
  border: 1px solid #e8edf3;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  color: #5a6a7e;
  cursor: pointer;
  transition: all 0.15s;
  font-weight: 500;
}

.apphub-card-btn:hover {
  border-color: #1677ff;
  color: #1677ff;
}

.apphub-card-btn-primary {
  composes: apphub-card-btn;
  background: #1677ff;
  border-color: #1677ff;
  color: #fff;
}

.apphub-card-btn-primary:hover {
  background: #4096ff;
  border-color: #4096ff;
  color: #fff;
}

.apphub-card-delete {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #8c9cab;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.15s;
}

.apphub-card:hover .apphub-card-delete {
  opacity: 1;
}

.apphub-card-delete:hover {
  background: #fff2f0;
  color: #cf1322;
}
```

### 10.4 AppUserPage 普通用户应用视图

**页面布局**（页面优先，流程为辅）：

```
┌──────────────────────────────────────────────────────────────────┐
│  🏠 鲁班   应用中心   [我的工作]                   [用户头像 ▼]    │
├──────────────────────────────────────────────────────────────────┤
│  报销审批应用                      [报销审批] [出差报销] [请假]    │
│                                                                  │
│  ┌─ 页面标签 ─────────────────────────────────────────────────┐  │
│  │ [📋 报销申请] [📊 报销记录] [📈 审批进度]                    │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │              （默认页面在 iframe 中渲染）                     │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ 我的申请（该应用内）───────────────────────────────────────┐  │
│  │ 流程名称  │ 发起时间  │ 当前状态  │ 操作                    │  │
│  │ 报销审批  │ 08-14    │ 审批中    │ 查看详情                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**CSS**：

```css
.appuser {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 50px); /* 减去顶部导航栏高度 */
  overflow: hidden;
}

/* 顶部栏：应用名称 + 流程快捷按钮 */
.appuser-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid #e8edf3;
  flex-shrink: 0;
}

@media (min-width: 640px) {
  .appuser-topbar {
    padding: 12px 24px;
  }
}

@media (min-width: 1024px) {
  .appuser-topbar {
    padding: 12px 32px;
  }
}

.appuser-topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.appuser-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: none;
  font-size: 13px;
  color: #5a6a7e;
  cursor: pointer;
  transition: color 0.15s;
  flex-shrink: 0;
}

.appuser-back:hover {
  color: #1677ff;
}

.appuser-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f1f1f;
  margin: 0;
}

.appuser-topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.appuser-flow-btn {
  padding: 5px 14px;
  border: 1px solid #e8edf3;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  color: #5a6a7e;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.appuser-flow-btn:hover {
  border-color: #1677ff;
  color: #1677ff;
  background: #f0f5ff;
}

/* 页面标签栏 */
.appuser-tabs {
  display: flex;
  align-items: center;
  padding: 0 16px;
  background: #fff;
  border-bottom: 1px solid #e8edf3;
  gap: 0;
  flex-shrink: 0;
  overflow-x: auto;
}

@media (min-width: 640px) {
  .appuser-tabs {
    padding: 0 24px;
  }
}

@media (min-width: 1024px) {
  .appuser-tabs {
    padding: 0 32px;
  }
}

.appuser-tab {
  padding: 8px 16px;
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  font-size: 13px;
  color: #5a6a7e;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
}

.appuser-tab:hover {
  color: #1677ff;
}

.appuser-tab-active {
  composes: appuser-tab;
  color: #1677ff;
  border-bottom-color: #1677ff;
  font-weight: 500;
}

/* 页面内容区（iframe 容器） */
.appuser-page {
  flex: 1;
  overflow: hidden;
  background: #fff;
  border-bottom: 1px solid #e8edf3;
}

.appuser-page iframe {
  width: 100%;
  height: 100%;
  border: none;
}

/* 我的申请面板 */
.appuser-panel {
  flex-shrink: 0;
  max-height: 40%;
  overflow-y: auto;
  padding: 16px;
}

@media (min-width: 640px) {
  .appuser-panel {
    padding: 16px 24px;
  }
}

@media (min-width: 1024px) {
  .appuser-panel {
    padding: 16px 32px;
  }
}

.appuser-section-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f1f1f;
  margin: 0 0 12px;
}

/* 我的申请表格（复用现有 card + table 样式） */
.appuser-card {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  border: 1px solid #e8edf3;
  overflow: hidden;
}

.appuser-table {
  width: 100%;
  border-collapse: collapse;
}

.appuser-table th {
  padding: 10px 16px;
  text-align: left;
  font-size: 12px;
  font-weight: 500;
  color: #5a6a7e;
  background: #fafafa;
  border-bottom: 1px solid #e8edf3;
}

.appuser-table td {
  padding: 10px 16px;
  font-size: 13px;
  color: #1f1f1f;
  border-bottom: 1px solid #e8edf3;
}

.appuser-table tbody tr {
  transition: background 0.15s;
}

.appuser-table tbody tr:hover td {
  background: #fafafa;
}

.appuser-table tbody tr:last-child td {
  border-bottom: none;
}

.appuser-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  color: #8c9cab;
  font-size: 13px;
}
```

### 10.5 MyWorkPage 全局我的工作

**页面布局**：与现有 MyWorkflow 页面一致，增加"应用"列。

```
┌──────────────────────────────────────────────────────────────────┐
│  🏠 鲁班   应用中心   [我的工作]                   [用户头像 ▼]    │
├──────────────────────────────────────────────────────────────────┤
│  我的工作                                                        │
│  ───────────────────────────────────────────────                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ [我发起的]  [待审批]  [已处理]                              │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │ 应用    │ 流程名称 │ 发起时间 │ 当前状态 │ 操作             │  │
│  ├─────────┼─────────┼─────────┼─────────┼──────────────────┤  │
│  │ 报销审批 │ 报销审批 │ 08-14   │ 审批中   │ 查看详情         │  │
│  │ 请假审批 │ 年假申请 │ 08-13   │ 已通过   │ 查看详情         │  │
│  └─────────┴─────────┴─────────┴─────────┴──────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**CSS**：复用现有 [MyWorkflow.module.css](../../../frontend/src/pages/workflow/MyWorkflow.module.css)，仅新增：

```css
/* 应用列样式 */
.appCell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.appCellIcon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.appCellName {
  font-size: 13px;
  font-weight: 500;
  color: #1f1f1f;
}

/* 点击应用名称跳转到应用 */
.appCellLink {
  cursor: pointer;
  color: #1677ff;
}

.appCellLink:hover {
  text-decoration: underline;
}
```

**关键交互**：
- 点击"应用"列中的应用名称，跳转到 `/apps/:appId`（进入该应用）
- 点击"查看详情"，跳转到 `/apps/:appId/instances/:id`
- 测试数据行左侧有橙色竖线，顶部显示测试数据视图提示（复用 workflow-2 §6.13.5）

---

## 十一、前端实现计划

### 11.1 新增文件

| 文件 | 说明 |
|------|------|
| `src/components/AppLayout/index.tsx` | 全局布局组件（顶部导航栏 + Outlet） |
| `src/components/AppLayout/AppLayout.css` | 布局样式 |
| `src/components/TopNavbar/index.tsx` | 顶部导航栏组件 |
| `src/components/TopNavbar/TopNavbar.css` | 导航栏样式 |
| `src/pages/AppHub/AppHubPage.tsx` | 应用中心页面 |
| `src/pages/AppHub/AppHubPage.css` | 应用中心样式 |
| `src/pages/AppUser/AppUserPage.tsx` | 普通用户应用视图（页面优先：iframe 渲染页面 + 页面标签 + 流程按钮 + 我的申请） |
| `src/pages/AppUser/AppUserPage.css` | 普通用户视图样式（flex 布局，页面区撑满剩余空间） |
| `src/pages/AppEntry/AppEntryPage.tsx` | 应用入口分流页面 |
| `src/pages/MyWork/MyWorkPage.tsx` | 全局我的工作页面 |

### 11.2 修改文件

| 文件 | 改动 |
|------|------|
| `src/router/index.tsx` | 路由重构，引入 AppLayout |
| `src/pages/AppEditor/AppEditorPage.tsx` | 移除顶部自定义 header，依赖 AppLayout 提供导航栏 |
| `src/pages/workflow/MyWorkflow.tsx` | 增加"应用"列，适配新路由 |
| `src/pages/AppList/AppListPage.tsx` | 重命名为 AppHubPage，功能增强 |
| `src/api/workflow.ts` | 我的工作 API 增加应用名称返回 |
| `src/components/InteliPreview/index.tsx` | 确保 `this.auth` 上下文在 iframe 桥接中正确传递（或由后端 QueryService 独立注入） |

### 11.3 实施阶段

| 阶段 | 内容 | 预估工时 |
|------|------|----------|
| **Phase 1** | AppLayout + TopNavbar 组件（全局导航栏） | 2h |
| **Phase 2** | 路由重构（所有路由统一到 AppLayout 下） | 2h |
| **Phase 3** | AppHubPage 应用中心（替换 AppListPage） | 3h |
| **Phase 4** | AppEntryPage 分流 + AppUserPage 普通用户视图（页面优先：iframe 渲染页面、页面标签切换、顶部流程按钮、底部我的申请） | 5h |
| **Phase 5** | MyWorkPage 全局我的工作（增加应用列、is_test 集成） | 3h |
| **Phase 6** | AppEditorPage 适配（放入 AppLayout 内） | 2h |
| **Phase 7** | QueryService `this.auth` 注入（后端强制注入 userId/userName/userEmail 到模板 auth 上下文） | 2h |
| **Phase 8** | 联调测试（开发者/普通用户双视角完整链路，含页面渲染 + 流程审批） | 4h |

---

## 十二、验收标准

1. 所有登录用户看到统一的顶部导航栏（应用中心、我的工作）
2. 普通用户登录后看到应用中心，列出所有有已发布流程的应用
3. 普通用户点击应用卡片「进入」，看到**页面优先**的视图：默认页面（iframe 渲染）为主视觉，页面标签可切换，流程按钮在顶部操作栏
4. 普通用户点击流程按钮，填写表单后提交，产生 `is_test = false` 的正式实例
5. 普通用户看到的页面中，Query 使用 `this.auth.userId` 获取可靠用户身份，无法越权查看他人数据
6. 普通用户看不到代码编辑器、侧边栏、DevToolbar、Query 列表、数据源管理
7. 开发者登录后看到应用中心，自己创建的应用显示「管理」按钮
8. 开发者点击「管理」进入应用，看到完整的编辑器（侧边栏+代码编辑器+DevToolbar）
9. 开发者点击别人创建的应用，看到普通用户视图（页面优先）
10. 我的工作页面汇总所有应用的流程实例，包含"应用"列
11. 顶部导航栏的「应用中心」和「我的工作」正确高亮当前页面
12. 退出登录后回到登录页，顶部导航栏消失
13. 普通用户创建第一个应用后，自动变为开发者，应用中心出现「管理」按钮
14. 所有旧路由（`/workspace`、`/workflow/*`）正确重定向到新路由
15. 后端 QueryService 模板解析时，`this.auth.userId`、`this.auth.userName`、`this.auth.userEmail` 由 SecurityContext 强制注入，页面 JS 无法覆盖

---

## 十三、附录：用户角色对比

### 普通用户 - 完整旅程

```
登录 → 应用中心
  → 看到 3 个应用卡片（报销审批、请假审批、合同审批）
  → 点击「报销审批」→ 进入应用
  → 看到默认页面（报销申请表单）在 iframe 中渲染
  → 页面标签：[📋 报销申请] [📊 报销记录] [📈 审批进度]
  → 顶部操作栏：报销审批应用  [报销审批] [出差报销]
  → 在页面中填写报销表单 → 提交（页面内的 Query 自动使用 this.auth.userId）
  → 看到"提交成功，等待审批"提示
  → 如需查看进度，点击「📈 审批进度」页面标签
  → 顶部导航栏点击「我的工作」
  → 在「我发起的」标签页看到刚才提交的报销审批（跨应用汇总）
  → 等待审批人处理后，在「已处理」标签页看到结果
```

### 开发者 - 完整旅程

```
登录 → 应用中心
  → 看到自己创建的 2 个应用（报销审批、请假审批）+ 别人创建的 1 个应用（合同审批）
  → 点击「报销审批」的「管理」→ 进入开发者视图
  → 侧边栏：页面管理、查询管理、工作流、数据源
  → 点击「工作流」→ 流程列表
  → 看到：报销审批（已发布 v2 · 草稿 v3 编辑中）
  → 进入草稿 v3 编辑器
  → DevToolbar 显示"草稿版本 v3"，选择模拟用户"张三"
  → 点击「发起测试」→ 以张三身份提交测试流程
  → 切换到模拟用户"李四"，进入「我的工作」→ 审批测试任务
  → 验证通过后，点击「发布 v3」
  → 顶部导航栏点击「应用中心」→ 点击「合同审批」的「进入」
  → 看到普通用户视图（因为不是自己创建的应用）
  → 可以发起正式流程（is_test = false）
```