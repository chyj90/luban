# 需求文档：API 编排（可视化 + Agent 智能编排 + Python 沙箱）

## 版本

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-09-09 | 初稿：领域模型 / DSL / 执行引擎 / 沙箱复用 / 可视化与 Agent 编排 / 安全设计 / 实施计划 |
| v1.1 | 2026-09-10 | 设计哲学定稿（备菜/烹饪）+ workflow 节点；M1-M3 实施完成并 E2E 验证（见附录 A） |

---

## 一、背景与目标

### 1.1 现状

平台开发工具已具备三大件：**页面**（代码页面 + Agent 生成）、**流程**（可视化设计器 + 条件分支 + 审批）、**接入**（REST API 工具、Query）。缺少**编排**能力：把多个 API/Query/自定义逻辑组合成一个新 API 的能力。现有痛点：

- 多步骤业务逻辑（取数 → 清洗 → 调外部 API → 合并返回）只能写死在页面 JS 里，无法复用、无法对外提供；
- 复杂转换需要 Python，但平台没有受控的 Python 执行通道；
- embedding-service 已有成熟的 Docker 沙箱池（`SandboxPool`），目前仅服务于向量/文档解析，利用率低。

### 1.2 目标

1. **可视化编排**：拖拽式画布（复用流程设计器的 React Flow 体系），节点 = API 调用 / Query / Python / 数据变换 / 分支 / 合并；
2. **Agent 智能编排**：用户用自然语言描述编排需求，Agent 自动设计、校验、试运行、发布（复用平台既有的"设计-校验-试运行-发布"闭环模式）；
3. **Python 节点**：编排内可写 Python 代码，执行复用 embedding-service 的沙箱池（容器级隔离）；
4. **双消费面**：编排产物是平台一等公民工具（ToolDefinition），应用内页面可直接调用；对外通过平台 API Key 数据面提供（复用既有申请-审批-绑定模型）；
5. **安全内建**：权限、沙箱、SSRF、凭据、频控、审计六个面全部按"默认拒绝"设计（沿用安全架构 v1.2 的 AppAccess 体系）。

### 1.3 非目标（本期不做）

- 编排的定时触发/事件触发（后续版本）；
- 分布式/长事务编排（单请求同步语义，总时长上限 60s）；
- Python 自定义第三方包安装（白名单镜像，按需扩包走运维流程）。

---

## 二、整体架构

```
┌─ 可视化编辑器（React Flow）─┐   ┌─ Agent 智能编排（orchestration-assistant）─┐
│  画布/节点面板/属性抽屉     │   │  自然语言 → DSL 生成 → lint → 试运行 → 发布  │
└────────────┬───────────────┘   └──────────────┬──────────────────────────────┘
             │      OrchestrationDSL (JSON)     │
             ▼                                   ▼
   ┌─────────────────────────────────────────────────────┐
   │  编排服务（backend）                                  │
   │  ├─ 定义 CRUD + 版本 + 发布（→ ToolDefinition）      │
   │  ├─ lint（结构/引用/安全静态检查）                     │
   │  ├─ 试运行（testRun：注入样例输入，单次执行）          │
   │  └─ 执行引擎（拓扑解释执行）                           │
   │       ├─ HttpNode   → SSRF 校验 + 出站调用            │
   │       ├─ QueryNode  → 复用既有 Query 定义（参数化）    │
   │       ├─ PythonNode → embedding-service 沙箱池        │
   │       ├─ TransformNode → JSON 映射/模板（纯 Java）     │
   │       └─ Branch/Merge → 条件路由（复用 ConditionEval…）│
   └───────────────┬───────────────────────┬───────────────┘
                   │ 应用内消费              │ 外部消费
                   ▼                        ▼
        页面 runTool / DataQuery      /api/v1/orchestrations/{id}/invoke
        （AppAccess: RUN + 页面授权）   （X-API-Key 数据面 + APPROVED 审批）
```

