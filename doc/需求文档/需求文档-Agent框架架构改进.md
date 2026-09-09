# 需求文档：AI Agent 框架架构改进

## 版本

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| v1.0 | 2026-09-08 | — | 基于 chat.log 事故复盘 + 前端 Agent 框架整体评审，形成改进需求 |
| v1.1 | 2026-09-09 | — | 阶段 1（R1/R3/R11）实施完成，含实施记录见附录 A |
| v1.2 | 2026-09-09 | — | 阶段 2（R2/R7）实施完成，含实施记录见附录 B |
| v1.3 | 2026-09-09 | — | 阶段 3（R4 + R5 务实子集）实施完成，含实施记录见附录 C |
| v1.4 | 2026-09-09 | — | chat.log 二次回归（页面生成场景）复盘修复，含实施记录见附录 D |

---

## 一、背景

### 1.1 事故复盘（直接动因）

2026-09-08 用户创建"请假审批流程"，需求明确包含**条件分支（≤3天/＞3天）、部门经理审批、驳回退回发起人、加签**，但最终系统中流程仅剩"发起→直属上级审批→结束"，四个要素全部静默丢失，而系统各环节（子智能体、委派层、计划层、最终汇报）**全部报告成功**。

完整事故链：

1. 计划步骤 1（仅设计表单）被委派后，子智能体按内置提示词"描述了表单字段就做完整四步"越权创建了一个自行推断的基础流程（流程 ID 17）；
2. 步骤 2 委派修改流程 17 时，提示词要求调用 `update_workflow`，但该工具**未注册**进 `workflow-assistant` 的 `allowedSkills`，调用报"工具不存在"，子智能体回复"执行完毕。"后静默放弃；
3. `delegate_workflow` 无条件返回 `success: true`，主智能体将失败步骤标记为 completed，`validate_plan` 仅数状态即验证通过；
4. 最终向用户汇报"条件分支已配置"——与系统真实状态不符。

### 1.2 事故暴露的结构性问题

单点缺陷（工具漏注册）只是诱因。根因是框架设计上**凡是"模型说了算"的关键节点（步骤完成、任务成败、用户确认）都缺少框架层的第二信源**，且提示词与工具注册两套体系无一致性保障。本文档将评审发现的所有设计问题整理为可实施的改进需求。

### 1.3 近期已完成的修复（2026-09-08，作为本需求的起点）

| 修复项 | 位置 | 说明 |
|--------|------|------|
| `update_workflow` 注册 | agentRegistry.ts | `workflow-assistant.allowedSkills` 补充 `workflow:update_definition` |
| `get_definition` 只读工具 | workflowSkills.ts | 修改流程前"先读后写"，返回节点/连线结构摘要 |
| `delegate_workflow` 支持 `task_type` | delegateSkills.ts | 与计划自动推导的 `toolInput.task_type` 对齐，按类型裁剪提示词，禁止步骤 1 越权建流程 |
| 委派记忆 | delegateSkills.ts | `delegate:workflow` 读写 `agentMemory`，跨步骤传递表单 ID/字段 key |
| 委派失败检测 | delegateSkills.ts | 扫描子智能体 tool 消息，存在 `success:false` 时委派层返回失败 |
| 引擎语义声明 | delegateSkills.ts / workflowAgent.ts | 声明"驳回退回发起人是引擎默认、加签是任务操作"，禁止编造 `allowReject` 等无效节点配置 |

以上为点状修复。下述需求解决的是让这类事故**在架构上不再可能发生**。

---

## 二、问题清单与分级

分级标准：
- **P0**：已造成或必然造成"结果错误但报成功"类事故；
- **P1**：规模化使用（长任务、多次委派、多会话）时必然爆发；
- **P2**：健壮性/可维护性问题。

