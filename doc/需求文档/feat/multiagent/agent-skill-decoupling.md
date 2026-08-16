# 智能体与技能解耦重构方案

## 版本
v1.0 | 2026-08-16

---

## 一、现有架构分析

### 1.1 当前架构

```
用户输入
    │
    ▼
┌──────────────┐
│  ChatRouter  │  ← 仅基于 @mention 或 agentId 路由
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ AgentFactory │  ← 创建 Agent 时，SystemPrompt 和 Tools 直接绑定
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  agentLoop   │  ← 纯执行循环：对话 → LLM → 工具调用 → 返回
└──────────────┘
```

### 1.2 问题清单

| 编号 | 问题 | 严重程度 | 说明 |
|------|------|----------|------|
| P1 | **Agent 与 Skill 强耦合** | 高 | agentRegistry 中每个 Agent 的 SystemPrompt 和 Tools 硬编码绑定，无法复用技能 |
| P2 | **Main Loop 太薄** | 高 | agentLoop 只做"对话→LLM→工具调用"循环，不参与上下文装配、结果验证、状态同步 |
| P3 | **没有意图识别** | 高 | ChatRouter 只靠 @mention 路由，无法根据用户输入内容自动判断该调用哪个 Agent |
| P4 | **没有上下文装配** | 中 | 每次委派子智能体时，上下文全靠主智能体提示词中手动拼接，没有统一的上下文装配层 |
| P5 | **没有结果验证** | 中 | 子智能体返回结果后，主智能体直接转达，不做质量检查 |
| P6 | **没有状态同步** | 中 | 子智能体执行的副作用（如创建查询、创建页面），主智能体不知道，需要手动刷新 |
| P7 | **反馈链太长** | 中 | 分析助手 → 主智能体 → DBA → 主智能体 → 用户，中间环节多，信息衰减严重 |
| P8 | **没有端到端验证** | 低 | 所有组件拼在一起后，没人检查整体是否正常工作 |
| P9 | **Agent 对话记录完全隔离** | 中 | 每个 Agent 的 LLM 对话互不可见：DBA 看不到分析助手的分析报告，主智能体看不到 DBA 的内部推理过程。只能靠委派时手动拼接一句话传递信息，信息严重不足 |

### 1.3 当前 Agent-Skill 绑定关系

```
┌─────────────────────────────────────────────────────────────────────┐
│  agentRegistry.ts                                                   │
│                                                                     │
│  main-agent ──────┬── buildSystemPrompt() ──► systemPrompt.ts       │
│                   ├── buildTools() ──────────► createInteliTools()   │
│                   │     ├── pageTools.ts                             │
│                   │     ├── codePageTools.ts                         │
│                   │     ├── findAnalysisTool.ts                      │
│                   │     ├── findQueryTool.ts (delegate_query)        │
│                   │     ├── findWorkflowTool.ts (delegate_workflow)  │
│                   │     └── requirementTools.ts (plan tools)         │
│                   │                                                 │
│  data-assistant ──┬── buildSystemPrompt() ──► dbaPrompt.ts          │
│                   ├── buildTools() ──────────► createDataAssistantTools() │
│                   │     ├── datasourceTools.ts                       │
│                   │     └── dbaTools.ts (list_queries, create_query, etc.) │
│                   │                                                 │
│  workflow-assistant ─┬── buildSystemPrompt() ──► workflowAgent.ts   │
│                      ├── buildTools() ──────────► createWorkflowTools() │
│                      │     └── workflowTools.ts                       │
│                      │                                              │
│  analysis-assistant ─┬── buildSystemPrompt() ──► analysisAgent.ts   │
│                      ├── buildTools() ──────────► getRequirementTools() │
│                            └── requirementTools.ts (plan tools)       │
└─────────────────────────────────────────────────────────────────────┘
```

**结论**：每个 Agent 的 SystemPrompt 和 Tools 是硬编码的，无法跨 Agent 复用技能。例如 `requirementTools.ts` 中的计划管理工具（create_plan、update_plan 等）只给分析助手用，但实际上主智能体也需要。

---

## 二、目标架构

### 2.1 顶层关系

```
                                ┌─────────────────────────┐
                                │      Skill Registry      │
                                │  ┌─────────────────────┐│
                                │  │ 查询类：              ││
                                │  │ · list_queries       ││
                                │  │ · create_query       ││
                                │  │ · update_query       ││
                                │  │ · delete_query       ││
                                │  │ · run_query          ││
                                │  │                      ││
                                │  │ 数据源类：            ││
                                │  │ · list_datasources   ││
                                │  │ · test_datasource    ││
                                │  │ · fetch_structure    ││
                                │  │                      ││
                                │  │ 页面类：              ││
                                │  │ · list_pages         ││
                                │  │ · create_page        ││
                                │  │ · delete_page        ││
                                │  │ · get_code_page      ││
                                │  │ · create_code_page   ││
                                │  │ · update_code_page   ││
                                │  │                      ││
                                │  │ 流程类：              ││
                                │  │ · design_form        ││
                                │  │ · design_workflow    ││
                                │  │ · bind_form_workflow ││
                                │  │ · search_members     ││
                                │  │                      ││
                                │  │ 计划类：              ││
                                │  │ · create_plan        ││
                                │  │ · update_plan        ││
                                │  │ · confirm_plan       ││
                                │  │ · validate_plan      ││
                                │  │                      ││
                                │  │ 委派类：              ││
                                │  │ · delegate_to_agent  ││
                                │  └─────────────────────┘│
                                └───────────┬─────────────┘
                                            │ 注册/查询
                                            │
┌───────────────────────────────────────────┼───────────────────────────────────────────┐
│                                MAIN LOOP (编排层)                                      │
│                                           │                                            │
│  ┌────────────────────────────────────────┼────────────────────────────────────────┐  │
│  │                              编排流程                                           │  │
│  │                                                                                 │  │
│  │  用户输入                                                                        │  │
│  │     │                                                                           │  │
│  │     ▼                                                                           │  │
│  │  ┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐   │  │
│  │  │1.意图识别│───►│2.上下文装配│───►│3.Agent调度│───►│4.技能分配│───►│5.结果验证│   │  │
│  │  └─────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘   │  │
│  │       │              │               │               │               │          │  │
│  │       │              │               │               │               ▼          │  │
│  │       │              │               │               │    ┌──────────────┐      │  │
│  │       │              │               │               │    │6.冲突合并    │      │  │
│  │       │              │               │               │    └──────┬───────┘      │  │
│  │       │              │               │               │           │              │  │
│  │       │              │               │               │           ▼              │  │
│  │       │              │               │               │    ┌──────────────┐      │  │
│  │       │              │               │               │    │7.状态同步    │      │  │
│  │       │              │               │               │    └──────┬───────┘      │  │
│  │       │              │               │               │           │              │  │
│  │       │              │               │               │           ▼              │  │
│  │       │              │               │               │    ┌──────────────┐      │  │
│  │       │              │               │               │    │8.用户响应    │      │  │
│  │       │              │               │               │    └──────────────┘      │  │
│  │       │              │               │               │                          │  │
│  └───────┼──────────────┼───────────────┼───────────────┼──────────────────────────┘  │
│          │              │               │               │                              │
│  ┌───────┼──────────────┼───────────────┼───────────────┼──────────────────────────┐  │
│  │       │       Shared Context (共享上下文)                │                          │  │
│  │       │  ┌──────────────────────────────────────────────┼──────────────────────┐  │  │
│  │       │  │ 应用状态 │ 页面列表 │ 数据源 │ 查询列表 │ 流程列表 │ 计划栈 │ 对话历史 │  │  │
│  │       │  └──────────────────────────────────────────────┼──────────────────────┘  │  │
│  └───────┼─────────────────────────────────────────────────┼─────────────────────────┘  │
│          │                                                 │                             │
└──────────┼─────────────────────────────────────────────────┼─────────────────────────────┘
           │                                                 │
           ▼                                                 ▼
    ┌──────────────┐                                ┌──────────────────┐
    │ Intent Engine │                                │  Agent Registry  │
    │  (意图引擎)    │                                │  (智能体注册表)   │
    │              │                                │                  │
    │ 分类：       │                                │ 需求分析智能体    │
    │ · 需求分析   │                                │ 数据辅助智能体    │
    │ · 数据操作   │                                │ 流程设计智能体    │
    │ · 页面生成   │                                │ 代码生成智能体    │
    │ · 流程设计   │                                │                  │
    │ · 综合任务   │                                │ 每个Agent定义：   │
    │ · 问答       │                                │ · 角色 persona   │
    └──────────────┘                                │ · 决策规则        │
                                                    │ · 可用技能列表    │
           │                                        │ · 不可用技能列表  │
           │                                        └────────┬─────────┘
           │                                                 │
           └─────────────────┬───────────────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Agent Executor │
                    │  (智能体执行器)  │
                    │                 │
                    │ 复用现有        │
                    │ agentLoop       │
                    │ 核心逻辑        │
                    └─────────────────┘
```