---

## 三、领域模型

| 实体 | 说明 | 关键字段 |
|------|------|----------|
| `OrchestrationDefinition` | 编排定义（应用内资源，scope=APPLICATION） | id, name, applicationId, currentVersionId, status(DRAFT/PUBLISHED/ARCHIVED), createdBy |
| `OrchestrationVersion` | 不可变版本（每次保存生成新版本，发布即固定版本） | id, definitionId, version, dsl(JSON), checksum, createdAt |
| `OrchestrationExecution` | 执行记录（审计 + 调试） | id, definitionId, versionId, trigger(USER_TEST/RUNTIME/API_KEY), inputs(脱敏), nodeTrace(JSON), status, durationMs, errorCode |
| **发布产物** | 发布后在 `ToolDefinition` 落一条 `toolType=ORCHESTRATION` 记录 | config 存 `{orchestrationId, versionId}`；inputSchema/outputSchema 由 DSL 的 start/output 节点推导 |

复用既有设施：发布物进 ToolDefinition 统一注册表 → 应用内 `runTool`、外部 API Key 审批（`ApiKeyTool`）、Agent 工具搜索全部天然生效；`AppResourceResolver` 新增 `orchestration` 类型（definitionId → applicationId），权限体系零特例。

### 3.1 版本语义

- 保存 = 新版本（DRAFT 链）；发布 = 将某版本标记 PUBLISHED 并同步 ToolDefinition 指向该 versionId；
- 已发布版本不可修改（保证外部调用方契约稳定）；升级走"新版本 → 再发布"；
- 执行记录绑定 versionId，任何一次调用可回溯到确切 DSL。

---

## 四、编排 DSL（JSON）

节点类型（`nodeType`）与边（`edges`）沿用流程设计器的 React Flow 结构（nodes/edges/position/data.config），降低前端与 Agent 的学习成本。

| 节点 | data.config | 说明 |
|------|-------------|------|
| `start` | `inputs`（JSON Schema） | 入口：声明参数（名称/类型/必填/默认值），发布时推导 inputSchema |
| `http` | `url, method, headers, bodyTemplate, timeoutMs, retries` | 调用**平台已注册的 API 工具**（引用 toolId + 参数模板）或受限直连白名单域 |
| `query` | `queryId, paramsTemplate` | 执行平台既有 Query（只允许引用，禁止内联 SQL） |
| `python` | `source, entry, timeoutMs, packages[]` | 沙箱执行；输入=上游输出，输出=JSON |
| `transform` | `template`（JSONPath/映射表） | 纯 Java 数据映射，无副作用 |
| `condition` | — | 分支（edges.data.condition，复用 ConditionEvaluator 语法） |
| `parallel` | — | 并行扇出/汇合（join=all \| any） |
| `output` | `schema` | 出口：声明返回结构，发布时推导 outputSchema |
| `error` | `strategy: fail \| fallback \| continue` | 节点级错误策略；默认 fail 快速终止 |

**变量传递**：上游节点输出存入执行上下文，下游以 `$nodes.<nodeId>.<jsonPath>` 引用；`start` 的参数以 `$input.<name>` 引用。模板在引擎侧解析（无 eval）。

**DSL 示例**（“聚合客户 360 视图”）：

