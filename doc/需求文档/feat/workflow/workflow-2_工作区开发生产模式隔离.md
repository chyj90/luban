# feat/workflow-2_应用开发生产模式隔离 需求文档

> **创建日期**：2026-08-14
> **更新日期**：2026-08-14（v3：引入流程定义版本化，打破开发/生产二元对立，允许生产运行中同步调整流程）
> **关联模块**：luban-workflow、luban-core
> **关联文档**：[workflow-3_用户视角与权限菜单设计](./workflow-3_用户视角与权限菜单设计.md) — 本文档定义版本化**内部机制**，workflow-3 定义**外部视角**（导航、角色、权限），两份文档正交互补，实施时需互相参照。

---

## 一、背景与问题

### 1.1 现状

鲁班平台已取消 workspace 中间层，Application 直接关联创建用户。当前 `applications` 表结构：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT | 主键 |
| name | VARCHAR(50) | 应用名称 |
| createdBy | BIGINT | 创建者用户 ID |
| slug | VARCHAR(100) | 唯一标识 |
| icon | VARCHAR(20) | 图标 |
| color | VARCHAR(7) | 主题色 |
| defaultPageId | BIGINT | 默认页面 ID |
| createdAt | DATETIME | 创建时间 |
| updatedAt | DATETIME | 更新时间 |

工作流系统运行在单一服务实例中，同一运行时同时服务"流程设计者"和"普通用户"：

- **流程设计者**：创建应用，在应用中设计表单、编排审批流程、发布上线
- **普通用户**：使用已发布应用中的流程，发起申请、审批任务

### 1.2 核心痛点

**痛点一：设计阶段无法安全测试多用户协作流程。**

由于用户身份完全由 JWT 令牌解析（前端传入的 userId 不可信），设计者无法在同一个浏览器中模拟"张三发起流程 → 李四审批 → 王五会签"的完整链路。如果加入全局用户模拟（Impersonation）功能，则存在严重安全漏洞：设计者将拥有所有已发布流程的越权审批能力。

**痛点二：测试数据（部门、成员、角色）无法按应用隔离。**

当前 `DataInitializer` 在应用启动时创建测试数据，角色（Role）的 `applicationId` 硬编码为 `1`。当开发者创建第二个应用时，该应用没有关联的角色数据，无法完成端到端测试。每个开发者、每个应用都需要独立的测试组织数据。

**痛点三：开发与生产不是二元对立，已有流程需要边运行边调整。**

这是最关键的痛点。一个审批流程上线后，开发者经常需要调整（如增加审批节点、修改表单字段、调整流转条件）。当前如果简单地将应用分为"开发模式"和"生产模式"两个互斥状态，则：
- 要修改已上线流程，必须先"取消发布"→ 整个应用退回开发模式 → 修改 → 重新发布
- 取消发布期间，新的生产实例如何标记？影响用户体验
- 正确做法：**已发布版本继续运行，开发者同时在草稿版本上修改，改完后发布新版本覆盖旧版本**

### 1.3 问题本质

**开发与生产不是绝对二元的，而是需要版本化隔离。**

| | 已发布版本（生产） | 草稿版本（开发中） |
|---|---|---|
| 目的 | 处理真实业务审批 | 验证流程设计变更 |
| 数据 | 真实数据，严格权限控制 | 测试数据，可随意操作 |
| 身份 | 真实 JWT 身份，不可伪造 | 允许模拟多用户 |
| 安全要求 | 高（涉及真实业务决策） | 低（测试数据可丢弃） |
| 对用户可见 | 是 | 否（仅创建者可见） |

关键洞察：**这两种状态不是互斥的，而是共存的。** 一个流程定义可以同时有"已发布版本"（用户在使用）和"草稿版本"（开发者在调整）。应用层面的"模式"表示该应用是否已对外开放，但即使在已发布的应用中，开发者依然可以修改流程定义的草稿、用模拟用户测试，然后发布新版本。

---

## 二、设计目标

### 2.1 核心目标

1. **流程定义版本化**：每个流程定义同时维护"已发布版本"和"草稿版本"，版本切换不中断正在运行的生产实例
2. **已发布版本零影响**：修改草稿、测试草稿不影响已发布版本的正常运行
3. **创建者可模拟用户**：在草稿版本上，创建者可以模拟任意用户进行端到端测试，测试数据标记 `is_test = true`
4. **生产身份不可伪造**：已发布版本的流程，所有操作必须通过真实 JWT 身份认证，忽略模拟请求头
5. **按应用隔离测试数据**：每个应用独立初始化测试组织数据（角色），互不干扰
6. **运行时动态切换**：版本发布和切换无需重启服务

### 2.2 非目标

- 不做跨应用的流程迁移/复制（本期不做）
- 不做应用模板市场（本期不做）
- 不改变现有的 JWT 认证体系

---

## 三、数据模型设计

### 3.1 核心设计原则：版本化而非模式化

**关键改变**：不再将"开发/生产"作为应用级别的互斥模式，而是作为**流程定义级别的版本状态**。

```
应用（Application）
  └── 流程定义 A（WorkflowDefinition）
        ├── 已发布版本（publishedVersion）  ← 用户正在使用，不可模拟
        └── 草稿版本（draftVersion）        ← 开发者正在调整，可模拟测试
  └── 流程定义 B
        ├── 已发布版本
        └── 草稿版本
  └── 流程定义 C（新建，从未发布）
        └── 草稿版本（唯一版本，可模拟测试）
```

- **应用层面**：无额外状态字段，应用是否对外开放由是否存在已发布流程定义决定
- **流程定义层面**：`status` 字段区分草稿/已发布，`version` 字段追踪版本号
- **实例层面**：`is_test` 布尔字段标记测试数据

### 3.2 Application 表

Application 表无需新增字段，维持现有结构。应用是否已发布完全由工作流定义的 `status` 字段推导。

完整字段：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| id | BIGINT | 是 | 自增 | 主键 |
| name | VARCHAR(50) | 是 | — | 应用名称 |
| createdBy | BIGINT | 是 | — | 创建者用户 ID |
| slug | VARCHAR(100) | 是 | — | 唯一标识 |
| icon | VARCHAR(20) | 否 | 'code' | 图标 |
| color | VARCHAR(7) | 否 | '#6B8F71' | 主题色 |
| defaultPageId | BIGINT | 否 | NULL | 默认页面 ID |
| createdAt | DATETIME | 是 | NOW() | 创建时间 |
| updatedAt | DATETIME | 是 | NOW() | 更新时间 |

### 3.3 WorkflowDefinition 表新增字段

```sql
ALTER TABLE workflow_definitions
ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
COMMENT '状态：DRAFT 草稿 | PUBLISHED 已发布';

ALTER TABLE workflow_definitions
ADD COLUMN version INT NOT NULL DEFAULT 1
COMMENT '版本号（每次发布 +1）';

ALTER TABLE workflow_definitions
ADD COLUMN published_version_id BIGINT NULL
COMMENT '指向已发布版本的 definition ID（草稿记录指向其已发布版本，已发布版本为 NULL）';
```

**版本模型**：

```
首次创建：
  workflow_definitions 表中一条记录，status=DRAFT, version=1, published_version_id=NULL

首次发布：
  1. 将当前记录 status 改为 PUBLISHED，这是 v1
  2. 自动创建一条新记录：status=DRAFT, version=2, published_version_id=指向v1

后续修改（在草稿上改）：
  - 修改 v2 的 DRAFT 记录

再次发布：
  1. 将 v2 DRAFT 记录 status 改为 PUBLISHED
  2. 自动创建 v3 DRAFT 记录，published_version_id=指向v2

查询已发布版本：
  SELECT * FROM workflow_definitions WHERE application_id=? AND status='PUBLISHED'

查询草稿版本：
  SELECT * FROM workflow_definitions WHERE application_id=? AND status='DRAFT'
```

### 3.4 WorkflowInstance 表新增字段