### 2.2 分层职责

| 层级 | 组件 | 职责 | 复杂度 |
|------|------|------|--------|
| **编排层** | Main Loop | 意图识别、上下文装配、Agent调度、技能分配、结果验证、冲突合并、状态同步 | **高（最复杂）** |
| **决策层** | Agent | 角色定义、决策规则、技能选择、LLM推理 | 中 |
| **执行层** | Skill | 工具执行、API调用、副作用管理 | 低 |
| **存储层** | Shared Context | 应用状态、页面列表、数据源、查询列表、流程列表、计划栈、对话历史 | 低 |

---

## 三、详细设计

### 3.1 Skill Registry（技能注册表）

**目标**：将所有工具能力从 Agent 中解耦，注册为独立 Skill，Agent 通过 Skill ID 引用。

```typescript
// frontend/src/agent/registry/skillRegistry.ts

interface SkillDefinition {
  id: string;                    // 唯一标识，如 "query:create"
  category: SkillCategory;       // 分类：query / datasource / page / code / workflow / plan / delegate
  name: string;                  // 工具名称，如 "create_query"
  description: string;           // 工具描述（给 LLM 看）
  parameters: JSONSchema;        // 参数 Schema
  execute: (args: any, ctx: SkillContext) => Promise<SkillResult>;
  requiresConfirmation?: boolean; // 是否需要用户确认（如删除操作）
  sideEffects?: SideEffect[];    // 副作用声明（如"创建页面"、"修改查询"）
}

enum SkillCategory {
  QUERY = 'query',
  DATASOURCE = 'datasource',
  PAGE = 'page',
  CODE = 'code',
  WORKFLOW = 'workflow',
  PLAN = 'plan',
  DELEGATE = 'delegate',
}

interface SideEffect {
  type: 'create' | 'update' | 'delete';
  resource: 'page' | 'query' | 'datasource' | 'workflow' | 'plan';
  resourceId?: string;
}
```

**技能注册示例**：

```typescript
// 查询类技能
const QUERY_SKILLS: SkillDefinition[] = [
  {
    id: 'query:list',
    category: SkillCategory.QUERY,
    name: 'list_queries',
    description: '列出当前应用的所有查询',
    parameters: { type: 'object', properties: {} },
    execute: async (args, ctx) => { /* ... */ },
    sideEffects: [],
  },
  {
    id: 'query:create',
    category: SkillCategory.QUERY,
    name: 'create_query',
    description: '创建新的数据查询',
    parameters: { /* ... */ },
    execute: async (args, ctx) => { /* ... */ },
    sideEffects: [{ type: 'create', resource: 'query' }],
  },
  // ...
];

// 页面类技能
const PAGE_SKILLS: SkillDefinition[] = [
  {
    id: 'page:get_code',
    category: SkillCategory.CODE,
    name: 'get_code_page',
    description: '获取代码页面的完整代码',
    parameters: { /* ... */ },
    execute: async (args, ctx) => { /* ... */ },
    sideEffects: [],
  },
  // ...
];
```

### 3.2 Agent Registry（智能体注册表）

**目标**：Agent 只定义角色、决策规则和可用技能列表，不再绑定工具实现。

```typescript
// frontend/src/agent/registry/agentRegistry.ts

interface AgentDefinition {
  id: string;
  name: string;
  icon: string;
  description: string;
  isDefault: boolean;

  // 角色定义
  persona: string;              // 角色描述，如"你是一个业务需求分析师..."
  decisionRules: string[];      // 决策规则，如"需求不明确时必须提问"

  // 技能绑定（通过 ID 引用，不绑定实现）
  allowedSkills: string[];      // 可用技能 ID 列表
  forbiddenSkills: string[];    // 禁用技能 ID 列表

  // 委派能力
  canDelegateTo: string[];      // 可以委派给哪些 Agent

  // 上下文需求
  contextRequirements: string[]; // 需要哪些上下文信息
}

const AGENTS: AgentDefinition[] = [
  {
    id: 'main-agent',
    name: '主智能体',
    icon: '',
    description: '主智能体，负责编排任务、审核结果、与用户交互',
    isDefault: true,
    persona: '你是鲁班平台的主智能体，负责理解用户需求、编排子智能体、审核结果、与用户沟通。',
    decisionRules: [
      '需求不明确时必须主动提问，绝不猜测执行',
      '删除操作前必须明确告知用户并等待确认',
      '收到子智能体返回的结果后，必须审核质量再转达用户',
      '发现子智能体结果有遗漏或错误时，主动指出并请求修正',
      '执行前检查前置条件是否满足',
      '执行后验证结果是否正确',
    ],
    allowedSkills: [
      // 页面管理
      'page:list', 'page:create', 'page:delete', 'page:rename',
      'code:get', 'code:create', 'code:update',
      // 计划管理
      'plan:create', 'plan:update', 'plan:confirm', 'plan:validate',
      'plan:list_unfinished', 'plan:set_focus', 'plan:adjust',
      // 委派
      'delegate:to_agent',
      // 观察
      'observation:record',
    ],
    forbiddenSkills: [
      // 数据操作全部委派给 DBA
      'query:create', 'query:update', 'query:delete',
      'datasource:list', 'datasource:test', 'datasource:structure',
      // 流程操作全部委派给流程助手
      'workflow:design_form', 'workflow:design', 'workflow:bind',
      'workflow:search_members', 'workflow:search_roles',
    ],
    canDelegateTo: ['analysis-assistant', 'data-assistant', 'workflow-assistant'],
    contextRequirements: ['application', 'pages', 'plans', 'queries'],
  },
  {
    id: 'data-assistant',
    name: '数据辅助智能体',
    icon: '',
    description: '数据辅助智能体，负责连接数据源、创建查询、执行调试',
    isDefault: false,
    persona: '你是数据辅助智能体（DBA），负责管理数据源和查询。你只管理数据源和查询，不操作页面。',
    decisionRules: [
      '检查对话历史，避免重复调用已有信息',
      '查询测试失败时同一问题最多尝试 2 种方案',
      '创建查询后必须检查数据量和数据质量',
      '修改查询前检查影响范围',
    ],
    allowedSkills: [
      'query:list', 'query:create', 'query:update', 'query:delete',
      'query:run', 'query:get',
      'datasource:list', 'datasource:test', 'datasource:structure',
    ],
    forbiddenSkills: [
      'page:create', 'code:create', 'code:update',
      'workflow:design_form', 'workflow:design',
      'plan:create', 'plan:confirm',
    ],
    canDelegateTo: [],
    contextRequirements: ['application', 'datasources'],
  },
  {
    id: 'workflow-assistant',
    name: '流程设计助手',
    icon: '',
    description: '流程设计助手，负责设计表单、审批流程、查询组织、管理审批',
    isDefault: false,
    persona: '你是流程设计助手，专门帮助用户设计和管理业务流程。',
    decisionRules: [
      '设计流程前先分析业务场景',
      '每个流程必须包含 start 和 end 节点',
      '审批节点必须设置审批人',
      '设计完成后自检流程完整性',
    ],
    allowedSkills: [
      'workflow:design_form', 'workflow:design', 'workflow:bind',
      'workflow:search_members', 'workflow:search_roles', 'workflow:search_departments',
      'workflow:list_instances', 'workflow:approve', 'workflow:reject',
      'workflow:freeze', 'workflow:unfreeze', 'workflow:cancel',
      'workflow:lint', 'workflow:copy', 'workflow:preview',
    ],
    forbiddenSkills: [
      'query:create', 'query:update', 'query:delete',
      'page:create', 'code:create', 'code:update',
      'plan:create', 'plan:confirm',
    ],
    canDelegateTo: [],
    contextRequirements: ['application', 'workflows', 'members', 'departments'],
  },
  {
    id: 'analysis-assistant',
    name: '需求分析助手',
    icon: '',
    description: '需求分析助手，负责从业务视角分析用户需求，不涉及技术实现',
    isDefault: false,
    persona: '你是需求分析智能体，从业务视角理解用户需求，你不知道数据库结构，也不关心技术实现。',
    decisionRules: [
      '需求不明确时先向用户提问澄清',
      '使用业务语言，避免技术术语',
      '分析完成后必须创建执行计划',
      '覆盖用户提到的所有需求点',
    ],
    allowedSkills: [
      'plan:create', 'plan:update', 'plan:confirm', 'plan:validate',
    ],
    forbiddenSkills: [
      'query:create', 'query:update', 'query:delete',
      'page:create', 'code:create', 'code:update',
      'workflow:design_form', 'workflow:design',
    ],
    canDelegateTo: [],
    contextRequirements: ['application', 'pages'],
  },
];
```