```json
{
  "nodes": [
    { "id": "start", "nodeType": "start", "position": {...}, "data": { "config": { "inputs": [
        { "name": "customerId", "type": "number", "required": true } ] } } },
    { "id": "q_base",     "nodeType": "query",  "data": { "config": { "queryId": 72,
        "paramsTemplate": { "id": "$input.customerId" } } } },
    { "id": "api_orders", "nodeType": "http",   "data": { "config": { "toolId": 5,
        "paramsTemplate": { "custId": "$input.customerId" }, "timeoutMs": 8000, "retries": 1 } } },
    { "id": "py_merge",   "nodeType": "python", "data": { "config": {
        "entry": "main",
        "source": "def main(ctx):\n    base = ctx['q_base']['rows'][0]\n    orders = ctx['api_orders']['data']\n    base['order_count'] = len(orders)\n    base['total_amount'] = sum(o['amount'] for o in orders)\n    return base" } } },
    { "id": "out", "nodeType": "output", "data": { "config": { "schema": {...} } } }
  ],
  "edges": [
    { "source": "start", "target": "q_base" },
    { "source": "start", "target": "api_orders" },
    { "source": "q_base", "target": "py_merge" },
    { "source": "api_orders", "target": "py_merge" },
    { "source": "py_merge", "target": "out" }
  ]
}
```

---

## 五、执行引擎（backend，Java）

- **解释执行**（非编译）：按拓扑序调度节点；`parallel` 分支线程池并发，汇合点等待；
- **单请求同步语义**：总超时 60s（可按编排覆盖，≤60s）；节点超时默认 http 10s / python 20s（≤沙箱上限）；
- **上下文**：`Map<nodeId, JsonNode>` + 输入参数；节点失败按 error 策略处理，`fail` 时返回 `errorCode + nodeTrace`（对外只透出脱敏摘要）；
- **执行留痕**：每次执行写 `OrchestrationExecution`（nodeTrace 含每节点耗时/状态/输出摘要——输出按脱敏规则截断存储）；
- **幂等与并发**：编排无状态；并发安全由下游（Query/HTTP）语义决定；
- **实现落点**：`OrchestrationEngine` 服务类；节点执行器策略模式（`NodeExecutor` per nodeType），复用 `ConditionEvaluator`（条件）与 `ToolService`（HTTP 工具调用走既有出站逻辑，自动获得凭据管理）。

## 六、Python 节点与沙箱（复用 embedding-service）

### 6.1 协议

- backend → embedding-service：`POST /sandbox/execute` `{script, entry, inputs, timeoutMs, packages[]}`；
- 沙箱侧生成驱动文件：把 `inputs` 以 JSON 文件传入，执行 `entry(ctx)`，**stdout 最后一行必须为 JSON 结果**（约定协议，非任意输出）；
- 返回 `{ok, result, stderr, durationMs}`；stderr 仅记录到执行日志，不透出给调用方。

### 6.2 沙箱安全（既有能力 + 编排侧新增约束）

| 层 | 机制 | 现状 |
|----|------|------|
| 容器隔离 | `network=none`（无网络）、`--read-only` 根文件系统、tmpfs `/tmp`、独立 mount 目录 | 沙箱池已有 |
| 资源 | 内存 512m、CPU 1、执行超时强杀（pkill） | 已有 |
| 复用残留 | 每次执行后 `cleanup()`（rm tmp/mnt）+ 池内独占 acquire/release | 已有；**编排侧要求执行前强制 cleanup 复验**（防池实现回归） |
| 代码面 | **静态检查（编排 lint 新增）**：AST 级禁止 `import os/subprocess/socket/ctypes/threading/multiprocessing/requests`…仅白名单模块（json/math/re/datetime/collections/itertools/typing/decimal/statistics）；禁 `open/eval/exec/__import__/compile`；入口签名必须是 `def main(ctx)` | 新增（Python 侧 lint 用沙箱执行受控 AST 检查脚本，检查器本身在沙箱跑） |
| 包管理 | 镜像内预装白名单包；`packages[]` 只能声明白名单内的包，未知包 lint 拒绝 | 新增 |
| 数据面 | inputs/输出大小限制（各 ≤1MB）；输出必须可 JSON 序列化 | 新增 |
| 出网 | **Python 节点无网络**（network=none）——需要外部数据的必须走 http 节点（受 SSRF 防护） | 设计约束 |

---

## 七、可视化编辑器（frontend）