```sql
ALTER TABLE workflow_instances
ADD COLUMN is_test BOOLEAN NOT NULL DEFAULT FALSE
COMMENT '是否为测试数据（草稿版本流程产生的实例）';

ALTER TABLE workflow_instances
ADD COLUMN definition_version INT NOT NULL DEFAULT 1
COMMENT '创建该实例时的流程定义版本号';
```

### 3.5 WorkflowTask 表

无需新增字段。`is_test` 和 `definition_version` 通过父表 `workflow_instances` JOIN 获取，避免数据不一致。

### 3.6 测试组织数据

当前 `departments` 和 `members` 为全局共享数据（无 applicationId），所有应用共用同一套用户体系来模拟审批链路。这简化了测试数据管理。

`workflow_roles` 表已有 `applicationId` 字段（迁移脚本 `drop_workspace_migration.sql` 已处理），每个应用拥有独立的角色集合。角色数据不再在应用启动时统一初始化，改为**按应用懒加载**（见 §八）。

| 表 | applicationId | 说明 |
|-----|--------------|------|
| departments | 无（全局共享） | 部门结构，所有应用复用 |
| members | 无（全局共享） | 模拟用户，所有应用复用 |
| workflow_roles | 有 | 每个应用独立的角色定义 |

#### 3.6.1 Member 与 User 的关系（重要）

**两个表：一个超集，一个子集，一对一关联。**

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

**关联规则：**

1. **创建 User 时自动同步 Member**：用户注册时，`AuthService.register()` 自动在 `members` 表查找同邮箱记录，有则关联（设置 `userId`），无则新建一条 member。
2. **Member 是超集**：`members` 表包含正式用户（有 `userId`）和测试用户（`userId = NULL`）。测试用户仅通过 DevToolbar 模拟使用，不可登录。
3. **一对一关系**：每个 `User` 对应唯一一个 `Member`（通过 `Member.userId` 关联），每个 `Member` 最多关联一个 `User`。
4. **流程设计器选人**：`MemberPicker` 组件从 `members` 表读取，显示所有成员（含测试用户）。选中后存储的是 `member.id`。
5. **模拟用户**：DevToolbar 从 `members` 表读取所有成员，选择后通过 `ImpersonationFilter` 以该成员身份操作。若成员无 `userId`，Filter 动态构造临时 `User` 对象。

**为何拆成两张表：**

- `users` 存安全敏感信息（密码哈希），变更频率低
- `members` 存组织信息（部门、职位），随 HR 变动频繁更新
- 测试用户不需要登录能力，只需存在于 `members` 表即可被模拟

### 3.7 版本状态机

```
┌──────────────────────────────────────────────────────────────────┐
│                      流程定义生命周期                              │
│                                                                  │
│  新建流程定义                                                      │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────┐     publish()      ┌──────────┐                     │
│  │  DRAFT   │ ─────────────────→│ PUBLISHED │  ← 用户正在使用     │
│  │ (v1)     │                   │   (v1)    │                     │
│  └─────────┘                    └────┬─────┘                     │
│       ▲                              │                           │
│       │         自动创建              │  publish() 发布新版本       │
│       │                              ▼                           │
│  ┌─────────┐                    ┌──────────┐                     │
│  │  DRAFT   │ ←─────────────────│ PUBLISHED │                     │
│  │ (v2)     │   自动创建草稿      │   (v2)    │  ← 替换旧版本      │
│  └────┬────┘                    └────┬─────┘                     │
│       │                              │                           │
│       │   开发者修改草稿              │  publish()                 │
│       ▼                              ▼                           │
│  ┌─────────┐                    ┌──────────┐                     │
│  │  DRAFT   │                   │ PUBLISHED │                     │
│  │ (v3)     │                   │   (v3)    │                     │
│  └─────────┘                    └──────────┘                     │
│                                                                  │
│  关键规则：                                                        │
│  • 草稿版本的修改不影响已发布版本的运行                              │
│  • 发布时，草稿版本变为新的已发布版本，旧版本进入历史                │
│  • 正在运行的实例继续使用创建时的版本（definition_version 记录）      │
│  • 新发起的实例使用最新已发布版本                                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 四、安全模型

### 4.1 用户模拟（Impersonation）规则

模拟功能仅在 **应用创建者对草稿版本流程操作时** 生效：

```
允许模拟的条件（所有条件必须同时满足）：
  1. 当前登录用户是应用的创建者（createdBy）
  2. 当前操作的流程定义版本为 DRAFT（草稿）状态
  3. 请求 Header 包含 X-Impersonate-User-Id
  4. 被模拟的 userId 需是有效的系统用户

已发布版本（PUBLISHED）流程中：
  任何 X-Impersonate-User-Id 头都会被忽略
  操作人身份始终 = JWT 解析的真实用户
```

### 4.2 安全边界

```
请求进入
  │
  ▼
JwtAuthFilter（解析 JWT，得到真实用户）
  │
  ▼
ImpersonationFilter（检查是否可以模拟）
  ├── 流程定义 status = PUBLISHED → 忽略模拟头，维持真实身份
  ├── 流程定义 status = DRAFT + 当前用户是 createdBy → 允许模拟
  ├── 流程定义 status = DRAFT + 当前用户不是 createdBy → 忽略模拟头
  └── 无法确定流程定义 → 忽略模拟头
  │
  ▼
Controller（@AuthenticationPrincipal 拿到可能是模拟后的身份）
```

### 4.3 安全保障

| 保障措施 | 说明 |
|----------|------|
| 版本隔离 | 模拟能力仅作用于草稿版本，已发布版本不受影响 |
| 创建者限制 | 只有应用创建者才能模拟，其他用户不能 |
| 生产数据标记 | 已发布版本产生的实例 `is_test = false`，前端明确标识 |
| 审计日志 | 模拟操作记录真实操作人，便于审计追溯 |
| 版本固化 | 正在运行的实例绑定创建时的版本号，不受后续修改影响 |

### 4.4 Query 模板安全注入（this.auth 命名空间）

#### 4.4.1 问题

页面 JS 中执行的 Query 可以传入参数，但参数来源是前端内存，不可信：

```javascript
// 页面 JS 代码 — 不可靠，userId 可被篡改
MyQuery.run({ userId: 2, status: "approved" });
```

后端接收参数后直接替换模板变量 `{{ this.params.userId }}`，如果该参数用于身份过滤（如 `WHERE user_id = {{ this.params.userId }}`），则存在越权风险：用户 A 可以传入用户 B 的 ID 查看他人数据。

**核心问题**：后端无法分辨哪些参数是"身份参数"（不可信）、哪些是"业务参数"（可信），硬编码参数名白名单（如 `userId`、`user_id`）是脆弱的——开发者可能使用 `operator`、`submitter`、`owner_id`、`uid` 等任意名称。

#### 4.4.2 方案：独立的 `this.auth` 命名空间

在模板语法中增加 `this.auth` 命名空间，与 `this.params` 分离：

| 模板写法 | 来源 | 可靠性 | 用途 |
|----------|------|--------|------|
| `{{ this.params.xxx }}` | 页面 JS 传入 | 不可信 | 业务参数（筛选条件、分页等） |
| `{{ this.auth.userId }}` | 后端 SecurityContext 注入 | 可信 | 身份过滤（必须用此来源） |
| `{{ this.auth.userName }}` | 后端 SecurityContext 注入 | 可信 | 身份展示 |
| `{{ this.auth.userEmail }}` | 后端 SecurityContext 注入 | 可信 | 身份展示 |

**查询示例**：

```sql
-- 正确：身份过滤用 this.auth.userId
SELECT * FROM expenses
WHERE user_id = {{ this.auth.userId }}
  AND status = {{ this.params.status }}
  AND amount > {{ this.params.minAmount }}