### 3.3 Main Loop（编排层）

**目标**：Main Loop 是整个系统最复杂的部分，负责从输入到输出的完整编排。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MAIN LOOP 编排流程                               │
│                                                                             │
│  用户输入: "帮我做一个员工管理页面，有列表和详情"                              │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 1: 意图识别 (Intent Engine)                                     │   │
│  │                                                                      │   │
│  │  输入: 用户原始输入 + 对话历史                                       │   │
│  │  输出: { intent: 'comprehensive', confidence: 0.92,                   │   │
│  │          subIntents: ['analysis', 'page_generation', 'data_query'],   │   │
│  │          targetAgent: 'analysis-assistant' }                          │   │
│  │                                                                      │   │
│  │  意图分类:                                                            │   │
│  │  · analysis: 需求分析（"做一个CRM"、"帮我分析需求"）                  │   │
│  │  · data_operation: 数据操作（"创建查询"、"列出数据源"）               │   │
│  │  · page_generation: 页面生成（"创建页面"、"修改首页"）                │   │
│  │  · workflow_design: 流程设计（"设计审批流程"、"创建请假表单"）        │   │
│  │  · comprehensive: 综合任务（以上多类组合）                            │   │
│  │  · qa: 简单问答（"这个功能怎么用"）                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 2: 上下文装配 (Context Assembly)                                 │   │
│  │                                                                      │   │
│  │  根据目标 Agent 的 contextRequirements，从 Shared Context 装配：     │   │
│  │                                                                      │   │
│  │  analysis-assistant 需要:                                            │   │
│  │  ├── 应用信息（ID、名称）                                            │   │
│  │  ├── 页面列表（已有页面、当前页面）                                  │   │
│  │  └── 对话历史摘要（最近的讨论）                                      │   │
│  │                                                                      │   │
│  │  data-assistant 需要:                                                │   │
│  │  ├── 应用信息                                                        │   │
│  │  ├── 已有查询列表（名称、ID、用途）                                  │   │
│  │  ├── 已有数据源列表                                                  │   │
│  │  └── 业务上下文（主智能体传来的需求描述）                            │   │
│  │                                                                      │   │
│  │  装配规则:                                                           │   │
│  │  · 只装配 Agent 需要的上下文，不传递无关信息                         │   │
│  │  · 自动注入业务上下文（从主智能体的分析结果中提取）                  │   │
│  │  · 注入当前计划信息（如果有）                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 3: Agent 调度 (Agent Scheduling)                                 │   │
│  │                                                                      │   │
│  │  根据意图识别结果，选择合适的 Agent：                                │   │
│  │                                                                      │   │
│  │  · 单一意图 → 直接路由到目标 Agent                                  │   │
│  │  · 综合任务 → 按顺序调度多个 Agent：                                │   │
│  │    1. analysis-assistant（先分析需求）                               │   │
│  │    2. data-assistant（创建需要的查询）                               │   │
│  │    3. 回到 main-agent（生成页面代码）                                │   │
│  │    4. workflow-assistant（如果需要流程）                             │   │
│  │                                                                      │   │
│  │  调度策略:                                                           │   │
│  │  · 串行：有依赖关系的任务按顺序执行                                  │   │
│  │  · 并行：无依赖关系的任务可同时执行                                  │   │
│  │  · 条件：根据前一步结果决定是否执行下一步                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 4: 技能分配 (Skill Assignment)                                   │   │
│  │                                                                      │   │
│  │  从 Skill Registry 中，根据 Agent 的 allowedSkills 过滤可用技能：    │   │
│  │                                                                      │   │
│  │  const agentSkills = skillRegistry.filter(s =>                       │   │
│  │    agent.allowedSkills.includes(s.id) &&                              │   │
│  │    !agent.forbiddenSkills.includes(s.id)                              │   │
│  │  );                                                                  │   │
│  │                                                                      │   │
│  │  将技能列表 + SystemPrompt + 上下文 组装为 Agent 的执行参数          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 5: Agent 执行 (Agent Execution)                                  │   │
│  │                                                                      │   │
│  │  复用现有的 agentLoop 核心逻辑，但增加：                             │   │
│  │  · 执行前自检：检查前置条件是否满足                                  │   │
│  │  · 执行中监控：跟踪进度、检测超时                                    │   │
│  │  · 执行后记录：记录副作用到 Shared Context                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 6: 结果验证 (Result Validation)                                  │   │
│  │                                                                      │   │
│  │  检查 Agent 返回的结果质量：                                         │   │
│  │                                                                      │   │
│  │  analysis-assistant 返回:                                            │   │
│  │  ├── ✓ 是否覆盖了所有用户需求？                                      │   │
│  │  ├── ✓ 是否有遗漏的维度？                                            │   │
│  │  ├── ✓ 计划步骤是否完整？                                            │   │
│  │  └── ✗ 如有问题 → 请求 Agent 补充分析                               │   │
│  │                                                                      │   │
│  │  data-assistant 返回:                                                │   │
│  │  ├── ✓ 查询是否创建成功？                                            │   │
│  │  ├── ✓ 数据是否合理（非空、非海量）？                                │   │
│  │  ├── ✓ 字段是否覆盖了需求？                                          │   │
│  │  └── ✗ 如有问题 → 请求 Agent 修正                                   │   │
│  │                                                                      │   │
│  │  验证规则:                                                           │   │
│  │  · 成功 → 进入下一步                                                 │   │
│  │  · 部分失败 → 请求 Agent 修正，最多 1 次                             │   │
│  │  · 完全失败 → 告知用户，等待指导                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 7: 冲突合并 (Conflict Resolution)                                │   │
│  │                                                                      │   │
│  │  多个 Agent 返回的结果可能存在冲突：                                 │   │
│  │                                                                      │   │
│  │  · 页面冲突：两个 Agent 都想修改同一个页面                           │   │
│  │    → 合并修改，组件取并集，样式取后者                                 │   │
│  │                                                                      │   │
│  │  · 查询冲突：两个 Agent 创建了功能重复的查询                         │   │
│  │    → 合并为一个查询，输出字段取并集                                   │   │
│  │                                                                      │   │
│  │  · 流程冲突：两个 Agent 涉及同一个流程                               │   │
│  │    → 标注冲突，让用户确认                                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 8: 状态同步 (State Synchronization)                              │   │
│  │                                                                      │   │
│  │  将 Agent 执行的副作用同步到 Shared Context：                        │   │
│  │                                                                      │   │
│  │  · 创建了查询 → 更新 Shared Context 的查询列表                       │   │
│  │  · 创建了页面 → 更新 Shared Context 的页面列表                       │   │
│  │  · 创建了流程 → 更新 Shared Context 的流程列表                       │   │
│  │  · 更新了计划 → 更新 Shared Context 的计划栈                         │   │
│  │                                                                      │   │
│  │  同步策略:                                                           │   │
│  │  · 自动同步：sideEffects 声明的副作用自动同步                        │   │
│  │  · 手动同步：Agent 显式返回的上下文变更手动同步                      │   │
│  │  · 触发 UI 刷新：同步后通知前端更新列表                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STEP 9: 用户响应 (User Response)                                      │   │
│  │                                                                      │   │
│  │  将最终结果格式化后呈现给用户：                                       │   │
│  │                                                                      │   │
│  │  · 综合任务 → 展示完整报告（分析 + 执行结果 + 预览链接）             │   │
│  │  · 单一任务 → 展示执行结果                                           │   │
│  │  · 有问题 → 展示问题 + 建议 + 等待用户决策                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 Shared Context（共享上下文）