- **复用**：`@xyflow/react` v12 + 流程设计器的画布/小地图/对齐/快捷键基建；
- **节点面板**：左侧按类型分组拖入；已有资源（Query 列表、API 工具列表）以选择器形式引用，**不暴露原始 SQL/URL**；
- **属性抽屉**：右侧表单化编辑节点 config；Python 节点内嵌 Monaco（复用页面编辑器的 Monaco 集成），带模板片段与 lint 结果面板；
- **画布校验（lint）**：保存前跑结构校验（连通性/唯一 start-output/引用存在/条件语法/Python 静态检查），问题列表点击定位节点；
- **试运行**：填样例输入 → 单次执行 → 节点级状态着色（绿/红/耗时）+ 每节点输出查看（脱敏）；试运行产物不发布；
- **版本与发布**：版本时间线（对比/回滚到历史版本再发布）；发布动作 = MANAGE 权限 + 二次确认（展示将影响的消费方：页面绑定、API Key 审批数）。

## 八、Agent 智能编排

复用平台成熟的"委派 + 校验闭环"模式（与页面/流程生成完全同构）：

1. **新智能体 `orchestration-assistant`**（agentRegistry 注册，allowedSkills：orchestration CRUD/lint/testRun + 既有 query/tool 只读）；
2. **主智能体委派**：新增 `delegate_orchestration` skill（与 delegate_workflow 同构），自然语言需求 → 子智能体产出 DSL（系统提示词含节点规范 + 变量语法 + 白名单）；
3. **闭环**：子智能体必须 lint 通过 → testRun 通过（样例输入由 Agent 构造或向用户索取）→ 才允许保存/发布；产物 ID（orchestrationId/versionId/ToolDefinition id）结构化回传（复用 R7 outcomes 模式）；
4. **grounding**：引用的 queryId/toolId 必须来自探查结果（list_queries/工具列表），禁止编造（stepVerifier 同款思路：发布前校验引用真实存在）；
5. **权限**：子智能体调用走发起用户身份（JWT 透传），AppAccess DEVELOP/MANAGE 天然生效，无提权面。

---

## 九、发布与消费

### 9.1 应用内使用

发布产物 = `ToolDefinition(ORCHESTRATION)` → 既有通道全通：
- 页面代码 `runTool` / RuntimeController（页面访问权 + 工具 scope 校验，已有）；
- Agent 工具搜索与调用（已有 ToolController 体系）；
- Query 面板式的资源引用选择器。

### 9.2 外部调用（数据面）

- 端点：`POST /api/v1/orchestrations/{toolName}/invoke`，鉴权 = **X-API-Key 数据面**（复用 v1.2 语义：Key 必须对该 ToolDefinition 持有 APPROVED 的 `ApiKeyTool`，无 JWT 一律 401/403）；
- 申请-审批-绑定：完全复用既有 `ApiKeyTool` 审批流（含"工具权限审批"平台流程）；
- **频控与配额**：每 Key 每编排 QPS 限流（默认 10/s）+ 日配额（默认 1000 次/天，可按 Key 配置）；超限 429；
- **契约稳定**：外部调用固定到 PUBLISHED versionId；schema 变更需新版本重发布，旧版本保留宽限期；
- **审计**：每次 invoke 写执行记录（trigger=API_KEY，含 KeyId），满足最小化（inputs 脱敏、输出摘要）。

---

## 十、安全设计（重点）

### 10.1 权限矩阵（沿用 AppAccess v1.2，零新概念）

| 操作 | 动作 | 备注 |
|------|------|------|
| 查看/探查编排 | VIEW | 应用成员 |
| 编辑/保存/lint/试运行 | DEVELOP | owner 或 app:develop |
| 发布/下线 | MANAGE | owner 或 app:manage（影响外部契约，提高一级） |
| 应用内执行 | RUN | 页面授权成员 |
| 外部 invoke | API Key 数据面 | ApiKeyTool APPROVED |
| 平台级（跨应用共享编排） | 后期：scope=PLATFORM + connect:tools | 本期不做 |