-- 错误：绝不能用 this.params 传入身份参数
SELECT * FROM expenses WHERE user_id = {{ this.params.userId }}
```

#### 4.4.3 后端实现

在 `QueryService.run()` 中，模板解析前注入 `auth` 上下文：

```java
// QueryService.run() 中，resolveTemplate 之前
Authentication auth = SecurityContextHolder.getContext().getAuthentication();
if (auth != null && auth.getPrincipal() instanceof User user) {
    Map<String, Object> authParams = new HashMap<>();
    authParams.put("userId", user.getId());
    authParams.put("userName", user.getName());
    authParams.put("userEmail", user.getEmail());
    templateContext.put("auth", authParams);  // 注入到模板引擎上下文
}
// templateContext.put("params", mergedParams) — 来自请求体
// resolveTemplate(sql, templateContext)  — 同时解析 this.auth 和 this.params
```

**关键保障**：
- `this.auth` 的三个字段（`userId`、`userName`、`userEmail`）后端强制注入，页面 JS 无法覆盖
- 页面 JS 可以传入 `params.userId`，但后端不会用它覆盖 `auth.userId`——两个命名空间互不干扰
- 开发者有责任使用 `this.auth.userId` 做身份过滤，使用 `this.params.xxx` 做业务过滤

#### 4.4.4 对普通用户页面的意义

普通用户进入应用看到的页面，其中的 Query 如果使用了 `this.auth.userId`，则：
- 后端保证该值一定是当前登录用户的真实 ID
- 页面 JS 无法通过篡改参数来越权查看他人数据
- 这是普通用户可以安全使用应用页面的**前提条件**

---

## 五、后端 API 设计

### 5.1 流程定义发布 API（核心变更）

#### 5.1.1 发布流程定义（新增）

```
POST /api/v1/workflow-definitions/{id}/publish
```

前置条件：
- 当前用户 = 流程定义所属应用的创建者（createdBy）
- 流程定义 status = DRAFT

行为：
1. 将当前 DRAFT 记录 status 改为 PUBLISHED
2. 自动创建一条新的 DRAFT 记录（version + 1，published_version_id 指向刚发布的记录）
3. 正在运行的旧版本实例不受影响（继续使用创建时的 definition_version）

响应：
```json
{
  "code": 0,
  "data": {
    "publishedVersion": 2,
    "draftVersion": 3,
    "message": "流程定义已发布，版本 v2 已生效"
  }
}
```

#### 5.1.2 查询流程定义（修改）

```
GET /api/v1/workflow-definitions?applicationId={id}
```

行为变更：返回应用下所有流程定义，每个定义包含其已发布版本和草稿版本的信息：

```json
{
  "code": 0,
  "data": [
    {
      "id": 1,
      "name": "报销审批",
      "applicationId": 1,
      "status": "PUBLISHED",
      "version": 2,
      "draftVersion": {
        "id": 3,
        "version": 3,
        "status": "DRAFT"
      }
    }
  ]
}
```

### 5.2 应用 API（简化）

#### 5.2.1 创建应用

```
POST /api/v1/applications
```

新建应用后自动初始化测试组织数据（角色）。

响应：

```json
{
  "code": 0,
  "data": {
    "id": 1,
    "name": "报销审批应用",
    "createdBy": 1,
    "slug": "expense",
    ...
  }
}
```

#### 5.2.2 查询应用列表

```
GET /api/v1/applications
```

行为变更（关键）：根据用户角色返回不同范围的应用列表。

**我是创建者**：返回所有我创建的应用，每个应用包含其所有流程定义（含 DRAFT 和 PUBLISHED），便于管理和编辑。

**我不是创建者**：返回所有包含已发布流程定义（`status = PUBLISHED`）的应用，每个应用仅包含其已发布版本的流程定义。看不到草稿版本。

响应中 `workflowCount` 和 `publishedWorkflowCount` 为查询时实时 COUNT 得出，不存储在 applications 表中。

```json
{
  "code": 0,
  "data": [
    {
      "id": 1,
      "name": "报销审批应用",
      "createdBy": 1,
      "workflowCount": 3,
      "publishedWorkflowCount": 2,
      ...
    },
    {
      "id": 2,
      "name": "请假审批应用",
      "createdBy": 2,
      "workflowCount": 2,
      "publishedWorkflowCount": 2,
      ...
    }
  ]
}
```

### 5.3 测试数据初始化 API（新增）

#### 5.3.1 为应用初始化测试组织数据

```
POST /api/v1/applications/{id}/init-test-data
```

前置条件：当前用户 = 应用创建者（createdBy）

行为：
1. 检查该应用是否已有角色数据，如果有则跳过
2. 检查全局部门、成员数据是否存在，如果不存在则创建
3. 为该应用创建默认角色（财务审批组、HR 审批组、高管审批组、部门负责人）

响应：
```json
{
  "code": 0,
  "data": {
    "initialized": true,
    "departments": 4,
    "members": 7,
    "roles": 4,
    "message": "测试数据初始化完成"
  }
}
```

#### 5.3.2 重置应用测试数据（可选）

```
POST /api/v1/applications/{id}/reset-test-data
```

前置条件：同上。会删除该应用的所有测试实例、任务和角色数据，重新初始化。

### 5.4 流程实例 API

#### 5.4.1 发起流程（修改）

```
POST /api/v1/workflow-instances
```

请求体不变：
```json
{
  "definitionId": 1,
  "formData": "{...}"
}
```

后端行为变更：
1. 通过 `definitionId` 找到关联的 WorkflowDefinition
2. 判断 `definition.status`：
   - `DRAFT` → 新实例 `is_test = true`（仅创建者可发起，用于测试）
   - `PUBLISHED` → 新实例 `is_test = false`（正式审批）
3. 记录 `definition_version` = 当前 definition.version
4. 从 `@AuthenticationPrincipal` 获取操作人（可能是模拟用户）

#### 5.4.2 查询我的实例（修改）

```
GET /api/v1/workflow-instances?applicationId={id}    ← 应用内查询
GET /api/v1/workflow-instances                        ← 跨应用查询（用于 /work 页面）
```

行为变更：
- `applicationId` 为可选参数，不传时返回当前用户在所有应用中的实例
- 仅返回 `is_test = false` 的实例（生产数据）
- 创建者可以额外通过 `?includeTest=true` 查看测试数据
- 跨应用查询时，响应中增加 `applicationName` 字段

#### 5.4.3 查询待审批/已处理任务（修改）

```
GET /api/v1/tasks?status=PENDING&applicationId={id}  ← 应用内查询
GET /api/v1/tasks?status=PENDING                      ← 跨应用查询（用于 /work 页面）
GET /api/v1/tasks?status=COMPLETED&applicationId={id}
GET /api/v1/tasks?status=COMPLETED
```

行为变更：
- `applicationId` 为可选参数，不传时返回当前用户在所有应用中的任务
- 通过 JOIN workflow_instances 过滤，仅返回 `is_test = false` 的任务（生产数据）
- 创建者可以额外通过 `?includeTest=true` 查看测试数据
- 当 ImpersonationFilter 生效（已成功模拟用户）时，自动视为 `includeTest=true`
- 跨应用查询时，响应中增加 `applicationName` 字段

### 5.5 用户模拟 API

#### 5.5.1 获取可模拟用户列表（新增）

```
GET /api/v1/applications/{id}/impersonatable-users
```

返回系统中所有可被模拟的用户列表（用于前端 DevToolbar 下拉选择）：

```json
{
  "code": 0,
  "data": [
    { "id": 1, "name": "管理员", "email": "admin@luban.com" },
    { "id": 2, "name": "张三", "email": "zhangsan@luban.com" },
    { "id": 3, "name": "李四", "email": "lisi@luban.com" }
  ]
}
```

前置条件：当前用户是应用创建者（不限制应用是否已发布，草稿版本流程均允许模拟）。

### 5.6 ImpersonationFilter 实现

**设计要点**：模拟能力不能仅依赖请求中的 `definitionId`，因为查看任务列表、实例列表等请求不包含 `definitionId`。改为从请求中提取 `applicationId`，再判断该应用下是否存在草稿版本流程。

```java
@Component
public class ImpersonationFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) {
        // 1. 获取当前认证用户
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof User currentUser)) {
            chain.doFilter(request, response);
            return;
        }

        // 2. 获取模拟目标用户 ID
        String impersonateId = request.getHeader("X-Impersonate-User-Id");
        if (impersonateId == null) {
            chain.doFilter(request, response);
            return;
        }

        // 3. 获取应用信息（从请求路径或参数中提取 applicationId）
        Long applicationId = extractApplicationId(request);
        if (applicationId == null) {
            chain.doFilter(request, response);
            return;
        }

        // 4. 检查当前用户是否是应用创建者
        Application app = applicationRepository.findById(applicationId).orElse(null);
        if (app == null || !currentUser.getId().equals(app.getCreatedBy())) {
            chain.doFilter(request, response);
            return;
        }

        // 5. 检查该应用下是否存在草稿版本流程（创建者始终可以模拟）
        boolean hasDraft = workflowDefinitionRepository
            .existsByApplicationIdAndStatus(applicationId, "DRAFT");
        if (!hasDraft) {
            chain.doFilter(request, response);
            return;
        }

        // 6. 查找目标用户并替换 SecurityContext
        User targetUser = userRepository.findById(Long.valueOf(impersonateId)).orElse(null);
        if (targetUser == null) {
            chain.doFilter(request, response);
            return;
        }

        // 7. 替换认证信息，同时保留原始用户用于审计
        request.setAttribute("impersonator", currentUser);
        UsernamePasswordAuthenticationToken newAuth =
            new UsernamePasswordAuthenticationToken(targetUser, null, Collections.emptyList());
        SecurityContextHolder.getContext().setAuthentication(newAuth);

        chain.doFilter(request, response);
    }
}
```

**关键变更**：从 `extractDefinitionId` 改为 `extractApplicationId`，使模拟能力覆盖所有应用内请求（任务列表、实例列表、发起流程等），而不是仅限携带 definitionId 的请求。

### 5.7 SecurityConfig 调整

```java
// ImpersonationFilter 在 JwtAuthFilter 之后、业务逻辑之前执行
http.addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);
http.addFilterAfter(impersonationFilter, JwtAuthFilter.class);
```

---

## 六、前端设计

> **注意**：本文档中所有页面组件均运行在 [workflow-3](./workflow-3_用户视角与权限菜单设计.md) 定义的 `AppLayout` 全局布局之下。顶部导航栏（应用中心、我的工作）由 AppLayout 统一提供，本文档各组件不自行渲染顶部导航。

### 6.1 应用类型定义更新

```typescript
// types/application.ts
export interface Application {
  id: number;
  name: string;
  createdBy: number;
  slug: string;
  icon: string;
  color: string;
  defaultPageId: number | null;
  createdAt: string;
  updatedAt: string;
  workflowCount: number;           // 不落库，Controller 查询时 COUNT 得出
  publishedWorkflowCount: number;  // 不落库，Controller 查询时 COUNT + WHERE status='PUBLISHED' 得出
}
```

### 6.2 流程定义类型定义更新

```typescript
// types/workflow.ts
export interface WorkflowDefinition {
  id: number;
  name: string;
  applicationId: number;
  status: 'DRAFT' | 'PUBLISHED';
  version: number;
  publishedVersionId: number | null;
  // ... 其他字段
  draftVersion?: {
    id: number;
    version: number;
    status: 'DRAFT';
  };
}
```

### 6.3 应用 Store 更新

```typescript
// stores/applicationStore.ts 新增
interface ApplicationState {
  publishDefinition: (definitionId: number) => Promise<void>;
  initTestData: (appId: number) => Promise<void>;
  resetTestData: (appId: number) => Promise<void>;
}
```

### 6.4 应用列表页面修改

参见 [workflow-3 §5](./workflow-3_用户视角与权限菜单设计.md#五应用中心application-hub) — 应用中心的完整 UI 设计。

在应用列表页面中，每个应用卡片：
- 应用的发布状态通过其关联的流程定义状态动态判断
- 已发布应用仍可进入编辑（草稿版本），不影响正在运行的已发布版本
- 创建者看到 [进入] [管理] 双按钮，非创建者仅看到 [进入]
- 创建者看到自己所有应用（含未发布），非创建者仅看到有已发布流程的应用

### 6.5 DevToolbar 组件（新增）

**显示条件**：当前用户是应用创建者，且应用内存在至少一个草稿版本（`status = DRAFT`）的流程定义。

**职责定位**：DevToolbar 负责**全局控制**（模拟用户选择、身份切换、版本状态展示），不负责流程操作（发起测试、发布等操作属于编辑器）。

**位置**：页面底部固定悬浮。在 `AppLayout` 中，DevToolbar 渲染在内容区的最底部，不遮挡顶部导航栏。z-index 低于顶部导航栏，高于页面内容。

```
┌──────────────────────────────────────────────────────────────────┐
│ 🛠 流程设计 | 当前模拟: 张三 ▼ | 切换回自己 | 草稿版本 v3       │
└──────────────────────────────────────────────────────────────────┘
```

功能：
- 显示当前草稿版本号
- 下拉选择要模拟的用户（仅草稿版本流程可用）
- 点击"切换回自己"恢复真实身份，清除 localStorage 中的模拟用户 ID
- 当前模拟状态持久化到 localStorage
- 仅在应用创建者可见

**与编辑器职责分离**：DevToolbar 不包含「发布」和「发起测试」按钮，这些操作属于流程编辑器（见 §6.7）。

### 6.6 axios 拦截器

```typescript
// api/client.ts 新增请求拦截器
api.interceptors.request.use((config) => {
  const impersonateId = localStorage.getItem('impersonate-user-id');
  if (impersonateId) {
    config.headers['X-Impersonate-User-Id'] = impersonateId;
  }
  return config;
});
```

### 6.7 发起流程入口（关键）

**当前问题**：流程设计页面没有"发起流程测试"的入口，开发者无法在 DevToolbar 模拟用户后直接发起流程实例进行端到端测试。

**设计方案**：根据流程定义状态和用户角色，在不同位置提供发起流程入口。

#### 6.7.1 入口位置

| 场景 | 入口位置 | 可见角色 | 产生的实例 |
|------|----------|----------|-----------|
| 草稿版本测试 | 流程编辑器顶部的「发起测试」按钮 | 仅创建者 | `is_test = true` |
| 已发布版本正式使用 | 应用首页/流程列表中的「发起流程」按钮 | 所有用户 | `is_test = false` |

#### 6.7.2 草稿版本 — 流程编辑器中的「发起测试」

在流程编辑器页面（设计流程的画布页面），顶部操作栏增加「发起测试」按钮：

```
┌──────────────────────────────────────────────────────────────────┐
│  ← 返回    |  报销审批 v3 (草稿)    |  [保存]  [发起测试]  [发布] │
└──────────────────────────────────────────────────────────────────┘
```

交互流程：
1. 开发者先在 DevToolbar 中选择要模拟的用户（如"张三"）
2. 点击「发起测试」按钮
3. 弹出该流程关联的表单填写页面
4. 以模拟用户"张三"的身份提交表单
5. 系统创建流程实例（`is_test = true`，`definition_version = 3`）
6. 开发者可在 DevToolbar 中切换模拟用户继续审批

**关键约束**：
- 「发起测试」按钮仅在 `status = DRAFT` 时可用
- 未选择模拟用户时，以创建者本人身份发起测试，`is_test = true`，发起人记录为创建者本人
- 已选择模拟用户时，以模拟用户身份发起，`is_test = true`，发起人记录为模拟用户

#### 6.7.3 已发布版本 — 应用首页的「发起流程」

普通用户进入应用后（路由 `/apps/:appId`，由 workflow-3 §6.2 的 AppUserPage 渲染），在流程列表页面看到已发布版本的流程，每条流程有「发起流程」按钮：

```
┌──────────────────────────────────────────────────────────────┐
│  报销审批应用                                                  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 报销审批                                 [发起流程]       │ │
│  │ 已发布版本 v2  ·  3 个审批节点                            │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 请假审批                                 [发起流程]       │ │
│  │ 已发布版本 v1  ·  2 个审批节点                            │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