**目标**：所有 Agent 共享的状态存储，替代当前各自维护独立状态的模式。

```typescript
// frontend/src/agent/core/sharedContext.ts

interface SharedContext {
  // 应用信息
  application: {
    id: number;
    name: string;
  };

  // 页面
  pages: Array<{
    id: number;
    name: string;
    type: 'code' | 'visual';
  }>;

  // 当前页面
  currentPage: {
    id: number;
    name: string;
  };

  // 数据源
  datasources: Array<{
    id: number;
    name: string;
    type: string;
    connected: boolean;
  }>;

  // 查询
  queries: Array<{
    id: number;
    name: string;
    description: string;
    usedByPages: number[];
  }>;

  // 流程
  workflows: Array<{
    id: number;
    name: string;
    status: string;
  }>;

  // 计划栈
  plans: Plan[];

  // 对话摘要（用于上下文装配）
  conversationSummary: string;

  // 最近副作用（用于状态同步）
  recentSideEffects: SideEffect[];
}
```

### 3.5 Intent Engine（意图引擎）

**目标**：替代当前简单的 @mention 路由，基于用户输入内容自动判断意图。

```typescript
// frontend/src/agent/core/intentEngine.ts

interface IntentResult {
  intent: IntentType;
  confidence: number;
  subIntents: IntentType[];
  targetAgent: string;
  reasoning: string;
}

type IntentType =
  | 'analysis'          // 需求分析
  | 'data_operation'    // 数据操作
  | 'page_generation'   // 页面生成
  | 'workflow_design'   // 流程设计
  | 'comprehensive'     // 综合任务
  | 'qa';               // 简单问答

// 意图识别规则（可扩展为 LLM 分类）
const INTENT_PATTERNS: Record<IntentType, RegExp[]> = {
  analysis: [
    /做一个?|搭建|创建.*[系统|应用|平台|驾驶舱]/,
    /帮我分析|梳理.*需求/,
    /设计.*页面|规划.*功能/,
  ],
  data_operation: [
    /创建.*查询|新增.*查询|建.*数据源/,
    /列出.*查询|查看.*数据源|看看.*表结构/,
    /修改.*查询|删除.*查询/,
  ],
  page_generation: [
    /创建.*页面|新增.*页面|新建.*页面/,
    /修改.*首页|调整.*页面|改.*样式/,
    /生成.*代码|写.*页面/,
  ],
  workflow_design: [
    /设计.*流程|创建.*审批|做.*请假|做.*报销/,
    /设计.*表单|创建.*表单/,
    /审批.*配置|流程.*设置/,
  ],
  comprehensive: [
    /做一个?.*系统|搭.*应用|建.*平台/,
    /完整.*功能|整套.*页面/,
  ],
  qa: [
    /怎么.*用|如何.*操作|什么是/,
    /帮助|教程|说明/,
  ],
};
```

---

### 3.6 失败回退机制（Failure Rollback）

#### 为什么需要？

在多智能体协同中，任何一步都可能失败：AI 模型返回格式错误、子智能体超时、外部 API 限流或宕机。如果没有回退机制，任何一个环节失败就意味着整个任务失败，用户只能重头再来。不同失败类型需要不同处理方式——网络抖动重试就能解决，权限不足重试一百次也没用。

#### 错误分类

```
FailureType
├── TEMPORARY（临时性）       → 可重试
│   ├── NETWORK_ERROR         网络波动
│   ├── RATE_LIMIT            限流
│   ├── TIMEOUT               超时
│   └── LLM_FORMAT_ERROR      LLM 返回格式错误
│
├── PERMANENT（永久性）       → 不可重试，需切换方案
│   ├── PERMISSION_DENIED     权限不足
│   ├── RESOURCE_NOT_FOUND    资源不存在
│   ├── VALIDATION_ERROR      参数校验失败
│   └── QUOTA_EXCEEDED        配额耗尽
│
└── PARTIAL_SUCCESS（部分成功）→ 保留已完成部分，回退失败部分
    ├── ANALYSIS_DONE         需求分析完成，执行失败
    ├── QUERY_CREATED         查询创建成功，页面生成失败
    └── PAGE_CREATED          页面创建成功，流程绑定失败
```

#### 回退策略（按优先级尝试）

```
1. RETRY（重试）
   适用: TEMPORARY 类型错误
   策略: 指数退避，最多 3 次
   示例: 网络波动 → 等待 1s/2s/4s 重试

2. SWITCH（切换）
   适用: 重试失败或 PERMANENT 类型错误
   策略: 换一个 Agent 实例或换一个 Skill 实现
   示例: DBA 创建查询失败 → 换主智能体直接创建

3. SKIP（跳过）
   适用: 非关键步骤失败
   策略: 标记为 skipped，继续执行后续步骤
   示例: 生成预览图失败 → 跳过，页面功能不受影响

4. DEGRADE（降级）
   适用: 无法完整实现，但有替代方案
   策略: 用简化版功能替代
   示例: 无法生成图表 → 用表格展示数据

5. HUMAN_HANDOVER（人工介入）
   适用: 以上策略均失败
   策略: 返回诊断报告，告知用户已完成和失败的部分
```

#### 步骤权重标记

每个计划步骤必须标注权重，决定失败后的处理策略：

```typescript
type StepWeight = 'CRITICAL' | 'IMPORTANT' | 'OPTIONAL';

// CRITICAL: 失败则整个任务失败，必须回退到 HUMAN_HANDOVER
// IMPORTANT: 失败可重试 2 次，仍失败则 SKIP 并告知用户
// OPTIONAL: 失败直接 SKIP，不打扰用户
```