`OrchestrationResolver`（definitionId→applicationId）+ 默认拒绝兜底，新端点忘加注解也有防线。

### 10.2 SSRF 防护（http 节点）

- **优先引用平台已注册 API 工具**（toolId）：URL/凭据来自 ToolDefinition，天然受控；
- 直连模式（受限开放）仅限**应用级白名单域**（应用设置里维护，DEVELOP 权限修改）；
- 引擎出站前校验：解析 IP → 拒绝私网/环回/链路本地/保留段（10/8、172.16/12、192.168/16、127/8、169.254/16、::1、fc00::/7 等）→ 域名解析后二次校验（防 DNS rebinding：连接使用解析后的 IP 且禁自动重定向；必须重定向时逐跳校验）；
- 统一 10s 超时、响应体 ≤5MB、Content-Type 白名单。

### 10.3 凭据与数据安全

- 编排 DSL **不存明文凭据**：http 节点引用 ToolDefinition 的受管凭据（信封/AES 既有机制）；Query 节点参数走参数化模板，**禁止内联 SQL**（DSL 不含 sql 字段，lint 强制）；
- 脱敏管道：执行记录与日志中，`password/token/secret/key` 命名字段值统一掩码；inputs/outputs 超 4KB 截断存储；
- Python 节点拿到的 ctx 仅含本编排上下文，不含平台凭据/数据库连接串（沙箱无网络，从结构上排除数据外带）。

### 10.4 外部面加固

- API Key 数据面默认拒绝（白名单路径新增 `/api/v1/orchestrations/**`）；
- 频控/配额（9.2）+ 并发上限（每 Key 同时执行 ≤5）；
- 错误响应仅含 `errorCode + 通用信息 + traceId`，禁止堆栈/内部 URL/下游原始错误透出；
- 输入校验：invoke 入参按 inputSchema 严格校验（未知字段拒绝、深度/大小限制）。

### 10.5 审计与可观测

- 三类留痕：编排变更（版本 diff）、发布/下线（谁、影响面）、执行记录（每次调用的 nodeTrace）；
- 指标：执行次数/耗时/失败率 per 编排、沙箱池使用率、SSRF 拦截计数；
- 安全事件（lint 拦截的恶意模式、频控触发）单独告警通道。

### 10.6 威胁模型摘要（STRIDE 简表）

| 威胁 | 对策 |
|------|------|
| 恶意 Python 逃逸/挖矿 | 容器隔离 + 无网络 + 资源上限 + 白名单 AST + 超时强杀 |
| SSRF 打内网 | 引用制 + 域名白名单 + IP 段校验 + DNS rebinding 防护 |
| 越权访问他人编排 | AppAccess 全端点 + resolver + 默认拒绝 |
| Key 泄露滥用 | 数据面仅 Key 可达面窄 + 频控配额 + 审计 + rotate（已有） |
| 凭据泄露 | DSL 零明文 + 信封加密 + 日志脱敏 |
| 契约破坏 | 不可变版本 + 发布走 MANAGE |

---

## 十一、API 契约（新增端点）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/v1/orchestrations` | DEVELOP(BODY applicationId) | 创建（含首版 DSL） |
| GET | `/api/v1/orchestrations?applicationId=` | VIEW | 列表 |
| GET | `/api/v1/orchestrations/{id}` | VIEW(resource) | 详情 + 当前发布版本 |
| PUT | `/api/v1/orchestrations/{id}` | DEVELOP(resource) | 保存新版本 |
| POST | `/api/v1/orchestrations/{id}/lint` | DEVELOP(resource) | 校验（结构/引用/Python AST） |
| POST | `/api/v1/orchestrations/{id}/test-run` | DEVELOP(resource) | 试运行（样例输入） |
| POST | `/api/v1/orchestrations/{id}/versions/{v}/publish` | MANAGE(resource) | 发布 → ToolDefinition |
| POST | `/api/v1/orchestrations/{id}/versions/{v}/archive` | MANAGE(resource) | 下线 |
| GET | `/api/v1/orchestrations/{id}/executions` | DEVELOP(resource) | 执行记录（审计） |
| POST | `/api/v1/orchestrations/{toolName}/invoke` | API Key 数据面（白名单路径） | 外部调用 |