点击后：
1. 弹出该流程关联的表单填写页面
2. 以当前登录用户真实身份提交
3. 系统创建流程实例（`is_test = false`，`definition_version` = 当前已发布版本号）

**关键约束**：
- 仅显示 `status = PUBLISHED` 的流程定义
- 开发者（创建者）在此页面也看到已发布版本，点击「发起流程」产生的是 `is_test = false` 的正式实例
- 开发者如需测试草稿版本，应使用流程编辑器中的「发起测试」

#### 6.7.4 开发者视角的特殊处理

开发者在流程列表页面会同时看到两种入口：

```
┌──────────────────────────────────────────────────────────────┐
│  报销审批应用 (开发者视角)                                      │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 报销审批                                   [编辑草稿]    │ │
│  │ 已发布版本 v2  |  草稿版本 v3 (编辑中)      [发起流程]    │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

- 「发起流程」→ 使用已发布版本 v2，产生正式实例（`is_test = false`）
- 「编辑草稿」→ 进入流程编辑器，在编辑器中使用「发起测试」测试草稿 v3

### 6.8 测试数据标识

在流程实例和任务列表中：

- 测试数据行（`is_test = true`）：左侧有橙色竖线标记
- 表格顶部提示："当前为草稿版本测试数据"
- 实例详情页顶部 Banner："此实例为测试数据"

### 6.9 发布流程定义对话框

```
┌──────────────────────────────────────┐
│       发布流程定义 v3                  │
│                                      │
│  将草稿版本 v3 发布为新的已发布版本。    │
│                                      │
│  • 当前已发布版本 v2 将被替换           │
│  • 正在运行的 v2 实例不受影响           │
│  • 新发起的流程将使用 v3               │
│                                      │
│          [取消]    [确认发布]          │
└──────────────────────────────────────┘
```

### 6.10 流程定义列表（版本信息展示）

在流程定义列表中，每个流程显示版本状态：

```
┌─────────────────────────────────────────────────────┐
│ 报销审批                                             │
│ 已发布版本: v2  |  草稿版本: v3 (编辑中)              │
│                                    [发布草稿 v3]     │
└─────────────────────────────────────────────────────┘
```

### 6.11「我的工作」页面集成

**参见**：[workflow-3 §10.5](./workflow-3_用户视角与权限菜单设计.md#105-myworkpage-全局我的工作) — 全局"我的工作"页面的 UI 设计。

「我的工作」页面（`/work`，我发起的/待审批/已处理三个标签页）需与 `is_test` 标记和模拟功能集成：

**默认行为**：仅展示 `is_test = false` 的生产数据（通过 JOIN workflow_instances 过滤）。跨应用汇总所有流程实例，表格包含"应用"列（详见 workflow-3 §10.5）。

**开发者模拟时**：当 ImpersonationFilter 生效（DevToolbar 已选择模拟用户且请求头携带 `X-Impersonate-User-Id`），后端自动返回 `is_test = true` 的测试数据，而非生产数据。开发者无需手动切换视图。

**视觉标识**：测试数据行左侧有橙色竖线标记，顶部显示"当前为测试数据视图"提示（详见 §6.13.5）。

**切换回自己后**：清除模拟状态，恢复展示生产数据。

**与 workflow-3 的关系**：本文档定义 `is_test` 过滤和模拟视图切换的**后端逻辑**，workflow-3 定义页面的**布局、导航、CSS**。实施时前端组件放在 `/work` 路由下，由 AppLayout 包裹。

### 6.12 表单定义版本化（本期策略）

**问题**：流程定义发布时关联的表单定义可能已变更，存在版本不一致风险。

**本期策略**（最小化方案）：流程定义发布时，**复制一份表单定义的快照**（JSON 序列化），作为已发布版本的内嵌表单。草稿版本继续引用原始表单，可自由修改。

- 已发布流程 → 使用快照表单，不受后续表单修改影响
- 草稿流程 → 引用最新表单，可联动修改

**后续版本**：表单定义独立版本化，与流程定义解耦。

### 6.13 UI 设计规范

本节定义 workflow-2 新增组件的 UI 规范，所有样式必须与现有页面保持一致。

#### 6.13.1 设计系统（Design Tokens）

以下 tokens 从现有页面（MyWorkflow、ProcessList、FormList、AppListPage）提取，是本项目的事实标准：

| 类别 | Token | 值 | 用途 |
|------|-------|----|------|
| **背景色** | `--bg-page` | `#f4f6f9` | 页面背景 |
| | `--bg-card` | `#fff` | 卡片/面板背景 |
| | `--bg-table-header` | `#fafafa` | 表头背景 |
| | `--bg-hover` | `#fafafa` | 行悬停背景 |
| **主色** | `--primary` | `#1677ff` | 主按钮、激活态、链接 |
| | `--primary-hover` | `#4096ff` | 主按钮悬停 |
| | `--primary-light` | `#e6f4ff` | 浅蓝背景（avatar、tag） |
| **文字** | `--text-primary` | `#1f1f1f` | 标题、正文 |
| | `--text-secondary` | `#5a6a7e` | 次要文字、标签 |
| | `--text-muted` | `#8c9cab` | 占位符、辅助文字 |
| **边框** | `--border` | `#e8edf3` | 卡片边框、分割线 |
| | `--border-light` | `#eee` | 卡片外边框 |
| **阴影** | `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.04)` | 轻微阴影 |
| | `--shadow-md` | `0 1px 3px rgba(0,0,0,0.06)` | 常规阴影 |
| | `--shadow-hover` | `0 4px 16px rgba(0,0,0,0.1)` | 卡片悬停 |
| **圆角** | `--radius-sm` | `4px` | 标签、小按钮 |
| | `--radius-md` | `6px` | 按钮、输入框、卡片 |
| | `--radius-lg` | `8px` | 大卡片 |
| **字号** | `--text-xs` | `12px` | 表头、标签 |
| | `--text-sm` | `13px` | 正文、按钮 |
| | `--text-md` | `14px` | 标题 |
| | `--text-lg` | `18px` | 页面标题 |
| **间距** | `--pad-page` | `20px 16px`（≥640px: `24px`，≥1024px: `32px`） | 页面内边距 |
| | `--pad-card` | `20px` | 卡片内边距 |
| | `--pad-cell` | `12px 16px` | 表格单元格 padding |
| | `--pad-btn` | `6px 16px` | 按钮 padding |
| **状态色** | `--status-pending` | `#faad14` / `#fffbe6` | 待审批 |
| | `--status-running` | `#3b82f6` / `#eff6ff` | 进行中 |
| | `--status-completed` | `#52c41a` / `#f6ffed` | 已完成 |
| | `--status-rejected` | `#cf1322` / `#fff2f0` | 已驳回 |
| | `--status-draft` | `#8c9cab` / `#fafafa` | 草稿 |