#### 回退链路记录

如果最终失败，用户看到的不是一句"出错了"，而是结构化的诊断报告：

```
## 任务执行报告

### 已完成
- ✓ 需求分析完成
- ✓ 创建查询「员工列表」（ID: 42）
- ✓ 创建查询「部门统计」（ID: 43）

### 失败
- ✗ 创建页面「员工管理」：页面生成超时

### 尝试的补救方案
1. 重试页面生成（失败：超时）
2. 简化页面布局再次尝试（失败：超时）

### 建议
- 已完成 2 个查询，可直接在页面中使用
- 建议手动创建页面后绑定查询
- 或检查网络连接后重试
```

---

### 3.7 超时控制（Timeout Control）

#### 为什么需要？

智能体协作是串行过程：A 做完轮到 B，B 做完轮到 C。任何一个环节卡住，后面全部排队等待。不同操作的时间预期差别很大——意图识别只需几秒，复杂页面生成可能需要几十秒。一刀切的超时会导致短了复杂任务总失败、长了简单任务用户空等。

#### 四层超时体系

```
┌─────────────────────────────────────────────────────────────┐
│ L1: 全局超时 (Global Timeout)                               │
│     默认: 300s (5分钟)                                      │
│     作用: 整个任务的总时间上限，兜底防止无限执行              │
│     超时策略: 返回已完成结果 + 诊断报告                      │
├─────────────────────────────────────────────────────────────┤
│ L2: 步骤超时 (Step Timeout)                                 │
│     默认: 120s                                              │
│     作用: 限制单个编排步骤（如"创建查询"这个步骤）           │
│     超时策略: 触发回退流程（RETRY → SWITCH → SKIP）          │
├─────────────────────────────────────────────────────────────┤
│ L3: Agent 执行超时 (Agent Timeout)                          │
│     默认: 60s                                               │
│     作用: 限制 AI 推理和决策的时间                           │
│     超时策略: 切换 Agent 执行器或降级                        │
├─────────────────────────────────────────────────────────────┤
│ L4: Skill 执行超时 (Skill Timeout)                          │
│     默认: 30s                                               │
│     作用: 限制具体工具调用（如 run_query 执行时间）          │
│     超时策略: 重试或换方案                                   │
└─────────────────────────────────────────────────────────────┘
```

#### 动态超时阈值

不同 Agent 和 Skill 的超时应该不同，不能一刀切：

| 操作类型 | 超时 | 原因 |
|----------|------|------|
| 意图识别 | 3s | 必须快，否则用户体验差 |
| 需求分析 | 60s | 需要多轮推理，合理给时间 |
| 创建查询 | 15s | 简单的 SQL 构建 |
| 执行查询 | 30s | 数据量大可能慢 |
| 生成页面代码 | 60s | 复杂页面需要更多时间 |
| 设计流程 | 45s | 中等复杂度 |

#### 进度反馈

超时发生前，用户应知道系统在做什么：

```
阶段 1: 执行中 → "正在分析需求..."
阶段 2: 接近超时（80%）→ "需求分析耗时较长，正在努力完成..."
阶段 3: 超时 → 返回已完成结果 + 诊断报告
```

---

### 3.8 安全权限控制（Security & Permission Control）

#### 为什么需要？

智能体拥有执行各类操作的权限：创建查询、删除页面、修改数据源。如果没有权限控制，任何用户（或攻击者）都能让 AI 执行危险操作。更隐蔽的风险是"越权执行"——用户 A 让智能体删除了用户 B 创建的页面。

#### 三层权限模型

```
┌─────────────────────────────────────────────────────────────┐
│ L1: 用户 (User)                                             │
│     每个用户有唯一 ID，属于一个或多个角色                    │
├─────────────────────────────────────────────────────────────┤
│ L2: 角色 (Role)                                             │
│     admin: 管理员，拥有所有权限                              │
│     developer: 开发者，可创建/修改/删除自己的资源            │
│     viewer: 只读用户，只能查看，不能修改                     │
│     custom: 自定义角色，按需配置                             │
├─────────────────────────────────────────────────────────────┤
│ L3: 权限 (Permission)                                       │
│     每个操作对应一个权限点                                   │
│     query:read / query:create / query:update / query:delete  │
│     page:read / page:create / page:update / page:delete      │
│     datasource:read / datasource:create / datasource:delete  │
│     workflow:read / workflow:create / workflow:manage        │
└─────────────────────────────────────────────────────────────┘
```

#### 操作敏感度分级

所有 Skill 按敏感度分级，不同级别对应不同的确认策略：

| 敏感度 | 操作示例 | 确认策略 | 撤销能力 |
|--------|----------|----------|----------|
| **LOW** | list_queries, list_pages, get_code_page | 无需确认 | 不适用 |
| **MEDIUM** | create_query, update_page, create_page | 用户口头确认 | 可撤销 |
| **HIGH** | delete_query, delete_page | 二次确认弹窗 | 软删除，可恢复 |
| **CRITICAL** | delete_datasource, delete_application | 管理员审批 + 二次确认 | 不可撤销 |

#### 资源归属与条件约束

权限不仅检查"能不能做这个操作"，还检查"能不能对这个特定资源做这个操作"：

```typescript
interface PermissionCheck {
  operation: string;       // 操作类型，如 "query:delete"
  resourceId: string;      // 目标资源 ID
  userId: string;          // 当前用户 ID
  resourceOwnerId: string; // 资源所有者 ID
}

// 规则
// 1. 管理员：可以操作任何资源
// 2. 资源所有者：可以操作自己的资源
// 3. 其他用户：无权操作
```

#### 审计日志

```typescript
interface AuditLog {
  timestamp: number;
  userId: string;
  userName: string;
  agentId: string;        // 哪个 Agent 执行的
  skillId: string;        // 哪个 Skill 被调用
  operation: string;       // 操作类型
  resourceId: string;      // 目标资源
  result: 'success' | 'failure';
  input: string;           // 用户输入（脱敏后）
  ip: string;
}
```

#### 高风险操作影响范围预览

对于 HIGH 和 CRITICAL 级别的操作，执行前展示影响范围：

```
┌─────────────────────────────────────────┐
│  ⚠ 确认删除查询「员工列表」？           │
│                                         │
│  影响范围：                              │
│  · 页面「员工管理」将失去数据源         │
│  · 页面「仪表盘」的指标卡将失效         │
│                                         │
│  此操作不可撤销                         │
│  建议：先确认页面是否已不再使用此查询    │
│                                         │
│  [取消]  [确认删除]                     │
└─────────────────────────────────────────┘
```

---

### 3.9 记忆类技能（Memory Skills）

#### 为什么需要？

当前每个对话都是独立的，系统不知道用户之前做过什么、偏好什么、项目里有什么约定。用户每次都要重复说"用 Ant Design 风格"、"字段名用英文下划线"。没有记忆的系统，每次都是"初次见面"。

#### 三种记忆类型