应用内执行不新增端点：走既有 `runTool`（ToolDefinition ORCHESTRATION 类型）。

## 十二、数据库迁移（ddl-auto=update 自动建表）

```sql
CREATE TABLE orchestration_definitions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  description VARCHAR(512),
  application_id BIGINT NOT NULL,
  current_version_id BIGINT NULL,
  published_version_id BIGINT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
);
CREATE TABLE orchestration_versions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  definition_id BIGINT NOT NULL,
  version INT NOT NULL,
  dsl JSON NOT NULL,
  checksum CHAR(64) NOT NULL,
  created_by BIGINT NOT NULL, created_at DATETIME NOT NULL,
  UNIQUE KEY uk_def_ver (definition_id, version)
);
CREATE TABLE orchestration_executions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  definition_id BIGINT NOT NULL, version_id BIGINT NOT NULL,
  trigger VARCHAR(20) NOT NULL,          -- USER_TEST / RUNTIME / API_KEY
  api_key_id BIGINT NULL,
  inputs JSON, outputs_digest JSON,       -- 脱敏摘要
  node_trace JSON,
  status VARCHAR(20) NOT NULL, error_code VARCHAR(64) NULL,
  duration_ms INT NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_def_time (definition_id, created_at)
);
```

## 十三、实施计划

| 阶段 | 内容 | 交付判定 |
|:--:|------|----------|
| M1 | 领域模型 + DSL + 引擎（http/query/transform/condition）+ lint + 单测 | 单测：DSL 校验矩阵、引擎拓扑执行、错误策略 |
| M2 | Python 节点接沙箱池（协议+静态检查器）+ 试运行 | 沙箱集成测试：超时/恶意模式拦截/包白名单 |
| M3 | REST 端点 + 发布到 ToolDefinition + 应用内消费 + AppAccess | E2E：建编排→发布→页面调用（同 workflow-e2e 模式） |
| M4 | 可视化编辑器（画布/面板/lint 面板/试运行视图/版本） | 人工验收 + 页面冒烟 |
| M5 | Agent 智能编排（orchestration-assistant + delegate + grounding） | agent:check 扩展用例 + 生成回归 |
| M6 | 外部数据面（invoke + Key 审批 + 频控配额 + 审计）+ SSRF 防护 | 安全测试脚本（SSRF 用例/频控/越权矩阵） |

每阶段完成跑既有全量回归（security-smoke / workflow-e2e* / agent:check）。

## 十四、测试策略

- **单测**：DSL lint 矩阵（含恶意 Python 样本库）、引擎（拓扑/并发/超时/错误策略/变量解析）、SSRF 校验（私网段表驱动）、频控器；
- **集成**：沙箱池联调（真实容器）、发布→消费全链路；
- **E2E 脚本**（延续 scripts/ 体系）：`orchestration-e2e.sh`（root 建编排→试运行→发布→页面/外部 invoke）；
- **安全测试**：`orchestration-security-smoke.sh`——未授权 CRUD 403、外部无 Key 401、未审批 Key 403、频控 429、SSRF 拦截（http 节点指向 169.254.169.254）、恶意 Python 拦截（import os）。

## 十五、风险与开放问题