#### 6.13.2 DevToolbar UI 规范

**定位**：页面底部固定悬浮，`position: fixed; bottom: 0; left: 0; right: 0; z-index: 99`（低于 workflow-3 顶部导航栏的 `z-index: 100`，高于页面内容）

**完整 CSS**：

```css
.devtoolbar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 99;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  border-top: 1px solid #e8edf3;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.06);
  font-size: 13px;
  color: #5a6a7e;
}

.devtoolbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.devtoolbar-label {
  font-size: 12px;
  font-weight: 600;
  color: #8c9cab;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.devtoolbar-label::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #faad14;
}

.devtoolbar-version {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  background: #e6f4ff;
  border: 1px solid #91caff;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  color: #1677ff;
}

.devtoolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.devtoolbar-user-select {
  padding: 4px 8px;
  border: 1px solid #e8edf3;
  border-radius: 6px;
  font-size: 13px;
  color: #1f1f1f;
  background: #fff;
  outline: none;
  cursor: pointer;
  min-width: 120px;
}

.devtoolbar-user-select:focus {
  border-color: #1677ff;
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.1);
}

.devtoolbar-restore-btn {
  padding: 4px 12px;
  border: 1px solid #e8edf3;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  color: #5a6a7e;
  cursor: pointer;
  transition: all 0.15s;
}

.devtoolbar-restore-btn:hover {
  border-color: #1677ff;
  color: #1677ff;
  background: #f0f5ff;
}
```