```
┌─────────────────────────────────────────────────────────────┐
│ 项目记忆 (Project Memory)                                   │
│ 作用域: 当前应用                                             │
│ 内容:                                                       │
│  · 业务规则: "所有字段用英文下划线"                          │
│  · 技术选型: "使用 Chart.js 4.x"                            │
│  · 命名规范: "查询命名用驼峰，页面命名用中文"                │
│  · 已知约束: "员工数据只有姓名和部门，没有薪资"              │
│ 生命周期: 与项目同生命周期                                   │
├─────────────────────────────────────────────────────────────┤
│ 用户偏好 (User Preference)                                  │
│ 作用域: 当前用户，跨项目                                     │
│ 内容:                                                       │
│  · 回复风格: "简洁回复，不要详细分析"                        │
│  · 技术偏好: "优先使用 React Hooks"                          │
│  · 交互习惯: "不要自动创建计划，先和我确认"                  │
│ 生命周期: 长期，可手动管理                                   │
├─────────────────────────────────────────────────────────────┤
│ 任务记忆 (Task Memory)                                      │
│ 作用域: 当前对话会话                                         │
│ 内容:                                                       │
│  · 执行轨迹: 做了什么、做到哪了                              │
│  · 决策记录: 为什么选择这个方案                              │
│  · 中间产物: 分析报告、查询 ID、页面 ID                      │
│ 生命周期: 与对话同生命周期，支持断点续传                     │
└─────────────────────────────────────────────────────────────┘
```

#### 自动存储与检索

系统在 Agent 执行过程中自动判断哪些信息值得长期保存：

**存储触发条件**：
- 用户多次提到同一规范（如第 3 次提到"字段用英文"）
- 用户明确说"记住"、"以后都这样"、"这是我的习惯"
- 用户澄清或纠正了一个需求（说明之前的理解有偏差）
- 一个关键决策被确认（如选择了某个技术方案）

**检索触发条件**：
- 新任务开始时，自动检索相关项目记忆和用户偏好
- 用户提出模糊需求时，检索相似的历史任务
- Agent 执行前，检索相关约束条件

#### 记忆的关联与衰减

```
记忆权重 = 基础权重 × 时间衰减 × 引用频率 × 关联度

基础权重:
  - 用户明确说"记住"的: 1.0
  - 系统自动识别的: 0.7

时间衰减:
  - 最近 7 天: 1.0
  - 7-30 天: 0.8
  - 30-90 天: 0.5
  - >90 天: 0.3

引用频率:
  - 被引用 0 次: 1.0
  - 被引用 1-3 次: 1.2
  - 被引用 >3 次: 1.5

关联度:
  - 同项目: 1.0
  - 同用户: 0.5
  - 其他: 0.1
```

#### 记忆驱动主动建议

当用户提出新需求时，系统主动关联记忆：

```
用户: "创建一个员工查询"

系统: "好的。我注意到您之前创建过一个「员工列表」查询（ID: 42），
      包含姓名、部门、职位字段。这次是新建一个还是在其基础上修改？"
```

#### 记忆可见性与可控性

用户可随时查看和管理记忆：

```
记忆管理面板:
┌─────────────────────────────────────────────┐
│ 项目记忆 - 当前应用                          │
│ ├─ "所有字段用英文下划线" [删除]             │
│ ├─ "使用 Chart.js 4.x" [删除]                │
│ └─ "员工数据没有薪资字段" [删除]             │
│                                              │
│ 用户偏好                                     │
│ ├─ "简洁回复" [删除]                         │
│ └─ "不要自动创建计划" [删除]                 │
│                                              │
│ [清除所有记忆] [导出记忆]                     │
└─────────────────────────────────────────────┘
```

---

### 3.10 意图置信度阈值（Intent Confidence Threshold）

#### 为什么需要？

意图识别是分类问题，任何分类都有不确定性。用户说"做一个员工管理页面"意图清晰，但说"帮我弄一下那个东西"就模糊。如果没有置信度阈值，低置信度的意图也会被执行，结果就是做错事。如果阈值太高，本可正确识别的意图也会被拒绝，用户体验差。

#### 三级置信度区间

```
┌─────────────────────────────────────────────────────────────┐
│ HIGH CONFIDENCE (>0.9)                                      │
│ 策略: 直接执行，不打扰用户                                   │
│ 示例: "创建员工查询" → 识别为 data_operation，置信度 0.95   │
│       → 直接委派给 DBA                                       │
├─────────────────────────────────────────────────────────────┤
│ MEDIUM CONFIDENCE (0.7-0.9)                                 │
│ 策略: 向用户确认                                             │
│ 示例: "帮我弄一下数据" → 可能意图: data_operation(0.75)     │
│       → "您是想创建查询、修改查询，还是查看数据源？"         │
├─────────────────────────────────────────────────────────────┤
│ LOW CONFIDENCE (<0.7)                                       │
│ 策略: 不猜测，引导用户更清晰表达                             │
│ 示例: "那个东西" → 置信度 <0.5                              │
│       → "抱歉，我不太确定您想做什么。能否详细描述一下？"     │
│       同时限制技能范围，只允许读操作                         │
└─────────────────────────────────────────────────────────────┘
```

#### 多信号综合计算

置信度不是只靠关键词匹配，而是综合多个信号：

```
总置信度 = w1 × 语义相似度 + w2 × 上下文一致性 + w3 × 行为信号 + w4 × 历史准确率

w1=0.4: 语义相似度
  - 用户输入与意图模板的语义匹配程度
  - 使用 embedding 相似度计算

w2=0.3: 上下文一致性
  - 是否符合对话历史的话题走向
  - 如果之前一直在讨论数据，则 data_operation 权重增加

w3=0.2: 行为信号
  - 用户当前在哪个页面（在数据源页面 → 更可能是数据操作）
  - 用户刚操作了什么功能

w4=0.1: 历史准确率
  - 该意图在历史上被正确识别的比例
  - 系统越用越准
```

#### 意图消歧机制

当多个意图的置信度接近时（差距 < 0.1），系统不能简单地选最高的：

```
场景: 用户说"做一个查询"
  候选意图:
    data_operation: 0.65  （创建数据查询）
    workflow_design: 0.58  （创建工作流查询）

系统行为:
  1. 识别到两个意图置信度接近 → 存在歧义
  2. 主动提问消歧：
     "您是想创建数据查询（从数据库取数据），还是创建审批查询（关联工作流）？"
  3. 用户确认后，将确认信号作为反馈更新模型
```

#### 置信度反馈闭环

```typescript
interface FeedbackSignal {
  intentId: string;
  predictedConfidence: number;
  userAction: 'confirmed' | 'corrected' | 'ignored';
  correctedIntent?: string;
  timestamp: number;
}

// 确认了 → 该意图权重 +0.05
// 纠正了 → 错误意图权重 -0.1，正确意图权重 +0.05
// 忽略了 → 所有候选意图权重 -0.02
```

#### 降级策略与置信度联动

低置信度时不仅不执行，还要限制能力范围：

| 置信度 | 可用技能 | 执行模式 |
|--------|----------|----------|
| >0.9 | 全部技能 | 自动执行 |
| 0.7-0.9 | 全部技能 | 确认后执行 |
| 0.5-0.7 | 只允许读操作（list/get） | 引导模式 |
| <0.5 | 只允许读操作 | 强制澄清模式 |

---

### 3.11 Agent 间上下文传递协议（Context Transfer Protocol）

#### 为什么需要？

**当前行为：每个 Agent 的 LLM 对话记录完全隔离，互不可见。**

```
主智能体的 LLM 对话                           DBA 智能体的 LLM 对话
┌──────────────────────────────┐              ┌──────────────────────────────┐
│ system: 你是主智能体...       │              │ system: 你是 DBA...           │
│ user: 做一个员工管理系统      │              │ user: 为「员工管理」创建查询   │
│ assistant: 调用 analyze_...  │              │       「employeeList」         │
│ tool: 分析报告...            │   委派       │       需要姓名、部门、职位     │
│ assistant: 分析完成，确认...  │ ──────────►  │ assistant: 调用 list_...     │
│ user: 确认                   │              │ tool: 数据源列表...           │
│ assistant: 调用 delegate_... │              │ ...（只有 DBA 自己的对话）    │
│ ...（10 轮对话）             │              │                              │
│                              │              │ ❌ 看不到分析报告            │
│ ❌ DBA 返回后，主智能体       │              │ ❌ 看不到用户原始需求        │
│    看不到 DBA 内部推理过程    │              │ ❌ 不知道这是第 2/8 步        │
└──────────────────────────────┘              └──────────────────────────────┘
```