| 编号 | 问题 | 级别 | 关键代码位置 |
|:--:|------|:--:|------|
| R1 | 提示词承诺的工具与工具注册表无一致性校验 | P0 | agentRegistry.ts / delegateSkills.ts / prompts/* |
| R2 | 计划步骤完成无事实校验（grounding），强制继续指令激励撒谎 | P0 | AgentFactory.ts(onShouldComplete) / planSkills.ts(validate_plan) |
| R3 | 破坏性操作的安全声明未接线 | P0 | skillRegistry.ts(requiresConfirmation/isDangerous) / agentLoop.ts |
| R4 | 无上下文窗口管理 | P1 | agentLoop.ts(buildAPIMessages) / agentMemory.ts / config.ts(maxIterations=100) |
| R5 | 记忆体系三套并存、语义不一致 | P1 | agentMemory.ts / memoryManager.ts / agentStore.ts |
| R6 | 子智能体提示词双份维护、身份非一等公民 | P1 | delegateSkills.ts 内联提示词 / workflowAgent.ts / chatRouter.ts:240 |
| R7 | 委派协议"自然语言进、散文出"，无结构化结果契约 | P1 | delegateSkills.ts |
| R8 | 并发防护为模块级单例；委派不可重入 | P2 | delegateSkills.ts(activeDelegations) / chatRouter.ts(routeTo) |
| R9 | 用户确认靠正则猜文本 | P2 | agentStateMachine.ts(isUserConfirming) |
| R10 | 分析评分为正则启发式却输出权威分数 | P2 | planSkills.ts(validateAnalysisBasics) |
| R11 | 提示词改动无自动化评测手段 | P2 | registry/test/testCases.ts（手工清单） |

---

## 三、需求详述

### R1（P0）提示词-工具一致性校验

**目标**：提示词中提到的任何工具名，必须在该智能体实际可用的工具列表中存在；不存在则在开发阶段报警，而不是运行时由模型撞上"工具不存在"。

**方案要点**：
1. 新增 `validatePromptToolConsistency(agentDef, resolvedTools)`，dev/build 模式下对每个 agent 执行：
   - 扫描 `buildSystemPrompt` 产物 + 各 delegate 内联提示词，提取工具名（匹配工具命名约定，如 `[a-z_]+` 且命中已知工具名集合/或用反引号标注约定）；
   - 与 `resolveAgentTools` 结果求差集，缺失即 `console.error` 并列出缺失工具名；
2. 同样校验 `planSkills` 自动推导的 `toolName` 必须可解析；
3. 在 CI / `npm run build` 前置脚本中执行。

**验收标准**：
- 复现 `update_workflow` 场景（allowedSkills 移除该 skill）时，构建阶段报错并指明缺失工具与所属智能体；
- 正常构建无告警。

### R2（P0）计划步骤完成的 grounding 校验

**目标**：步骤状态从"模型自报"改为"模型声明 + 框架核验"双信源，杜绝"工具失败但步骤标记完成"。

**方案要点**：
1. `update_plan_item` 标记 completed 时，框架按步骤的 `toolName` 做副作用核验（可配置的 verifier 注册表），例如：
   - `delegate_workflow`（design_form）→ 查询表单是否存在且字段匹配；
   - `delegate_workflow`（design_workflow）→ 查询流程定义是否存在且节点数/分支数与描述一致；
   - `create_code_page` / `update_code_page` → 查询页面是否存在且代码非空；
   - 核验失败 → 拒绝 completed，返回核验差异给模型并标记 error；
2. 重新评估 `onShouldComplete` 的强制继续指令措辞：将"禁止结束对话"改为"继续执行未完成步骤，若步骤无法完成，如实说明原因并将该步骤标记为 error"——消除"把步骤标完成以结束对话"的激励；
3. `validate_plan` 除数状态外，输出每个步骤 result 的摘要供主智能体汇报时对照。

**验收标准**：
- 人为让子智能体工具失败时，对应步骤无法被标记为 completed，计划状态为 error/stopped，用户看到失败汇报；
- 正常流程执行全程无 ложных（误报）核验失败。

### R3（P0）破坏性操作确认机制接线

**目标**：`requiresConfirmation` / `isDangerous` 从"声明字段"变成"运行时机制"。

**方案要点**：
1. 为 `query:delete`、`page:delete`、`api:delete`、`cancel_workflow`、`datasource:disconnect` 等技能补标 `isDangerous: true`（及需要的 `requiresConfirmation: true`）；
2. agentLoop 执行工具前检查标记：dangerous 且本次会话未获用户对该操作的确认时，不执行，返回结构化确认请求（`_pause` 机制已有，可复用），用户在 UI 确认后放行；
3. UI 增加确认交互（复用现有暂停-继续链路）。

**验收标准**：
- 模型直接调用 delete 类工具时，未确认前不产生实际删除副作用；
- 用户确认后可正常执行；
- 非危险工具不受影响。

### R4（P1）上下文窗口管理

**目标**：长任务（多轮工具调用、多次委派）下 API 消息总长度可控，不因上下文溢出导致任务失败或成本失控。

**方案要点**：
1. 建立消息预算：按 token（或字符近似）设系统提示词/历史消息/工具结果三档预算；
2. 工具结果入库前做体积裁剪（大 JSON 只保留摘要 + 截断标记），完整结果仍可供 UI 展示；
3. 超预算时按策略压缩：优先丢弃历史轮的 tool 结果原文（保留 assistant 结论），更激进时对早期对话做摘要；system 消息与最近 N 轮永不裁剪；
4. `agentMemory` 保存的消息同样过裁剪管线，并设条数/体积上限（如最近 200 条）。

**验收标准**：
- 模拟 100 轮迭代的会话，发送给 API 的消息长度有上界；
- 裁剪后任务仍能正常继续（关键信息不丢：计划 ID、已创建资源 ID、字段 key）。

### R5（P1）记忆体系收敛

**目标**：明确记忆的唯一真相源与生命周期，消除三套存储各自为政。

**方案要点**：
1. 梳理三层现状（`agentMemory` 内存 Map / `memoryManager` IndexedDB / `agentStore` localStorage）各自职责，收敛为：会话内记忆（executor 上下文）+ 跨会话持久化（IndexedDB）两层，废弃或合并冗余层；
2. 统一委派记忆读写入口（`delegate:query` 与 `delegate:workflow` 共用同一 helper），保证行为一致；
3. 定义子智能体记忆生命周期（默认：随应用会话存活、条数有上限、提供清除入口），写入文档。

**验收标准**：所有委派路径的记忆行为一致且有界；代码中不存在两处以上独立的消息持久化写入点。

### R6（P1）子智能体身份一等公民化

**目标**：智能体的提示词与工具由 `AgentDefinition` 唯一拥有，委派只传任务与上下文。

**方案要点**：
1. `delegate:workflow` 删除内联的 300 行流程专家提示词，改为复用 `WORKFLOW_AGENT_PROMPT` + 按 `task_type` 追加"本次任务范围"小节（阶段限定规则作为可组合片段，抽到 promptFragments）；
2. `chatRouter.createExecutor` 消除 `agentType` 二值硬编码（`'main-agent' | 'data-assistant'`），以 `agentDef.id` 驱动差异；
3. `delegate:query` 的内联工具列表改为引用 agentRegistry 的 `allowedSkills` 单一来源。

**验收标准**：同一智能体的行为规则只存在一份定义；修改流程助手提示词只需改一处。

### R7（P1）结构化委派契约

**目标**：委派结果可被程序消费，主智能体不再靠读散文理解执行结果。

**方案要点**：
1. 定义委派结果 schema：`{ success, outcomes: [{ type: 'form'|'workflow'|'binding'|'query'|..., id, name, fields?/nodes? }], failures: [{ tool, message }] }`；
2. 子智能体汇报走结构化约定（最终回复要求 JSON 块，或由 delegate 层从 tool 消息中聚合——优先后者，不依赖模型格式自觉）；
3. `delegate_workflow` / `delegate_query` 返回结构化 `data`，message 面向模型保留人话摘要；
4. 主智能体提示词同步说明如何消费 outcomes（如后续步骤引用上一步表单 ID）。

**验收标准**：委派返回的 `data.outcomes` 可直接供计划下一步骤使用（例：步骤 2 的条件表达式字段 key 来自步骤 1 的 outcomes.fields）；failures 驱动步骤 error 状态。

### R8（P2）并发与可重入

**方案要点**：`activeDelegations` 键加入会话 ID（如 `${sessionId}:workflow`）；`ChatRouter.routeTo` 用栈结构替代单变量保存/恢复 activeAgent，支持委派嵌套。

### R9（P2）确认动作显式化

**方案要点**：AWAITING_CONFIRM 状态下 UI 提供明确的"确认/取消"按钮，作为事件直接驱动状态机与 `confirm_plan`；正则 `isUserConfirming` 仅作为无按钮场景（如移动端输入）的降级路径保留。

### R10（P2）评分呈现修正

**方案要点**：`validateAnalysisBasics` 的启发式检查结果以"检查项通过/未通过"清单呈现，不再合成单一百分制分数展示给用户；分数仅供内部排序参考。

### R11（P2）提示词回归评测（eval）基建

**方案要点**：
1. 将 `testCases.ts` 的手工用例改造为可执行 eval：固定用户输入 + LLM 判分（或断言工具调用序列包含/不包含某工具）；
2. 覆盖关键回归场景（首批）：
   - 流程需求：条件分支场景必须出现 `design_workflow` 且节点含 condition 分支；
   - 修改流程场景：必须先 `get_definition` 再 `update_workflow`，禁止直接 `design_workflow`；
   - 表单-only 委派：`task_type=design_form` 时不得出现 `design_workflow` 调用；
   - 失败场景：工具报错后委派层返回 `success:false`；
3. 接入 CI（可选 nightly），提示词改动必须跑首批场景。

**验收标准**：本需求文档 1.1 节的事故场景作为 eval 用例之一，能在工具未注册/提示词漂移时失败报警。

---

## 四、实施路线建议

| 阶段 | 内容 | 说明 |
|:--:|------|------|
| 阶段 1 | R1 + R3 + R11（首批 eval） | 改动小、直接封堵事故类别；R11 把 1.1 事故固化为回归用例 |
| 阶段 2 | R2 + R7 | 计划正确性双信源 + 结构化委派契约，两者配合落地效果最佳 |
| 阶段 3 | R4 + R5 | 上下文与记忆基建，为长任务铺路 |
| 阶段 4 | R6 + R8 + R9 + R10 | 抽象收敛与体验优化 |

依赖关系：R2 的副作用核验依赖 R7 的结构化 outcomes（核验逻辑可先以步骤 toolName 维度实现，R7 落地后收敛）；R11 的"失败场景"用例依赖 R2/R7 的行为变更，故 eval 首批先覆盖 R1 类（工具一致性）与流程设计主链路。

---

## 五、评审中确认的已有优点（保持不变）

- Skill Registry 的"技能与智能体解耦"设计与 `category:name` 命名；
- `submit_analysis` → 计划步骤自动推导（`derivePlanFromAnalysis`）的机制；
- `allowedSkills` 按智能体裁剪工具面；
- agentLoop 的失败计数 + `_noRetry` 注入停止指令；
- `delegate:query` 的 `validateFilterParamsCoverage` 事后校验模式（可推广为 R2 的核验范式）；
- 流程引擎侧"驳回退回发起人为默认行为、加签为任务操作"的语义（提示词层已同步声明）。

---

## 附录 A：阶段 1 实施记录（2026-09-09）

### A.1 R1 提示词-工具一致性校验 ✅

| 项 | 内容 |
|------|------|
| 新增 | `src/agent/registry/agentSelfCheck.ts`：四条规则（①提示词提到的工具必须可用 ②计划推导 toolName 必须可用 ③`DBA_DELEGATE_SKILL_IDS` 与 allowedSkills 一致 ④引用的技能 ID 必须已注册），并对 `main-agent` 提示词中的 `design_form`/`design_workflow`/`bind_workflow` 作跨智能体引用排除 |
| 重构 | `delegateSkills.ts`：委派提示词抽为导出的 `buildWorkflowDelegateSystemPrompt(mode, opts)`（运行与校验共用同一文本）；DBA 工具列表抽为导出常量 `DBA_DELEGATE_SKILL_IDS` |
| 接线 | `skills/index.ts` 在 `import.meta.env.DEV` 下 `queueMicrotask` 异步执行 `runDevSelfCheck()`（动态 import 防循环依赖，不阻塞启动） |
| 顺带修复的真实漂移 | ① 主智能体提示词推荐 `create_page_scaffold` 但 `code:scaffold` 未进 allowedSkills（校验器上线后立刻抓到）② data-assistant allowedSkills 漏 `query:execute` ③ `WORKFLOW_AGENT_PROMPT` 引用不存在的 `bind_form_workflow`（实为 `bind_workflow`） |

### A.2 R3 危险操作确认门 ✅

| 项 | 内容 |
|------|------|
| 新增 | `src/agent/core/confirmationGuard.ts`：单槽待确认操作（工具名+参数指纹+TTL 10 分钟），`consumeApproval`（approved/blocked/mismatch）、`onUserMessage`（识别确认/取消语义） |
| 接线 | `agentLoop.ts` 执行前检查 `tool.requiresConfirmation`，未确认时不执行、返回 `_pause` 结果并指示模型向用户说明影响；`AgentFactory.run()` 入口把用户消息喂给确认门 |
| 标记 | `page:delete`/`query:delete` 原有标记生效（此前未接线）；补齐 `api:delete` 的 `isDangerous`、`workflow:cancel` 的双标记 |
| 语义 | 确认为一次性（放行一次后重新拦截）；参数变化视为新操作需重新确认；"取消/算了/不要"清空待确认 |

### A.3 R11 首批 eval ✅

| 项 | 内容 |
|------|------|
| 新增 | `src/agent/registry/test/agentEvals.ts`（6 个确定性用例）+ `runSelfCheck.ts`（Node 入口）+ `package.json` 脚本 `agent:check`（`tsx --tsconfig tsconfig.app.json`，devDependency 新增 tsx） |
| 用例 | E1 一致性现状必须干净；E2 **复现 2026-09-08 事故**（allowedSkills 去掉 update_workflow，校验器必须报警）；E3 请假审批计划推导（2 步骤/task_type/依赖）；E4 委派失败检测（工具失败必须 success=false）；E5 确认门（拦截→确认放行一次→参数变化重拦→取消）；E6 委派提示词阶段隔离（design_form 禁止建流程、design_workflow 先读后写、禁止猜字段 key） |
| 当前结果 | `npm run agent:check` 6/6 通过，一致性校验干净 |

### A.4 遗留与说明

- 类型检查/lint：新增文件零错误零告警；存量错误与改动前基线一致（项目在本地 TS 6.0.3 下存在大量历史 `as unknown` 模式错误，未处理）；
- R2（步骤完成 grounding）、R7（结构化委派契约）为阶段 2 下一批实施项；
- eval 目前为确定性断言，LLM 判分类用例（如"条件分支场景必须产生 condition 节点"）待接入真实模型后补充。

---

## 附录 B：阶段 2 实施记录（2026-09-09）

### B.1 R2 步骤完成 grounding 校验 ✅

| 项 | 内容 |
|------|------|
| 新增 | `src/agent/registry/skills/stepVerifier.ts`：`verifyStepCompletion(toolName, appId, description, result)`，依赖可注入（eval 用桩、运行时用真实 API）；API 异常时"跳过"而非"失败"（网络问题不阻塞任务，只拦确定的造假） |
| delegate_workflow 核验 | ① result 中解析"表单ID/流程ID"，调用 API 验证资源真实存在；② 表单必须有非空字段；③ **步骤描述含"条件/分支/≤/>"时，流程定义必须真的有 condition 节点**（对 chat.log 事故的精确拦截）；④ result 无资源 ID → 拦截并指导模型补 ID 或如实标 error |
| 接线 | `planSkills.ts` 的 `update_plan_item`：标记 completed 前先核验，不通过则拒绝、步骤标 error，并返回带指导信息的原因（补充真实 ID 后可重新标记） |
| 措辞修正 | `AgentFactory.onShouldComplete` 强制继续指令：从"禁止结束对话"（激励撒谎）改为"completed 需通过核验、无法完成时如实标 error" |
| validate_plan | 验证通过时输出各步骤 result 摘要，要求主智能体汇报"以此为准，禁止编造或夸大" |

### B.2 R7 结构化委派契约 ✅

| 项 | 内容 |
|------|------|
| 新增 | `delegateSkills.ts` 导出 `DelegateOutcome`（type: form/workflow/binding/query + id + name + fields + boundFormId/boundProcessId）、`extractWorkflowOutcomes`、`extractQueryOutcomes`：按 toolCallId 关联 assistant 的工具入参与 tool 结果 JSON，从消息流聚合产出，**不依赖模型汇报格式** |
| 字段契约 | form outcome 携带 fields（key/label/type/required），来自 design_form 调用入参——后续步骤的条件表达式字段 key 有了程序可读来源 |
| 消费侧 | delegate_workflow 成功返回的 message 追加"产出资源：form 21 字段[leaveDays,...]；workflow 17；binding 21↔17"摘要，`data.outcomes` 供主智能体/计划层程序化消费；失败路径同样携带 outcomes（部分成功可见） |
| delegate_query | create_query/update_query/delete_query 同样提取 outcomes |

### B.3 eval 扩充（8/8 通过）

- **E7 步骤完成核验**：桩注入复现事故现场（流程 17 无 condition 节点 + result 声称已配置条件分支）→ 必须拦截且原因指明 condition；真实条件分支放行；无资源 ID 拦截；表单有字段放行；
- **E8 结构化契约**：design_form + design_workflow + bind_workflow 的消息流 → 提取 form(id=21, fields 含 leaveDays) + workflow(id=17) + binding(21↔17)。

### B.4 验证

- `npm run agent:check`：**8/8 通过**，一致性校验干净；
- 类型检查/lint：新增文件零错误；存量错误与基线持平（planSkills 105 个错误与 HEAD 完全一致，仅行号偏移）。

### B.5 遗留与说明

- `update_plan_item` 的核验目前覆盖 `delegate_workflow` / `delegate_query`；`create_code_page`/`update_code_page` 的核验（页面存在、代码非空）待接入页面 API 后补充；
- 主智能体提示词尚未显式说明如何消费 `data.outcomes`（当前靠 message 中的资源摘要），可在下一轮提示词优化中补一句消费指引；
- 阶段 3（R4 上下文管理 + R5 记忆收敛）为下一批实施项。

---

## 附录 C：阶段 3 实施记录（2026-09-09）

### C.1 R4 上下文窗口管理 ✅

| 项 | 内容 |
|------|------|
| 新增 | `src/agent/core/contextWindow.ts`：`compactForApi(messages, budgetChars=120_000, keepRecent=24)` + `estimateChars`。核心不变量：tool 消息必须紧跟其配对的 assistant(tool_calls) 消息；system 与最近 24 条完整保留 |
| 分层策略 | 预算内原样返回（短会话零行为变化）→ 超预算先裁剪保护窗口外的旧工具结果为占位标记（保留 assistant 结论）→ 仍超则按"单元"（assistant+相邻 tool）从最旧整组丢弃，杜绝孤儿 tool 消息导致 API 报错 |
| 接线 | `agentLoop.buildAPIMessages` 产出后经 `compactForApi` 再发送；`conversationMessages` 本身保留全量，UI 展示与计划上下文不受影响 |
| 常量 | `CONTEXT_BUDGET_CHARS=120_000`（中文约 1.5 字符/token 的保守估算，128k 上下文安全）、`CONTEXT_KEEP_RECENT=24` |

### C.2 R5 记忆收敛（务实子集）✅

| 项 | 内容 |
|------|------|
| 统一入口 | `agentMemory.ts` 新增 `loadDelegationMemory` / `saveDelegationMemory`，`delegate:query` 与 `delegate:workflow` 全部改用（原来两处各写一遍 filter/boilerplate） |
| 生命周期 | 委派记忆随应用会话存活；保存时最多保留最近 200 条、超 8000 字符的 tool 内容截断加标记——消除无限膨胀 |
| 完整收敛说明 | `memoryManager`（IndexedDB 会话持久化）与 `agentStore`（localStorage）的合并涉及 UI 层改造，风险较大，保留为独立后续项（见 C.4） |

### C.3 eval 扩充（10/10 通过）

- **E9 上下文压缩**：预算内直通（同引用）；超预算验证 system 保留、旧工具结果裁剪标记、保护窗口原样、整组丢弃后 tool 配对不变量；
- **E10 记忆上限**：250 条存入 → 读取恰 200 条；保留窗口内的 20000 字符 tool 内容被截断并带标记。

### C.4 验证与遗留

- `npm run agent:check`：**10/10 通过**；类型检查/lint 新增零错误（存量与基线持平）；
- 遗留：① `memoryManager`/`agentStore` 合并为独立改造项；② `compactForApi` 的字符预算为保守估算，未接 tokenizer，后续可在请求失败含 context_length 错误时动态降预算重试；③ 阶段 4（R6/R8/R9/R10）待实施。

---

## 附录 D：chat.log 二次回归修复（2026-09-09，页面生成场景）

用户实测"创建客户管理页面"（chat.log 2026-09-09 08:15-08:20）。主流程验证通过：阶段 1-3 的护栏全部生效（委派记忆复用数据源/表结构、步骤结果带真实 ID、页面校验门控阻止带病标记完成、validate_plan 输出事实摘要）。复盘发现并修复以下问题。

### D.1 表单容器校验器误报（真 bug，已修复）

- **根因**：`codeValidate.ts` 的 `/<div[^>]*class="[^"]*luban-form\b[^"]*"[^>]*>/` 中 `\b` 拦不住连字符——`luban-form-item`、`luban-form-label-row` 等表单内部正常子元素全部命中，导致模型写的正确 `<form class="luban-form">` 被误报为 div 容器问题
- **损害**：模型两轮修复屈服于误报，把合法的 `form.name.value`（真实 `<form>` 元素上有效）重写为 `LubanUI.getFormData`，并在 openEdit 留下死变量
- **修复**：改为双侧断言 `(?<![-\w])luban-form(?![-\w])`，7 个正反用例手工验证
- **回归**：E11（事故现场正向 + div 真违规反向对照；注意 `[表单容器]` 走 `fixable` 通道而非 `errors`）

### D.2 计划查询步骤按页合并（效率，已修复）

- **问题**：`derivePlanFromAnalysis` 每个查询生成一次独立 delegate_query，4 次委派串行近 2 分钟
- **修复**：同一页面的全部查询合并为一次委派（toolInput.requirement 指示 DBA 单轮连续创建、仅一次重名探查），页面步骤只依赖自己页面的查询批次；filter_params 取声明了筛选的主查询，`validateFilterParamsCoverage` 语义不变
- **回归**：E12（4 查询 → 1 步骤 + 页面依赖断言）

### D.3 日志导出时序显示（体验，已修复）

- **问题**：plan 等聚合消息按创建顺序排列，但 header 显示最后更新时间（timestamp 被 upsert 刷新），导出读起来时序错乱
- **修复**：Message 新增 `createdAt`（store 入队时记录），导出 header 显示创建时间，更新跨度 >60s 的聚合消息附注最后更新时间

### D.4 列表+统计混查的规模提示（提示词，已补充）

- dbaPrompt 新增"列表+聚合统计一条查询"小节：肯定窗口函数方案（统计随筛选变化），但注明每行重复携带统计 JSON 的代价，大结果集/后端分页时应拆分独立统计查询

### D.5 验证

- `npm run agent:check`：**12/12 通过**；类型检查（8 处 acorn/AgentPanel 存量错误与基线一致）、ESLint（50 vs 50 持平）零新增
- 顺带发现（未修）：`validateHtml` 依赖 DOMParser，在 Node/eval 环境抛异常（浏览器内运行正常）；如需 CI 全量校验页面代码，需引入 jsdom 或 DOMParser polyfill