**布局示意**：

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🛠 流程设计  │  草稿版本 v3  │          │  当前模拟: 张三 ▼  │ 切换回自己 │
└──────────────────────────────────────────────────────────────────────────┘
  ↑ 左侧：标签+版本号                                    ↑ 右侧：模拟控制
```

**关键交互**：
- 选择模拟用户后，下拉框边框变为 `#1677ff`，右侧出现"切换回自己"按钮
- 切换回自己后，下拉框恢复默认边框，按钮消失
- 模拟状态通过 localStorage 持久化，刷新页面不丢失

#### 6.13.3 发布流程对话框 UI 规范

**完整 CSS**：

```css
.publish-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}

.publish-dialog {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  width: 440px;
  max-width: 90vw;
  overflow: hidden;
}

.publish-dialog-header {
  padding: 20px 24px 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.publish-dialog-body {
  padding: 16px 24px;
  font-size: 13px;
  color: #5a6a7e;
  line-height: 1.6;
}

.publish-dialog-info {
  background: #fafafa;
  border: 1px solid #e8edf3;
  border-radius: 6px;
  padding: 12px 16px;
  margin-top: 12px;
  font-size: 13px;
  color: #1f1f1f;
}

.publish-dialog-info-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
}

.publish-dialog-info-row + .publish-dialog-info-row {
  border-top: 1px solid #e8edf3;
  margin-top: 4px;
  padding-top: 8px;
}

.publish-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 24px;
  border-top: 1px solid #e8edf3;
  background: #fafafa;
}

.publish-dialog-cancel {
  padding: 6px 16px;
  border: 1px solid #e8edf3;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  color: #5a6a7e;
  cursor: pointer;
  transition: all 0.15s;
}

.publish-dialog-cancel:hover {
  border-color: #1677ff;
  color: #1677ff;
}

.publish-dialog-confirm {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  background: #1677ff;
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  cursor: pointer;
  transition: all 0.15s;
}

.publish-dialog-confirm:hover {
  background: #4096ff;
}
```

#### 6.13.4 编辑器顶部操作栏 UI 规范

流程编辑器顶部栏（草稿版本）：

```
┌──────────────────────────────────────────────────────────────────┐
│  ← 返回    │  报销审批 v3 (草稿)    │  [保存]  [发起测试]  [发布] │
└──────────────────────────────────────────────────────────────────┘
```

```css
.editor-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: #fff;
  border-bottom: 1px solid #e8edf3;
  height: 44px;
}

.editor-topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.editor-topbar-back {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border: 1px solid #e8edf3;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  color: #5a6a7e;
  cursor: pointer;
  transition: all 0.15s;
}

.editor-topbar-back:hover {
  border-color: #1677ff;
  color: #1677ff;
}

.editor-topbar-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f1f1f;
}

.editor-topbar-version-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  background: #fffbe6;
  border: 1px solid #ffe58f;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  color: #ad6800;
}

.editor-topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.editor-topbar-btn {
  padding: 5px 14px;
  border: 1px solid #e8edf3;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  color: #5a6a7e;
  cursor: pointer;
  transition: all 0.15s;
}

.editor-topbar-btn:hover {
  border-color: #1677ff;
  color: #1677ff;
}

.editor-topbar-btn-primary {
  composes: editor-topbar-btn;
  background: #1677ff;
  border-color: #1677ff;
  color: #fff;
}

.editor-topbar-btn-primary:hover {
  background: #4096ff;
  border-color: #4096ff;
  color: #fff;
}

.editor-topbar-btn-test {
  composes: editor-topbar-btn;
  background: #fffbe6;
  border-color: #ffe58f;
  color: #ad6800;
}

.editor-topbar-btn-test:hover {
  background: #fff7cc;
  border-color: #ffd666;
  color: #874d00;
}
```

#### 6.13.5 测试数据标识 UI 规范

测试数据行视觉标识（用于"我的工作"页面和流程列表）：

```css
.test-row {
  border-left: 3px solid #faad14;
  background: rgba(250, 173, 20, 0.03);
}

.test-row:hover td {
  background: rgba(250, 173, 20, 0.06) !important;
}

.test-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: #fffbe6;
  border: 1px solid #ffe58f;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  color: #ad6800;
}

.test-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: #fffbe6;
  border-bottom: 1px solid #ffe58f;
  font-size: 12px;
  color: #ad6800;
}

.test-banner-close {
  padding: 2px 8px;
  border: 1px solid #ffe58f;
  border-radius: 4px;
  background: #fff;
  font-size: 11px;
  color: #ad6800;
  cursor: pointer;
}
```

**布局示意**（测试数据视图顶部提示）：

```
┌─────────────────────────────────────────────────────────────────┐
│ ⚠ 当前为测试数据视图（草稿版本 v3）                      [退出]  │
└─────────────────────────────────────────────────────────────────┘
```

#### 6.13.6 流程定义列表版本展示 UI 规范

```css
.version-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #5a6a7e;
}

.version-published {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: #f6ffed;
  border: 1px solid #b7eb8f;
  border-radius: 4px;
  color: #389e0d;
  font-weight: 500;
}

.version-draft {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: #fffbe6;
  border: 1px solid #ffe58f;
  border-radius: 4px;
  color: #ad6800;
  font-weight: 500;
}

.version-separator {
  color: #e8edf3;
}
```

```
┌─────────────────────────────────────────────────────────────────┐
│ 报销审批                                                         │
│ 已发布版本: v2    │   草稿版本: v3 (编辑中)                       │
│                                       [发布草稿 v3]              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 七、用户流程

### 7.1 设计并测试流程（首次发布）

```
1. 开发者登录 → 进入应用中心 `/apps`（见 workflow-3 §5）
2. 点击自己创建的应用「管理」→ 进入开发者视图 `/apps/:appId`
3. 系统自动初始化测试数据（部门、成员、角色）
4. 在应用中设计表单
5. 设计审批流程，关联表单，指定审批角色（此时流程 status = DRAFT, version = 1）
6. 打开 DevToolbar，模拟用户"张三"
7. 以张三身份发起流程 → 填写表单 → 提交（is_test = true）
8. 切换到模拟用户"李四"
9. 通过顶部导航栏进入「我的工作」`/work` → 待审批（见 workflow-3 §10.5），以李四身份审批通过
10. 切换到模拟用户"王五"
11. 以王五身份会签通过
12. 切回自己，通过顶部导航栏回到应用 `/apps/:appId`，验证流程完整链路正确
13. 点击编辑器顶部「发布」
14. 流程定义 DRAFT v1 → PUBLISHED v1，同时自动创建 DRAFT v2
15. 普通用户可在应用中心看到该应用，进入 `/apps/:appId` 看到已发布流程并发起正式审批（见 workflow-3 §6.2）
```

### 7.2 修改已发布流程（边运行边调整 — 核心场景）

```
已有状态：
  报销审批流程：已发布版本 v2（用户正在使用），草稿版本 v3（与 v2 相同，等待修改）