**这带来的问题：**

| 问题 | 具体表现 |
|------|----------|
| DBA 不知道全局目标 | 只知道"创建 employeeList 查询"，不知道这是给仪表盘用的、属于 HR 驾驶舱的第 3 步 |
| DBA 重复探索 | 主智能体已经 list_datasources 过了，DBA 不知道，又调一遍 |
| DBA 不知道约束条件 | 分析报告说"数据量约 200 条，无需分页"，DBA 不知道，可能加不必要的分页 |
| 主智能体不知道 DBA 推理过程 | DBA 内部尝试了 2 种方案后选了第 3 种，主智能体只知道最终结果 |
| 用户看不到完整链路 | 最终告诉用户"查询已创建"，但用户不知道 DBA 是怎么做到的 |

**两种错误做法（不要做）：**

```
方案 A：全量复制对话历史（❌）
  把主智能体的 10 轮对话全部复制给 DBA
  → Token 浪费：DBA 只需要 2% 的信息，却要处理 100% 的噪音
  → 干扰判断：DBA 看到"分析助手说字段 A 很重要"，但字段 A 实际不存在

方案 B：完全隔离，只传一句话（❌ 当前做法）
  只告诉 DBA "创建查询 employeeList，需要姓名、部门、职位"
  → 信息不足：DBA 不知道全局目标、不知道约束条件、不知道已有资源
  → 重复探索：DBA 从头开始探索数据源，浪费时间和 Token
```

**正确做法：结构化增量传递（✓）**

不传全量对话历史，也不只传一句话，而是传递一个结构化的上下文包，只包含子 Agent 真正需要的信息。

#### 标准化交接上下文结构

子 Agent 接收到的不是一段自然语言，而是结构化的 `HandoffContext`：

```typescript
interface HandoffContext {
  // 元信息
  protocolVersion: string;       // 协议版本，如 "1.0"
  handoffId: string;             // 本次交接的唯一 ID
  timestamp: number;

  // 委派来源
  source: {
    agentId: string;             // 如 "main-agent"
    agentName: string;           // 如 "主智能体"
    handoffReason: string;       // 为什么委派，如 "需要创建数据查询"
  };

  // 任务描述
  task: {
    description: string;         // 要做什么
    goal: string;                // 最终目标（为什么做这个）
    constraints: string[];       // 约束条件
    // 如 ["不要修改已有查询", "查询名用英文驼峰"]
  };

  // 已提供的资源
  resources: {
    pages?: Array<{ id: number; name: string }>;
    queries?: Array<{ id: number; name: string; description: string }>;
    datasources?: Array<{ id: number; name: string; type: string }>;
    plans?: Array<{ id: string; description: string }>;
  };

  // 期望输出格式
  expectedOutput: {
    format: 'structured' | 'natural_language';
    requiredFields: string[];
    // 如 ["queryId", "queryName", "fields", "dataQuality"]
  };

  // 来源链（追溯信息源头）
  traceChain: Array<{
    agentId: string;
    timestamp: number;
    action: string;              // 如 "分析需求", "创建查询计划"
  }>;

  // 增量上下文（只传递当前 Agent 需要的信息）
  delta: {
    previousResults?: Record<string, unknown>;
    // 上一环节的关键结果
    relevantHistory?: string;
    // 相关对话历史摘要
  };
}
```

#### "上下文传递即承诺"原则

```
上层 Agent 传递什么 → 下层 Agent 就相信什么，不再重复验证
下层 Agent 返回什么 → 上层 Agent 也相信并直接使用

前提: 传递前必须经过"打包验证"
  - 内容完整性检查: 必需字段是否齐全？
  - 格式正确性检查: 是否符合 schema？
  - 资源有效性检查: 引用的资源 ID 是否存在？
```

#### 上下文追溯链

每个上下文包携带"来源链"记录，任何环节都能追溯信息源头：

```
traceChain: [
  { agentId: "main-agent",    action: "接收用户需求" },
  { agentId: "analysis-assistant", action: "分析需求 → 拆解为3个话题" },
  { agentId: "main-agent",    action: "确认计划 → 开始执行" },
  { agentId: "data-assistant", action: "当前: 创建查询「员工列表」" },
]

当出现问题时:
  "查询字段不匹配" → 追溯链定位到 analysis-assistant 的分析结果
  → 确认是分析阶段遗漏了字段，还是 DBA 阶段选错了表
```

#### 增量上下文传递，而非全量复制

一个 Agent 不需要知道前面所有 Agent 的全部历史，只需要知道"我需要关心什么"：

```
全量传递（❌ 当前方式）:
  复制整个对话历史 + 所有分析报告 + 所有查询列表
  → token 浪费严重，噪音干扰大

增量传递（✓ 目标方式）:
  只传递对当前 Agent 有意义的信息：
  · 我要创建什么查询？ → task.description
  · 不能做什么？ → task.constraints
  · 已有哪些查询？ → resources.queries
  · 上一个环节做了什么？ → delta.previousResults
```

#### 上下文包版本管理

随着任务推进，上下文会不断更新，但子 Agent 可能拿到的还是旧版本：

```typescript
// 版本号格式: {major}.{minor}
// major: 任务推进到新阶段时递增
// minor: 同一阶段内上下文微调时递增

const handoffV1 = { protocolVersion: "1.0", handoffId: "h-001", ... };
const handoffV2 = { protocolVersion: "1.1", handoffId: "h-001", ... };

// Agent 接收时检查版本
if (currentVersion !== latestVersion) {
  // 请求 Main Loop 下发最新版本
  const updated = await requestLatestContext(handoffId);
}
```

#### 标准化结果返回格式

子 Agent 返回的不再是自然语言，而是结构化的结果对象：

```typescript
interface AgentResult {
  // 执行状态
  status: 'success' | 'partial_success' | 'failure';

  // 产出物
  artifacts: Array<{
    type: 'query' | 'page' | 'datasource' | 'workflow' | 'plan';
    id: string | number;
    name: string;
    metadata?: Record<string, unknown>;
  }>;

  // 副作用声明（我创建了什么、修改了什么、删除了什么）
  sideEffects: SideEffect[];

  // 给主 Agent 的建议
  suggestions: string[];

  // 需要注意的风险
  risks: string[];

  // 自然语言摘要（给用户看）
  summary: string;

  // 结构化数据（给主 Agent 解析用）
  structuredData?: Record<string, unknown>;
}
```

---

## 四、实施路径（更新）

### 4.1 分阶段实施

| 阶段 | 内容 | 工期估计 | 风险 | 依赖 |
|------|------|----------|------|------|
| **Phase 1: 技能注册表** | 创建 Skill Registry，将现有工具迁移为独立 Skill，Agent 通过 ID 引用 | 3天 | 低 | - |
| **Phase 2: 共享上下文** | 创建 Shared Context，统一管理应用状态、页面列表、查询列表等 | 2天 | 低 | Phase 1 |
| **Phase 3: 意图引擎 + 置信度阈值** | 创建 Intent Engine，替换 @mention 路由；实现三级置信度区间、多信号计算、意图消歧、反馈闭环 | 3天 | 中 | Phase 2 |
| **Phase 4: 上下文传递协议** | 实现标准化 HandoffContext、打包验证、追溯链、增量传递、版本管理、AgentResult 标准化格式 | 3天 | 高 | Phase 2 |
| **Phase 5: Main Loop 编排** | 在 agentLoop 基础上增加上下文装配、结果验证、状态同步、冲突合并 | 5天 | 高 | Phase 3, 4 |
| **Phase 6: 失败回退 + 超时控制** | 实现错误分类、五级回退策略、步骤权重标记、四层超时体系、动态阈值、进度反馈 | 4天 | 中 | Phase 5 |
| **Phase 7: 安全权限控制** | 实现三层权限模型、操作敏感度分级、资源归属检查、审计日志、影响范围预览 | 3天 | 中 | Phase 1 |
| **Phase 8: 记忆类技能** | 实现三种记忆类型、自动存储/检索、权重衰减、主动建议、记忆管理面板 | 4天 | 低 | Phase 2 |
| **Phase 9: 端到端验证** | 实现整体任务完成后的验证检查、诊断报告生成 | 1天 | 低 | Phase 5, 6 |