1. 沙箱池容量：编排放量后与 embedding 任务争抢（POOL_SIZE=3）——需池分组或按租户配额，M2 评估；
2. 直连白名单域的运维边界（应用 DEVELOP 自助添加 vs 平台审核）——建议先平台统一管理；
3. 长编排（>60s）需求出现时的异步化路径（触发器/回调）——留作 v2；
4. Python 输出的 schema 漂移（Agent 生成的 output schema 与实际不符）——发布时以试运行实测输出校正 schema；
5. 编排调用编排（组合复用）——本期 DSL 支持引用 ORCHESTRATION 工具（走 http 节点 toolId 机制天然支持），深度限 3 层防环。

---

## 附录 A：M1-M3 实施与验证记录（2026-09-10）

### A.1 设计哲学定稿（用户澄清）

编排存在的价值**不是低代码替代 Python**——Agent 写 Python 已能覆盖大多数逻辑。核心是**平台资源隔离**：Query、API、流程必须经平台基础设施访问（权限/审计/凭据/SSRF 防护），Python 沙箱无网络是特性——强制外部数据只走受控通道。**使用模式 = 平台资源备菜（query/http/workflow 节点）+ Python 烹饪（纯逻辑处理）**。

### A.2 workflow 节点（用户补充的第 10 种节点）

| 项 | 内容 |
|------|------|
| 动作 | start（发起流程实例，formData 模板）/ get_status / approve / reject（审批以当前执行用户身份，assignee 校验天然生效） |
| 权限 | 发起走 canSubmitWorkflow（app:workflow:{defId}）、审批走 checkTaskAssignee——编排不绕过流程安全机制 |
| grounding | lint 校验 workflowDefinitionId 存在（防 Agent 编造） |

### A.3 实施清单（M1-M3）

- 实体×3 + Repository×3（@Entity/@PrePersist 完整；scope 显式列）
- DSL（10 节点类型 + $input/$nodes 变量语法，无 eval 逐段解析）+ OrchestrationLinter（结构/引用/Python 白名单/条件语法/变量语法）
- OrchestrationEngine（DFS 推进/parallel 并发/condition/错误策略 fail-fallback-continue/60s 总超时/深度 64）+ IpGuard（IPv4/IPv6 保留段 + IP 建连防 rebinding）+ VariableResolver（类型保真）
- DefaultNodeInvokers（query→QueryService / tool→出站 / workflow→ProcessService / python→SandboxPythonClient 沙箱池）
- REST 端点 + AppAccess 注解 + OrchestrationResolver + 发布→ToolDefinition(PLATFORM scope 可被 Key 申请)
- 外部 invoke：JWT 登录 + ApiKeyTool APPROVED 双校验（延续"禁止未登录凭 Key 调用"红线）

### A.4 验证结果（重启后实测）

| 套件 | 结果 |
|------|------|
| orchestration-e2e.sh | **11/11**（含 workflow 节点发起真实流程实例 119） |
| security-smoke / workflow-e2e / nl2sql-loop-regression | 15/15、12/12、4/4 回归通过 |
| JUnit | **62/62**（编排 28 + 既有 34） |

### A.5 实施中揪出的坑（全部修复）

1. 脚手架遗漏：新实体漏 @Entity/@PrePersist；`trigger` 撞 MySQL 保留字（改名 trigger_type）；
2. 脚本竞态：python 生成脚本间的替换锚点相互回滚（接口 runWorkflowAction/executeNode workflow 分支丢失）——以单测+grep 自检流程规避；
3. Datasource.ownerId 语义漂移（APPLICATION=应用 id / PLATFORM=平台组 id）→ scope 显式列。

### A.6 待实施（M4-M6）

- M4 可视化编辑器：React Flow 画布 + 节点面板 + 属性抽屉（Python 用 Monaco）+ lint 面板 + 试运行视图 + 版本时间线；
- M5 智能编排：orchestration-assistant（agentRegistry + delegate_orchestration skill + grounding 强制引用真实 queryId/toolId + outcomes 回传）+ agent:check 扩展；
- M6 数据面增强：频控（per-Key QPS/日配额）+ 并发上限 + orchestration-security-smoke.sh（SSRF/越权/频控矩阵）。