1. 开发者在流程定义列表中找到"报销审批"
2. 看到：已发布版本 v2  |  草稿版本 v3（编辑中）
3. 点击编辑，进入草稿版本 v3
4. DevToolbar 显示"草稿版本 v3"
5. 修改流程：增加一个审批节点、调整流转条件
6. 在 DevToolbar 中选择模拟用户"张三"
7. 点击编辑器顶部「发起测试」，以张三身份提交测试流程（is_test = true）
8. 在 DevToolbar 中切换到模拟用户"李四"
9. 通过顶部导航栏进入「我的工作」`/work` →「待审批」，此时自动展示测试数据，李四看到待审批的测试任务
10. 以李四身份审批通过
11. 通过顶部导航栏回到应用 `/apps/:appId`，验证新流程逻辑正确
12. 此时，普通用户仍在正常使用已发布版本 v2，完全不受影响
13. 点击编辑器顶部「发布 v3」
14. 草稿 v3 → PUBLISHED v3（替换 v2），自动创建 DRAFT v4
15. 新发起的正式流程使用 v3，正在运行的 v2 实例继续使用 v2 直到完成
16. 开发者如有需要，可以继续在 v4 草稿上调整
```

### 7.3 普通用户视角

```
1. 登录系统 → 进入应用中心 `/apps`（见 workflow-3 §5）
2. 看到所有有已发布流程的应用卡片
3. 点击应用「进入」→ 进入普通用户视图 `/apps/:appId`（见 workflow-3 §6.2）
4. 看到该应用的已发布流程列表，每条流程有「发起流程」按钮
5. 点击「发起流程」→ 填写表单 → 提交（is_test = false）
6. 可在顶部导航栏进入「我的工作」`/work` 查看跨应用的所有工单（见 workflow-3 §7）
7. 看不到 DevToolbar、看不到草稿版本、看不到代码编辑器
8. 所有操作都是真实身份，不可模拟
```

### 7.4 多应用开发者视角

```
1. 开发者创建应用 A（报销审批），自动初始化测试数据
2. 在应用 A 中设计报销流程，模拟用户测试
3. 发布应用 A 的报销流程（status → PUBLISHED）
4. 创建应用 B（请假审批），自动初始化测试数据
5. 在应用 B 中设计请假流程，模拟用户测试
6. 回到应用 A，在草稿版本上继续调整报销流程
7. 应用 A 的已发布版本继续运行，不受草稿修改影响
8. 应用 A 的角色数据与应用 B 完全隔离
```

---

## 八、测试数据初始化方案

### 8.1 问题描述

当前 `DataInitializer` 实现 `CommandLineRunner`，在应用启动时统一创建测试数据：

- 部门（4 个）：总经办、技术部、财务部、人事部
- 成员（7 个）：周九(CEO)、张三(技术总监)、李四(财务经理)、赵六(HR总监)、王五(高级工程师)、孙七(会计)、钱八(HR专员)
- 角色（4 个）：财务审批组、HR 审批组、高管审批组、部门负责人

**问题**：角色创建时 `applicationId` 硬编码为 `1`，导致只有 applicationId=1 的应用拥有角色数据。后续每个开发者创建新应用时，无法获取角色数据，端到端测试无法进行。

### 8.2 解决方案：按应用懒加载初始化

**核心思路**：部门（departments）和成员（members）保持全局共享（所有应用复用同一套测试用户体系），角色（roles）改为按应用懒加载初始化。

**触发时机**：
- 方案 A（推荐）：创建应用时自动初始化。`POST /api/v1/applications` 返回后，前端自动调用 `POST /api/v1/applications/{id}/init-test-data`
- 方案 B：首次进入应用的工作流模块时自动初始化。前端检测到应用无角色数据时调用初始化接口
- 方案 C：用户在应用页面手动点击"初始化测试数据"按钮

建议采用方案 A + C 组合：创建应用时自动初始化，同时提供手动重置按钮。

### 8.3 初始化逻辑

```
initTestData(applicationId):
  1. 检查全局部门数据是否存在
     - 不存在 → 创建 4 个部门
  2. 检查全局成员数据是否存在
     - 不存在 → 创建 7 个成员，关联部门
  3. 检查该 applicationId 是否已有角色
     - 已有 → 跳过，返回"已初始化"
  4. 为该 applicationId 创建 4 个角色：
     - 财务审批组（成员：李四、孙七）
     - HR 审批组（成员：赵六、钱八）
     - 高管审批组（成员：周九）
     - 部门负责人（成员：张三、李四、赵六、周九）
  5. 返回初始化结果
```

### 8.4 代码层面改造

原有 `DataInitializer`（CommandLineRunner）中的角色初始化逻辑移除，改为 `TestDataService`：

- `TestDataService.initApplicationTestData(Long applicationId)` — 为指定应用初始化角色
- `TestDataService.resetApplicationTestData(Long applicationId)` — 重置指定应用的测试数据
- `TestDataService.ensureGlobalOrgData()` — 确保全局部门、成员数据存在（幂等）

### 8.5 数据隔离保证

| 数据类型 | 隔离方式 | 说明 |
|----------|----------|------|
| 部门 | 全局共享 | 所有应用共用同一套部门结构 |
| 成员 | 全局共享 | 所有应用共用同一套测试用户 |
| 角色 | 按 applicationId 隔离 | 每个应用有独立的角色定义 |
| 流程实例 | 按 is_test + applicationId 隔离 | 草稿版本实例标记 is_test=true |
| 流程任务 | 继承父实例 | 通过 JOIN workflow_instances 获取 is_test，避免数据不一致 |

---

## 九、实施计划

### 9.1 阶段划分

> **与 workflow-3 的关系**：本文档的 Phase 6-9 依赖 workflow-3 的 Phase 1-2（AppLayout + 路由重构）先完成。实施顺序：先完成全局导航框架（workflow-3），再在此框架内实现版本化功能（本文档）。

| 阶段 | 内容 | 预估工时 | 依赖 |
|------|------|----------|------|
| **Phase 1** | 后端数据模型变更（WorkflowDefinition 加 status/version/published_version_id、Instance 加 is_test/definition_version） | 2h | 无 |
| **Phase 2** | 后端 TestDataService 实现（按应用初始化测试数据，替代 DataInitializer 角色部分） | 2h | Phase 1 |
| **Phase 3** | 后端 ImpersonationFilter 实现（基于 applicationId 判断，替代 definitionId） | 3h | Phase 1 |
| **Phase 4** | 后端 API 改造（流程定义发布/版本管理/表单快照、列表过滤、发起流程标记、测试数据初始化） | 5h | Phase 1 |
| **Phase 5** | 前端类型定义和 API 层更新 | 2h | 无 |
| **Phase 6** | 前端 DevToolbar 组件（版本显示、模拟用户选择、身份切换，嵌入 AppLayout） | 3h | workflow-3 Phase 1 |
| **Phase 7** | 前端流程编辑器改造（发起测试入口、发布按钮、草稿/已发布切换） | 3h | workflow-3 Phase 2 |
| **Phase 8** | 前端「我的工作」页面集成（is_test 过滤、测试数据视图切换、视觉标识，路由 `/work`） | 2h | workflow-3 Phase 5 |
| **Phase 9** | 前端测试数据标识 | 2h | Phase 6 |
| **Phase 10** | 联调测试（与 workflow-3 联合测试开发者/普通用户双视角完整链路） | 3h | 全部 |

### 9.2 数据库迁移

```sql
-- 1. workflow_definitions 加版本化字段
ALTER TABLE workflow_definitions ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'DRAFT';
ALTER TABLE workflow_definitions ADD COLUMN version INT NOT NULL DEFAULT 1;
ALTER TABLE workflow_definitions ADD COLUMN published_version_id BIGINT NULL;

-- 2. workflow_instances 加 is_test 和 definition_version 字段
ALTER TABLE workflow_instances ADD COLUMN is_test BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE workflow_instances ADD COLUMN definition_version INT NOT NULL DEFAULT 1;

-- 3. 已有数据迁移：已有的流程定义标记为 PUBLISHED v1
-- UPDATE workflow_definitions SET status = 'PUBLISHED', version = 1 WHERE id IN (...);