### 4.2 向后兼容策略

- Phase 1-2 不改变现有行为，只是重构内部实现
- Phase 3 引入意图引擎，保留 @mention 路由作为降级方案
- Phase 5-6 逐步增强 Main Loop，不影响现有功能
- Phase 7 开始时默认全权限，逐角色收紧
- Phase 8 可选功能，默认关闭，用户手动开启

### 4.3 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `agent/registry/skillRegistry.ts` | **新增** | 技能注册表，所有 Skill 独立注册 |
| `agent/registry/agentRegistry.ts` | **重构** | Agent 改为通过 Skill ID 引用技能，增加 persona、decisionRules、allowedSkills |
| `agent/core/sharedContext.ts` | **新增** | 共享上下文，统一管理应用状态 |
| `agent/core/intentEngine.ts` | **新增** | 意图引擎 + 置信度计算 + 消歧 + 反馈闭环 |
| `agent/core/handoffProtocol.ts` | **新增** | 上下文传递协议：HandoffContext、AgentResult、打包验证、追溯链、版本管理 |
| `agent/core/failureRecovery.ts` | **新增** | 失败回退：错误分类、五级回退策略、步骤权重、诊断报告生成 |
| `agent/core/timeoutManager.ts` | **新增** | 超时控制：四层超时体系、动态阈值、进度反馈 |
| `agent/core/permissionGuard.ts` | **新增** | 权限控制：三层模型、敏感度分级、资源归属、审计日志 |
| `agent/core/memoryManager.ts` | **修改** | 增强现有 MemoryManager，增加三种记忆类型、权重衰减、主动建议 |
| `agent/core/mainLoop.ts` | **新增** | 主编排循环：9 步编排流程 |
| `agent/core/agentLoop.ts` | **修改** | 保留核心循环，增加上下文注入、超时控制 |
| `agent/core/AgentFactory.ts` | **修改** | 适配新架构，接受 HandoffContext |
| `agent/core/chatRouter.ts` | **修改** | 适配意图引擎，保留 @mention 降级 |
| `agent/prompts/systemPrompt.ts` | **修改** | 主智能体提示词增强：审核报告、执行前自检、端到端检查 |
| `agent/prompts/dbaPrompt.ts` | **修改** | DBA 增加数据质量检查、影响分析 |
| `agent/prompts/workflowAgent.ts` | **修改** | 流程助手增加业务场景分析、自检、测试建议 |
| `agent/prompts/analysisAgent.ts` | **修改** | 分析助手增加权限、状态、导航三个分析维度 |

---

## 五、核心设计原则

1. **Agent 与 Skill 解耦**：Agent 定义"谁来做"，Skill 定义"能做什么"，通过 Skill ID 桥接
2. **Main Loop 最复杂**：所有编排逻辑（意图识别、上下文装配、调度、验证、合并、同步、回退、超时）都在 Main Loop
3. **Agent 保持简洁**：Agent 只负责角色定义和 LLM 推理决策，不关心编排逻辑
4. **Skill 保持纯粹**：Skill 只负责工具执行，不关心业务逻辑
5. **Shared Context 单一真相源**：所有 Agent 共享同一份上下文，避免信息不一致
6. **上下文传递即承诺**：上层传递什么下层就信什么，传递前必须打包验证
7. **失败优于猜测**：低置信度时不执行，宁可多问一句也不做错事
8. **增量优于全量**：上下文传递只传增量，不传全量
9. **向后兼容**：分阶段实施，每阶段不破坏现有功能

---

## 六、目标智能体思维链

### 主智能体（增强后）
```
意图识别 → 上下文装配 → 委派分析 → 审核分析报告 → 确认计划 → 执行前自检 → 委派执行 → 执行后验证 → 冲突合并 → 状态同步 → 端到端检查 → 用户响应
```

### 需求分析助手（增强后）
```
话题拆解 → 逐话题分析（UI/数据/Query/流程/API/权限/状态/导航 八维）→ 冲突合并 → 风险提示 → 创建计划
```

### 数据辅助智能体（增强后）
```
理解业务上下文 → 检查数据源 → 看表结构 → 创建查询 → 数据质量检查 → 影响分析 → 汇报
```

### 流程设计助手（增强后）
```
业务场景分析 → 流程结构分析 → 表单字段分析 → 设计流程 → 设计表单 → 绑定 → 自检 → 测试建议 → 汇报
```

---

## 七、度量指标

| 指标 | 当前值 | 目标值 |
|------|--------|--------|
| Agent 与 Skill 耦合度 | 硬编码绑定 | 通过 ID 引用，可动态组合 |
| 委派反馈链长度 | 4-5 步 | 2-3 步（主 Loop 直接装配上下文） |
| 上下文装配方式 | 手动拼接 | 结构化 HandoffContext 自动装配 |
| 上下文传递方式 | 全量复制 | 增量传递 |
| 结果验证 | 无 | 自动验证 + 质量报告 |
| 状态同步 | 手动刷新 | 侧Effect 自动同步 |
| 意图识别方式 | @mention 路由 | 多信号置信度 + @mention 降级 |
| 失败处理 | 无统一机制 | 五级回退策略 + 诊断报告 |
| 超时控制 | 单一超时 | 四层超时体系 + 动态阈值 |
| 权限控制 | 无 | 三层模型 + 敏感度分级 + 审计 |
| 记忆能力 | 无 | 三种记忆类型 + 自动衰减 |
| 端到端验证 | 无 | 自动检查 + 诊断报告 |

---

## 八、附录：六机制关联关系

```
用户输入
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          MAIN LOOP                                   │
│                                                                     │
│  ① 意图识别 ← 3.10 置信度阈值                                       │
│      │                                                              │
│      ▼                                                              │
│  ② 上下文装配 ← 3.11 传递协议（HandoffContext）                      │
│      │                                                              │
│      ▼                                                              │
│  ③ Agent 调度                                                        │
│      │                                                              │
│      ├── 执行前: 3.8 权限检查（操作敏感度 + 资源归属）               │
│      │                                                              │
│      ├── 执行中: 3.7 超时控制（四层超时 + 进度反馈）                 │
│      │                                                              │
│      └── 执行后: 3.6 失败回退（错误分类 + 五级策略）                 │
│      │                                                              │
│      ▼                                                              │
│  ④ 结果验证 + 冲突合并                                               │
│      │                                                              │
│      ▼                                                              │
│  ⑤ 状态同步 → Shared Context                                        │
│      │                                                              │
│      ▼                                                              │
│  ⑥ 用户响应                                                          │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│  贯穿全程:                                                            │
│  3.9 记忆（自动存储/检索 + 主动建议）                                │
│  3.11 传递协议（追溯链 + 版本管理）                                  │
│  3.8 审计日志（全程记录）                                            │
└─────────────────────────────────────────────────────────────────────┘
```