-- 注意：drop_workspace_migration.sql 应在此迁移之前执行
-- （该脚本已完成 applications 去 workspaceId、workflow_roles 去 workspaceId 改为 applicationId）
```

### 9.3 兼容性

- 已有流程定义默认 `status = 'DRAFT'`、`version = 1`，如已有生产数据需手动标记为 PUBLISHED
- 已有实例和任务默认 `is_test = false`，不影响现有数据
- 已有应用的角色数据（applicationId=1）保持不变
- API 响应增加字段，前端需同步更新类型定义
- 新建应用自动初始化测试数据，无需手动干预

---

## 十、风险与待讨论

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 版本膨胀 | 每次发布创建新版本记录，workflow_definitions 表增长 | 定期归档旧版本，或保留最近 N 个版本 |
| 应用创建者离职/转岗 | 无人能管理该应用 | 后续考虑应用管理员多人机制 |
| 模拟用户发起真实审批 | 测试数据混入生产 | 草稿版本实例标记 is_test，已发布版本忽略模拟头 |
| 草稿版本被误发布 | 不完整的流程被普通用户使用 | 发布前检查流程完整性（后续版本） |
| 多个应用的角色数据膨胀 | 每个应用创建 4 条角色记录 | 数量可控，后续可增加清理机制 |
| 测试数据初始化失败 | 新应用无法测试 | 提供手动重试按钮，前端友好提示 |
| 版本切换时正在运行的实例 | 旧版本实例引用已被替换的流程定义 | 实例记录 definition_version，不依赖流程定义状态 |

### 待讨论问题

1. **是否需要应用成员角色？** 当前只有 createdBy 概念，后续是否需要"管理员"、"设计者"、"普通成员"等角色来控制谁可以模拟和编辑？
2. **发布前校验**：是否需要校验流程定义完整性（如所有节点都有审批人）才能发布？
3. **版本回滚**：是否需要支持回滚到历史版本？
4. **测试数据清理**：应用删除时是否需要级联删除其测试角色、实例和任务？是否需要定期清理长时间未使用的测试数据？
5. **表单定义的版本化**：表单定义是否也需要和流程定义一样的版本化机制？

---

## 十一、验收标准

1. 新建应用，创建者可见 DevToolbar
2. 新建应用自动初始化测试数据（部门、成员、角色），无需手动操作
3. 创建者可在草稿版本流程上通过编辑器「发起测试」按钮发起测试实例
4. 模拟操作产生 `is_test = true` 的实例和任务
5. 发布流程定义后，status 变为 PUBLISHED，自动创建新 DRAFT 版本，同时创建表单快照
6. 已发布版本流程中，`X-Impersonate-User-Id` 头被忽略
7. 普通用户可在应用列表中看到有已发布流程的应用，通过「发起流程」按钮发起正式实例
8. 普通用户看不到 DevToolbar 和草稿版本
9. 非创建者用户在任何情况下都看不到 DevToolbar
10. 已发布流程在运行中，开发者修改草稿版本不影响已发布版本的运行
11. 发布新版本后，新发起的流程使用新版本，正在运行的旧版本实例继续使用旧版本
12. 创建者模拟用户后，「我的工作」页面自动展示测试数据
13. 创建者切换回自己后，「我的工作」页面恢复展示生产数据
14. 不同应用的角色数据相互隔离，应用 A 的角色不影响应用 B
15. 提供"初始化测试数据"和"重置测试数据"按钮，支持手动操作

---

## 十二、Agent 技能调整

以下改动涉及鲁班平台的 Agent 技能系统，需在实施本文档和 workflow-3 时同步调整。

### 12.1 涉及技能清单

| 技能 | 影响范围 | 说明 |
|------|----------|------|
| `carocut-builder-compositor` | Query 模板生成 | 生成 Query 时需使用 `this.auth.userId` 而非 `this.params.userId` |
| `carocut-builder-pipeline` | 资源生成 | 生成的 resourceMap 和 constants 需遵循新的安全命名空间 |
| `carocut-planner-planning` | 页面设计 | 规划页面时需区分开发者视图和普通用户视图，普通用户页面不可包含 Query 入口 |
| `carocut-shared-schema` | 协议定义 | 模板上下文需增加 `auth` 命名空间定义 |

### 12.2 Query 模板生成规则变更（carocut-builder-compositor）

**变更前**：Agent 生成 Query 时，用户身份参数通过 `this.params` 传入：

```sql
-- 旧写法（不安全）
SELECT * FROM expenses WHERE user_id = {{ this.params.userId }}
```

**变更后**：身份参数必须使用 `this.auth` 命名空间，业务参数使用 `this.params`：

```sql
-- 新写法（安全）
SELECT * FROM expenses
WHERE user_id = {{ this.auth.userId }}
  AND status = {{ this.params.status }}
  AND amount > {{ this.params.minAmount }}
```

**规则**：

| 参数类型 | 模板语法 | 示例 |
|----------|----------|------|
| 当前用户 ID | `{{ this.auth.userId }}` | `WHERE user_id = {{ this.auth.userId }}` |
| 当前用户名 | `{{ this.auth.userName }}` | `WHERE operator = {{ this.auth.userName }}` |
| 当前用户邮箱 | `{{ this.auth.userEmail }}` | `WHERE email = {{ this.auth.userEmail }}` |
| 业务过滤条件 | `{{ this.params.xxx }}` | `WHERE status = {{ this.params.status }}` |
| 分页参数 | `{{ this.params.page }}` / `{{ this.params.pageSize }}` | `LIMIT {{ this.params.pageSize }}` |

**Agent 技能提示词需增加**：
```
在生成 SQL 查询模板时，涉及当前登录用户身份的过滤条件，必须使用 {{ this.auth.userId }}，
不可使用 {{ this.params.userId }}。this.auth 的三个字段（userId, userName, userEmail）
由后端 SecurityContext 强制注入，不可被前端篡改。this.params 用于业务参数。
```

### 12.3 资源生成规则变更（carocut-builder-pipeline）

生成 `resourceMap.ts` 时，Query 的默认参数声明中不可包含 `userId` 作为 `this.params`：

```typescript
// 变更前（不安全）
const resourceMap = {
  getMyExpenses: {
    queryId: 1,
    params: {
      userId: null,  // ❌ 不可信，删除
      status: "approved",
    },
  },
};

// 变更后（安全）
const resourceMap = {
  getMyExpenses: {
    queryId: 1,
    params: {
      status: "approved",  // 业务参数，保留
    },
    // userId 由 this.auth.userId 自动注入，无需声明
  },
};
```

### 12.4 页面规划规则变更（carocut-planner-planning）

普通用户视图（AppUserPage）的页面规划需遵循以下规则：

1. **页面优先**：规划的页面是用户的主要交互界面（表单、看板、数据展示），不是流程列表
2. **无 Query 入口**：普通用户看不到 Query 列表、数据源管理，页面中使用的 Query 是透明的
3. **流程为辅助**：流程入口（发起审批）是页面的附属功能，位于顶部操作栏
4. **用户身份安全**：页面中的 Query 必须使用 `this.auth.userId` 获取用户身份
5. **开发者视图独立**：开发者看到的 AppEditorPage（含侧边栏、代码编辑器、Query 管理）与普通用户视图完全隔离

### 12.5 协议定义变更（carocut-shared-schema）

Storyboard schema 中增加 `auth` 上下文定义：

```typescript
// 模板上下文新增
interface TemplateContext {
  params: Record<string, unknown>;  // 页面 JS 传入的业务参数（不可信）
  auth: {                           // 后端 SecurityContext 注入（可信）
    userId: number;
    userName: string;
    userEmail: string;
  };
}
```

### 12.6 实施优先级

| 优先级 | 技能 | 改动 | 原因 |
|--------|------|------|------|
| P0 | carocut-builder-compositor | Query 模板语法变更 | 安全漏洞，必须立即修复 |
| P0 | carocut-shared-schema | auth 上下文定义 | 所有技能依赖此协议 |
| P1 | carocut-builder-pipeline | resourceMap 生成规则 | 依赖 compositor 的模板变更 |
| P2 | carocut-planner-planning | 普通用户视图规划 | 可在 workflow-3 实施时同步调整 |