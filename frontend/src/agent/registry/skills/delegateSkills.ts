import { SkillCategory, type SkillFactory, resolveSkills } from '../skillRegistry';
import { buildDataAssistantPrompt } from '../../prompts/dbaPrompt';
import { loadDelegationMemory, saveDelegationMemory } from '../agentMemory';
import { formApi } from '@/api/workflow';
import { listQueries } from '@/api';
import { getCallerIdentity } from '../../prompts/callerContext';
import { toolArgsKey } from '../../kernel/runtime';
import { approvePendingApproval } from '../../core/confirmationGuard';
import type { DelegateQueryArgs, DelegateQueryResult, Message } from '@/types/agent';

const activeDelegations = new Set<string>();

/** 流程引擎对驳回/加签的内置语义：这些能力由引擎和审批界面提供，节点 config 不支持相关配置项 */
const WORKFLOW_ENGINE_SEMANTICS = `## 驳回与加签（引擎内置能力，禁止配置到节点）
- **驳回退回发起人**：流程引擎默认行为，审批人执行"驳回"后流程自动退回发起人重新提交，无需在节点 config 中配置任何参数
- **加签**：审批人处理任务时的运行时操作（前加签/后加签），由审批界面提供，与流程设计无关，无需配置
- ⚠️ 节点 data.config 只允许包含本文档列出的字段（nodeName、approverType 及其对应的审批人参数），**禁止编造 allowReject、allowAddSign、rejectTo 等引擎不支持的配置项**——写了也不会生效`;

/** task_type=design_form：仅设计表单 */
const DESIGN_FORM_WORKFLOW = `## 工作流程（仅设计表单）
本任务只需要设计表单，**禁止创建流程（design_workflow）和绑定（bind_workflow）**：
1. 如需查看已有表单的字段定义，用 design_form 传入 formId 且不传 fields（只读，不会创建新表单）
2. 用 design_form 创建表单（name 必填，fields 为字段列表）。⚠️ 如果上面已列出可复用的表单且能满足需求，不要重复创建
3. 汇报时必须列出表单 ID 和每个字段的 key（后续流程条件判断依赖这些 key）`;

/** task_type=design_workflow：仅设计/修改流程 */
const DESIGN_WORKFLOW_ONLY_PROMPT = `## 工作流程（仅设计/修改流程，不创建表单）
1. **修改已有流程**（需求给出流程 ID 时）：先用 get_definition(processId) 读取现有节点和连线，再基于现有结构调用 update_workflow(processId, nodes, edges) 传入修改后的**完整**节点和连线。update_workflow 失败时才用 design_workflow 创建新流程，并说明新旧流程 ID 的对应关系
2. **新建流程**：用 design_workflow 创建（name 必填，applicationId 必填，nodes/edges 必填）
3. 上下文或对话记录中已有本次相关表单（含表单 ID）时，用 bind_workflow(processId, formId) 绑定；看不到字段 key 时，用 design_form 传入 formId 且不传 fields 查看
4. ⚠️ 条件分支连线的 condition 表达式必须使用表单的**真实字段 key**（通过 design_form(formId) 查询或上下文获得），禁止猜测字段名
5. 先用 search_members 或 search_roles 查询可用的审批人/角色，再设置审批人
6. 汇报时列出流程 ID、节点结构、每条条件分支的表达式及其引用的字段 key
7. 如果用户明确说不需要表单或页面通过自己的弹窗发起流程，汇报时附上发起代码示例：
   \`\`\`js
   window.__LUBAN__.startWorkflow(流程ID, { 字段1: '值1', 字段2: '值2' })
     .then(function(instance) { alert('流程已发起，实例ID：' + instance.id); })
     .catch(function(err) { alert('发起失败：' + err.message); });
   \`\`\``;

/** 未指定 task_type：表单 + 流程完整执行 */
const FULL_WORKFLOW_PROMPT = `## 工作流程

### 完整流程（用户描述了表单字段时）
1. 先用 search_members 或 search_roles 查询可用的审批人/角色
2. 用 design_form 创建表单（name 必填，fields 为字段列表）。⚠️ 如果上面已列出可复用的表单，跳过此步，直接用已有表单 ID
3. 用 design_workflow 创建流程（name 必填，applicationId 填上方「当前应用 ID」的值，nodes 和 edges 必填）
4. 用 bind_workflow 将表单绑定到流程（formId 为已有表单 ID 或步骤2返回的表单 ID，processId 为步骤3返回的流程 ID）

### 仅设计流程（用户明确说不需要表单，或页面通过自己的弹窗发起流程时）
1. 先用 search_members 或 search_roles 查询可用的审批人/角色
2. 如果已有可复用表单，用 bind_workflow 绑定到流程（可选）
3. 用 design_workflow 创建流程
4. 汇报结果时，必须包含以下信息：
   - 流程名称和 ID
   - 页面弹窗发起流程的 JS 代码示例：
   \`\`\`js
   window.__LUBAN__.startWorkflow(流程ID, { 字段1: '值1', 字段2: '值2' })
     .then(function(instance) { alert('流程已发起，实例ID：' + instance.id); })
     .catch(function(err) { alert('发起失败：' + err.message); });
   \`\`\`
   - 说明：startWorkflow 的 formData 参数应与页面弹窗表单的字段对应

### 修改已有流程（用户给出流程 ID 时）
1. 先用 get_definition(processId) 读取现有节点和连线
2. 用 update_workflow(processId, nodes, edges) 传入修改后的完整节点和连线，不要创建新流程
3. update_workflow 失败时才用 design_workflow 创建新流程，并说明新旧流程 ID 的对应关系
4. ⚠️ 条件表达式的字段 key 必须用 design_form 传入 formId 且不传 fields 查询真实字段，禁止猜测`;

/** 委派产出资源的结构化描述（需求 R7） */
export interface DelegateOutcome {
  type: 'form' | 'workflow' | 'binding' | 'query';
  id: number;
  name?: string;
  /** type=form 时携带字段 key 列表，供后续步骤的条件表达式引用 */
  fields?: Array<{ key: string; label?: string; type?: string; required?: boolean }>;
  /** type=binding 时为绑定的另一方 ID */
  boundFormId?: number;
  boundProcessId?: number;
}

interface ToolMessageLike {
  role?: string;
  content?: string;
  toolCalls?: Array<{ name?: string; arguments?: Record<string, unknown> }>;
}

/**
 * 委派记忆跨轮累积，分析子智能体行为（暂停/失败/DDL 干预）时只看本次任务的消息：
 * 即最后一条 user 消息（本次委派的任务描述）之后的部分。
 * 否则上一轮已解决/已确认的暂停与失败会在后续委派中反复误报。
 */
function messagesSinceLastUserTask(messages: Message[]): Message[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages.slice(i + 1);
  }
  return messages;
}

/**
 * 检测子智能体是否带着未确认的危险操作返回：agentLoop 的确认门暂停会写入带
 * _pause 的 tool 结果消息。返回暂停原因（供主智能体转述用户），无暂停返回 null。
 */
function detectSubAgentPause(messages: Message[]): string | null {
  for (const m of messagesSinceLastUserTask(messages)) {
    if (m.role !== 'tool' || !m.content) continue;
    try {
      const parsed = JSON.parse(m.content) as { _pause?: boolean; message?: string };
      if (parsed._pause === true && parsed.message) return parsed.message;
    } catch {
      // 非 JSON 的 tool 消息跳过
    }
  }
  return null;
}

/**
 * 从子智能体消息中聚合结构化产出（R7）：解析 tool 消息的 JSON 结果，
 * 按 toolCallId 关联 assistant 消息里的工具名与入参，不依赖模型汇报格式。
 */
export function extractWorkflowOutcomes(messages: Array<ToolMessageLike | unknown>): DelegateOutcome[] {
  const outcomes: DelegateOutcome[] = [];
  const argsByCallId = new Map<string, { name: string; args: Record<string, unknown> }>();

  for (const m of messages as Array<Record<string, unknown>>) {
    if (m.role !== 'assistant' || !Array.isArray(m.toolCalls)) continue;
    for (const tc of m.toolCalls as Array<Record<string, unknown>>) {
      if (typeof tc.id === 'string' && typeof tc.name === 'string') {
        argsByCallId.set(tc.id, { name: tc.name, args: (tc.arguments as Record<string, unknown>) || {} });
      }
    }
  }

  const parseFields = (v: unknown): DelegateOutcome['fields'] => {
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch { return undefined; }
    }
    if (!Array.isArray(v)) return undefined;
    return v
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
      .map((f) => ({ key: String(f.key || ''), label: f.label ? String(f.label) : undefined, type: f.type ? String(f.type) : undefined, required: !!f.required }))
      .filter((f) => f.key);
  };

  for (const m of messages as Array<Record<string, unknown>>) {
    if (m.role !== 'tool' || typeof m.content !== 'string' || !m.toolCallId) continue;
    let parsed: { success?: boolean; message?: string; data?: unknown };
    try { parsed = JSON.parse(String(m.content)) as typeof parsed; } catch { continue; }
    if (parsed.success !== true) continue;

    const call = argsByCallId.get(String(m.toolCallId));
    if (!call) continue;
    const data = (parsed.data ?? {}) as Record<string, unknown>;

    if (call.name === 'design_form') {
      const id = Number(data.id);
      if (Number.isFinite(id) && id > 0) {
        outcomes.push({ type: 'form', id, name: (data.name as string) || (call.args.name as string), fields: parseFields(call.args.fields) });
      }
    } else if (call.name === 'design_workflow' || call.name === 'update_workflow' || call.name === 'copy_workflow') {
      const id = Number(data.id);
      if (Number.isFinite(id) && id > 0) {
        outcomes.push({ type: 'workflow', id, name: (data.name as string) || (call.args.name as string) });
      }
    } else if (call.name === 'bind_workflow') {
      const formId = Number(call.args.formId);
      const processId = Number(call.args.processId);
      if (Number.isFinite(formId) && Number.isFinite(processId)) {
        outcomes.push({ type: 'binding', id: processId, boundFormId: formId, boundProcessId: processId });
      }
    }
  }

  // 同一资源多次出现时保留最后一次（update_workflow 场景），表单字段做合并
  const merged: DelegateOutcome[] = [];
  for (const o of outcomes) {
    const idx = merged.findIndex((x) => x.type === o.type && x.id === o.id);
    if (idx >= 0) {
      if (o.fields?.length) merged[idx].fields = o.fields;
      if (o.name) merged[idx].name = o.name;
    } else {
      merged.push(o);
    }
  }
  return merged;
}

/** delegate_query 的结构化产出：从 tool 消息中提取 create_query / update_query / delete_query 的结果（R7） */
export function extractQueryOutcomes(messages: Array<ToolMessageLike | unknown>): DelegateOutcome[] {
  const outcomes: DelegateOutcome[] = [];
  const argsByCallId = new Map<string, { name: string; args: Record<string, unknown> }>();

  for (const m of messages as Array<Record<string, unknown>>) {
    if (m.role !== 'assistant' || !Array.isArray(m.toolCalls)) continue;
    for (const tc of m.toolCalls as Array<Record<string, unknown>>) {
      if (typeof tc.id === 'string' && typeof tc.name === 'string') {
        argsByCallId.set(tc.id, { name: tc.name, args: (tc.arguments as Record<string, unknown>) || {} });
      }
    }
  }

  for (const m of messages as Array<Record<string, unknown>>) {
    if (m.role !== 'tool' || typeof m.content !== 'string' || !m.toolCallId) continue;
    let parsed: { success?: boolean; message?: string; data?: unknown };
    try { parsed = JSON.parse(String(m.content)) as typeof parsed; } catch { continue; }
    if (parsed.success !== true) continue;
    const call = argsByCallId.get(String(m.toolCallId));
    if (!call) continue;
    const data = (parsed.data ?? {}) as Record<string, unknown>;

    if (call.name === 'create_query' || call.name === 'update_query') {
      const id = Number(data.id);
      if (Number.isFinite(id) && id > 0) {
        outcomes.push({ type: 'query', id, name: (data.name as string) || (call.args.name as string) });
      }
    } else if (call.name === 'delete_query') {
      const id = Number(call.args.queryId);
      if (Number.isFinite(id) && id > 0) {
        outcomes.push({ type: 'query', id: -id, name: `deleted:${id}` });
      }
    }
  }
  return outcomes;
}

/** 委派给 data-assistant 的技能 ID 列表（须与 agentRegistry 中 data-assistant.allowedSkills 保持一致，agentSelfCheck 会校验两者漂移） */
export const DBA_DELEGATE_SKILL_IDS = [
  'datasource:list', 'datasource:test', 'datasource:structure', 'datasource:connect',
  'query:list', 'query:create', 'query:update', 'query:delete', 'query:run', 'query:get', 'query:execute', 'query:references',
  'api:list', 'api:connect', 'api:test', 'api:delete',
];

export type WorkflowDelegateMode = 'design_form' | 'design_workflow' | 'full';

/**
 * 构建委派给 workflow-assistant 的系统提示词。
 * execute 与 agentSelfCheck 共用此 builder，保证校验的文本与实际运行完全一致。
 */
export function buildWorkflowDelegateSystemPrompt(
  mode: WorkflowDelegateMode,
  opts: {
    applicationId: number;
    existingFormsInfo?: string;
    context?: string;
    /** 当前用户身份，供流程助手识别"我/当前用户" */
    currentUser?: {
      memberId: number;
      name: string;
      account?: string | null;
      email?: string | null;
      deptName?: string | null;
    };
  },
): string {
  const modePrompt = mode === 'design_form'
    ? DESIGN_FORM_WORKFLOW
    : mode === 'design_workflow'
      ? DESIGN_WORKFLOW_ONLY_PROMPT
      : FULL_WORKFLOW_PROMPT;

  const userIdentity = opts.currentUser
    ? `
## 当前用户身份
你正在为以下用户设计流程，当用户描述中出现"我""当前用户""本人"等指代时，均指这个用户：
- 用户 ID：${opts.currentUser.memberId}
- 姓名：${opts.currentUser.name}
${opts.currentUser.account ? `- 账号：${opts.currentUser.account}` : ''}
${opts.currentUser.email ? `- 邮箱：${opts.currentUser.email}` : ''}
${opts.currentUser.deptName ? `- 部门：${opts.currentUser.deptName}` : ''}

⚠️ 当需要把审批人设为"当前用户"时，直接用 memberId=${opts.currentUser.memberId} 设置审批人，**不需要调用 search_members**。`
    : '';

  return `你是流程设计专家，负责设计和管理业务流程。你必须调用工具来实际创建表单和流程，禁止只输出文本方案而不调用工具。

当前应用 ID: ${opts.applicationId}
${userIdentity}
${opts.existingFormsInfo || ''}
${opts.context ? `上下文信息：${opts.context}` : ''}
${WORKFLOW_ENGINE_SEMANTICS}

${modePrompt}

## 表单字段类型（design_form 的 fields 中 type 必须使用以下值）
text（单行文本）、number（数字）、date（日期）、datetime（日期时间）、textarea（多行文本）、select（下拉选择）、multi_select（多选下拉）、radio（单选）、checkbox（复选框）、switch（开关）、file（文件上传）、excel（Excel导入）、member（人员选择）、department（部门选择）、detail_table（明细表/子表格）、computed（计算字段）

每个字段格式：{ "key": "字段标识", "label": "字段显示名", "type": "字段类型", "required": true/false }
select/radio 类型需额外提供 options: [{ "label": "选项名", "value": "选项值" }]
detail_table 类型需额外提供 columns 数组，每个子字段同上格式

## 流程节点类型（nodeType 用于后端校验，type 用于前端渲染，两者不同，**都必须传入**）
- start: nodeType: "start", type: "startNode"
- approval: nodeType: "approval", type: "approvalNode"，需设置 approverType（member/role/leader/department_head/form_field/script）
- condition: nodeType: "condition", type: "conditionNode"
- end: nodeType: "end", type: "endNode"

## 审批人类型
- member: 指定人员，需 memberIds 数组（数字ID，来自 search_members 结果）
- role: 指定角色，需 roleIds 数组（数字ID，来自 search_roles 结果）
- leader: 发起人的直属上级，需 leaderOf: "initiator"
- department_head: 发起人所在部门负责人，需 departmentSource: "initiator"
- form_field: 从表单字段获取审批人，需 formFieldKey: "字段key"
- script: 动态脚本，需 script: "代码"

## 每个节点必须包含 nodeId、id、type、nodeType、position: { x, y }、data
- start: nodeId: "start", id: "start", type: "startNode", nodeType: "start", position: { x: 300, y: 50 }
- 各审批节点 y 依次递增 120（如 170, 290, 410），nodeId 和 id 设为 "approval_1"、"approval_2" 等，type: "approvalNode", nodeType: "approval"
- condition: type: "conditionNode", nodeType: "condition"
- end: nodeId: "end", id: "end", type: "endNode", nodeType: "end", position: { x: 300, y: 最后一个节点 y + 120 }

## 每个节点必须包含 data
- start: data: { label: "发起人提交申请", nodeType: "start", config: { nodeName: "发起人提交申请" } }
- approval: data: { label: "直属上级审批", nodeType: "approval", config: { nodeName: "直属上级审批", approverType: "leader", leaderOf: "initiator" } }
- condition: data: { label: "判断预算", nodeType: "condition", config: { nodeName: "预算判断" } }
- end: data: { label: "结束", nodeType: "end", config: { nodeName: "结束" } }

## 连线（edges）
每条连线格式：{ id: "边ID", source: "源节点ID", target: "目标节点ID", type: "smoothstep", markerEnd: { type: "arrowclosed" } }
**条件分支连线必须包含 data 字段**：{ ..., data: { condition: "amount < 5000", label: "小于5000" } }

## 重要规则
- ⚠️ **禁止自行推断流程结构**：必须严格按照用户需求中描述的流程节点和路由逻辑来设计，不要用"常见的请假流程"之类的模板自行替换。用户说"≤3天→直属上级审批，>3天→直属上级→部门经理"，就必须设计条件分支，而不是串行审批。用户需求中没有描述流程结构时，不要自行创建流程，如实汇报缺少的信息
- 禁止只输出设计方案而不调用工具，必须实际创建
- 每个流程必须包含 start 和 end 节点
- 审批节点必须设置审批人
- 已有可复用表单时不要重复创建，直接使用已有表单 ID
- ⚠️ **如实汇报**：完成后汇报实际结果（表单 ID/流程 ID/节点结构）；任何工具调用失败时，必须如实说明失败原因和已尝试的方案，禁止谎报完成`;
}

const DDL_PATTERN = /^\s*(CREATE|ALTER|DROP|TRUNCATE|RENAME)\b/i;
const FALLBACK_SQL_PATTERN = /(CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\s/i;

export interface DDLValidationResult {
  /** 警告列表（供上层展示） */
  warnings: string[];
  /** 是否需要用户手动干预（DDL 被拦截且已提供降级 SQL） */
  interventionRequired: boolean;
  /** 干预原因（供主智能体判断是否停止） */
  interventionReason?: string;
}

/**
 * DDL 执行校验（代码层兜底）：
 * 扫描子智能体消息，检查 DDL 操作是否遵循"先尝试执行 → 失败降级生成 SQL"流程。
 *
 * 校验规则：
 * 1. execute_sql 被调用且 sql 为 DDL 语句 → 检查执行结果
 * 2. DDL 被后端拦截（success=false）→ 检查 assistant 最终回复是否包含降级 SQL
 * 3. 未提供降级 SQL → 生成警告
 * 4. DDL 被拦截且提供了降级 SQL → interventionRequired=true，主智能体应停止等待用户
 */
export function validateDDLExecution(messages: Array<ToolMessageLike | unknown>): DDLValidationResult {
  const warnings: string[] = [];
  const argsByCallId = new Map<string, { name: string; args: Record<string, unknown> }>();

  for (const m of messages as Array<Record<string, unknown>>) {
    if (m.role !== 'assistant' || !Array.isArray(m.toolCalls)) continue;
    for (const tc of m.toolCalls as Array<Record<string, unknown>>) {
      if (typeof tc.id === 'string' && typeof tc.name === 'string') {
        argsByCallId.set(tc.id, { name: tc.name, args: (tc.arguments as Record<string, unknown>) || {} });
      }
    }
  }

  const blockedDDL: Array<{ sql: string; error: string }> = [];

  for (const m of messages as Array<Record<string, unknown>>) {
    if (m.role !== 'tool' || typeof m.content !== 'string' || !m.toolCallId) continue;
    const call = argsByCallId.get(String(m.toolCallId));
    if (!call || call.name !== 'execute_sql') continue;

    const sql = String(call.args.sql || '');
    if (!DDL_PATTERN.test(sql)) continue;

    let parsed: { success?: boolean; message?: string };
    try { parsed = JSON.parse(String(m.content)) as typeof parsed; } catch { continue; }

    if (!parsed.success) {
      blockedDDL.push({ sql, error: parsed.message || '未知错误' });
    }
  }

  if (blockedDDL.length === 0) {
    return { warnings: [], interventionRequired: false };
  }

  const assistantContents = (messages as Array<Record<string, unknown>>)
    .filter((m) => m.role === 'assistant' && typeof m.content === 'string')
    .map((m) => String(m.content));

  const lastAssistantMsg = assistantContents[assistantContents.length - 1] || '';

  const hasFallback = FALLBACK_SQL_PATTERN.test(lastAssistantMsg);

  if (!hasFallback) {
    const ddlSummary = blockedDDL.map((d) =>
      `  • ${d.sql.slice(0, 80)}${d.sql.length > 80 ? '...' : ''} → ${d.error.slice(0, 60)}`
    ).join('\n');
    warnings.push(
      `DDL 操作被后端拦截，但未提供降级 SQL：\n${ddlSummary}\n` +
      `→ 请在回复中输出完整 SQL，告知用户前往数据源管理面板手动执行。`
    );
    return { warnings, interventionRequired: false };
  }

  console.log(`[validateDDLExecution] DDL 降级校验通过：${blockedDDL.length} 条 DDL 被拦截，已提供降级 SQL`);

  return {
    warnings,
    interventionRequired: true,
    interventionReason: `DDL 操作被后端拦截（${blockedDDL.map(d => d.sql.slice(0, 40)).join('、')}），已降级生成手动 SQL。请等待用户在数据源管理面板完成操作后再继续。`,
  };
}

async function validateFilterParamsCoverage(
  filterParams: string | undefined,
  queryName: string | undefined,
  applicationId: number
): Promise<string[]> {
  const warnings: string[] = [];
  if (!filterParams || !queryName) return warnings;

  const declaredParams = filterParams
    .split(',')
    .map(p => p.trim().split('(')[0].trim())
    .filter(p => p.length > 0);

  if (declaredParams.length === 0) return warnings;

  try {
    const res = await listQueries(applicationId);
    const query = res.data.find((q: { name: string }) => q.name === queryName);
    if (!query) {
      warnings.push(`未找到查询 ${queryName}，无法校验筛选参数覆盖`);
      return warnings;
    }

    const sql: string = query.body || query.sqlBody || '';
    if (!sql) {
      warnings.push(`查询 ${queryName} 无 SQL 内容，无法校验筛选参数覆盖`);
      return warnings;
    }

    for (const param of declaredParams) {
      const paramPattern = `this.params.${param}`;
      if (!sql.includes(paramPattern)) {
        warnings.push(`筛选参数 "${param}" 未在 SQL 中出现（缺少 this.params.${param}），DBA 可能遗漏了此筛选条件`);
      }
    }
  } catch (e) {
    console.warn(`[validateFilterParamsCoverage] 校验失败:`, e);
  }

  return warnings;
}

export const delegateSkills: Record<string, SkillFactory> = {
  'delegate:query': (ctx, chatRouter) => {
    if (!chatRouter) {
      return {
        id: 'delegate:query',
        category: SkillCategory.DELEGATE,
        name: 'delegate_query',
        description: '向数据辅助智能体委派查询任务（不可用：缺少 ChatRouter）',
        parameters: { type: 'object', properties: {} },
        async execute() { return { success: false, message: 'ChatRouter 不可用' }; },
      };
    }

    return {
      id: 'delegate:query',
      category: SkillCategory.DELEGATE,
      name: 'delegate_query',
      description: `向数据辅助智能体委派数据相关任务，包括：
- 查询/列出数据源、查询、API、表结构
- 创建/修改/删除查询
- 连接/测试/删除数据源和外部 API
只需用自然语言描述需求，DBA 会自行判断该做什么。`,
      parameters: {
        type: 'object',
        properties: {
          requirement: { type: 'string', description: '自然语言描述的需求，如"列出所有数据源"、"为订单页创建查询，需要 id、订单号、金额、状态字段"、"删除查询 xxx"' },
          target_page: { type: 'string', description: '目标页面名称（可选）' },
          query_name: { type: 'string', description: '查询名称（可选，创建/修改时建议提供）' },
          filter_params: { type: 'string', description: '声明的筛选参数（可选），格式：paramName(类型,匹配方式)，逗号分隔。DBA 完成后会校验 SQL 是否覆盖所有参数' },
        },
        required: ['requirement'],
      },
      async execute(args, execCtx) {
        const typedArgs = args as unknown as DelegateQueryArgs;
        // 内核确认重执行：为子会话即将重试的危险操作放行（批准接力）
        if ((execCtx as { kernelCall?: { resume?: boolean } } | undefined)?.kernelCall?.resume) {
          approvePendingApproval();
        }
        const execStart = Date.now();
        const guardKey = `query:${typedArgs.query_name || 'general'}`;
        if (activeDelegations.has(guardKey)) {
          console.warn(`[delegate_query] 相同任务正在执行中，拒绝重复调用 | key=${guardKey}`);
          return { success: false, message: '相同的数据操作任务正在执行中，请等待其完成后再试', _noRetry: true };
        }
        activeDelegations.add(guardKey);

        console.log(`[delegate_query] 开始 | requirement=${typedArgs.requirement?.slice(0, 60)}`);

        ctx.dispatch?.({
          type: 'DELEGATE_QUERY_START',
          payload: { requirement: typedArgs.requirement, targetPage: typedArgs.target_page, queryName: typedArgs.query_name },
        });

        try {
          const dbaPrompt = buildDataAssistantPrompt({
            applicationId: ctx.applicationId,
            targetPage: typedArgs.target_page,
            queryName: typedArgs.query_name,
            requirement: typedArgs.requirement,
          });

          const dbaTools = resolveSkills(DBA_DELEGATE_SKILL_IDS, ctx, chatRouter);

          const userMessage = typedArgs.requirement;

          console.log(`[delegate_query] 委派 data-assistant | 消息长度: ${userMessage.length}`);
          const routeStart = Date.now();
          const memoryFiltered = loadDelegationMemory(ctx.applicationId, 'data-assistant');
          console.log(`[delegate_query] loadDelegationMemory 返回 ${memoryFiltered.length} 条 | appId=${ctx.applicationId}`);
          const executor = await chatRouter!.routeTo('data-assistant', userMessage, `dba-${Date.now()}`, {
            systemPrompt: dbaPrompt,
            tools: dbaTools,
            isDelegated: true,
            initialMessages: memoryFiltered,
            agentContext: {
              requirement: typedArgs.requirement,
              targetPage: typedArgs.target_page,
              queryName: typedArgs.query_name,
            },
          });
          const messagesAfter = executor.getMessages();
          console.log(`[delegate_query] executor.getMessages 返回 ${messagesAfter.length} 条消息 | roles: [${messagesAfter.map((m) => (m as Message).role).join(', ')}]`);
          saveDelegationMemory(ctx.applicationId, 'data-assistant', messagesAfter);
          console.log(`[delegate_query] data-assistant 完成 | ${Date.now() - routeStart}ms`);

          const messages = executor.getMessages();

          // 确认门暂停传播：DBA 带着未确认的危险操作返回时，必须向主智能体返回 _pause，
          // 让主循环硬暂停。否则委派被当作"已完成"，主智能体会继续执行后续步骤。
          const pauseReason = detectSubAgentPause(messages);
          if (pauseReason) {
            console.warn(`[delegate_query] 子智能体等待用户确认，主智能体暂停 | ${pauseReason.slice(0, 80)}`);
            // 把子会话的 danger-confirm 上浮为父层挂起请求：内核确认后精确重执行本委派调用，
            // 本工具经 kernelCall.resume 感知批准并为子会话放行
            const kernelCallId = (execCtx as { kernelCall?: { callId?: string } } | undefined)?.kernelCall?.callId || '';
            return {
              success: false,
              _pause: true,
              message: `数据辅助智能体有一个危险操作等待用户确认，本次任务未完成。请向用户转述下面的确认请求，等用户回复"确认"后重新委派本任务；用户回复"取消"则放弃该操作：\n${pauseReason}`,
              data: kernelCallId ? {
                suspendRequest: {
                  kind: 'danger-confirm',
                  callId: kernelCallId,
                  toolName: 'delegate_query',
                  args: typedArgs as unknown as Record<string, unknown>,
                  argsKey: toolArgsKey(typedArgs as unknown as Record<string, unknown>),
                  message: `子智能体危险操作待确认：${pauseReason}`,
                },
              } : undefined,
            };
          }

          const dbaResponse = messages
            .filter((m) => (m as Message).role === 'assistant')
            .map((m) => (m as Message).content)
            .join('\n\n')
            .trim();

          const result: DelegateQueryResult = {
            success: true,
            message: `数据辅助智能体完成任务`,
            details: dbaResponse || '任务完成',
            data: { messages },
          };

          // 校验筛选参数覆盖：检查 DBA 生成的 SQL 是否包含所有声明的筛选参数
          const filterWarnings = await validateFilterParamsCoverage(
            typedArgs.filter_params,
            typedArgs.query_name,
            ctx.applicationId
          );
          if (filterWarnings.length > 0) {
            const warningMsg = filterWarnings.join('\n');
            console.warn(`[delegate_query] 筛选参数校验警告:\n${warningMsg}`);
            result.details += `\n\n⚠️ 筛选参数校验:\n${warningMsg}`;
          }

          // 校验 DDL 降级流程：代码层兜底，确保 DDL 被拦截后提供了降级 SQL。
          // 只看本次任务的消息，避免上一轮已解决的 DDL 干预在后续委派中误报
          const ddlCheck = validateDDLExecution(messagesSinceLastUserTask(messages));
          if (ddlCheck.warnings.length > 0) {
            const ddlWarningMsg = ddlCheck.warnings.join('\n');
            console.warn(`[delegate_query] DDL 降级校验警告:\n${ddlWarningMsg}`);
            result.details += `\n\n⚠️ DDL 降级校验:\n${ddlWarningMsg}`;
          }
          // 结构化干预标记：DDL 被拦截且已降级 → 返回 _pause 让主循环硬暂停，
          // 等待用户在数据源管理面板完成手动操作。此前只把标记放进 data，
          // 停止全靠 prompt 劝说 LLM，模型不听话时主智能体会继续跑
          if (ddlCheck.interventionRequired) {
            result.interventionRequired = true;
            result.interventionReason = ddlCheck.interventionReason;
            result.message = '需要用户手动操作（建表/改表），请等待用户完成后再继续';
            console.warn(`[delegate_query] DDL 干预，主智能体暂停 | ${(ddlCheck.interventionReason || '').slice(0, 80)}`);
            return {
              success: false,
              _pause: true,
              message: `需要用户手动操作后本次任务才算完成：${ddlCheck.interventionReason || ''}。请将需要手动执行的 SQL 转达给用户，等用户在数据源管理面板执行完成并回复后，再继续后续步骤。`,
              data: { ...result, outcomes: extractQueryOutcomes(messages) },
            };
          }

          ctx.dispatch?.({
            type: 'DELEGATE_QUERY_END',
            payload: { requirement: typedArgs.requirement, success: true, details: dbaResponse },
          });

          console.log(`[delegate_query] 完成 | 总耗时: ${Date.now() - execStart}ms`);
          return { success: true, message: result.message, data: { ...result, outcomes: extractQueryOutcomes(messages) } };
        } catch (e: unknown) {
          console.error(`[delegate_query] 失败:`, e);
          ctx.dispatch?.({
            type: 'DELEGATE_QUERY_END',
            payload: { requirement: typedArgs.requirement, success: false, error: (e as Error).message },
          });
          return { success: false, message: `数据辅助智能体执行失败: ${(e as Error).message}`, _noRetry: true };
        } finally {
          activeDelegations.delete(guardKey);
        }
      },
    };
  },

  'delegate:workflow': (ctx, chatRouter) => {
    if (!chatRouter) {
      return {
        id: 'delegate:workflow',
        category: SkillCategory.DELEGATE,
        name: 'delegate_workflow',
        description: '向流程设计智能体委派任务（不可用：缺少 ChatRouter）',
        parameters: { type: 'object', properties: {} },
        async execute() { return { success: false, message: 'ChatRouter 不可用' }; },
      };
    }

    return {
      id: 'delegate:workflow',
      category: SkillCategory.DELEGATE,
      name: 'delegate_workflow',
      description: `向流程设计智能体委派流程设计任务。
流程设计智能体具备独立的流程设计能力，会自行分析需求、搜索成员/角色、设计流程，并输出结果。
task_type 用于限定子智能体只执行对应阶段的任务：design_form 仅设计表单，design_workflow 仅设计/修改流程，不传则表单+流程一起做。`,
      parameters: {
        type: 'object',
        properties: {
          requirement: { type: 'string', description: '流程设计需求描述' },
          task_type: { type: 'string', enum: ['design_form', 'design_workflow'], description: '任务类型（可选）：design_form=仅设计表单；design_workflow=仅设计/修改流程；不传则表单+流程完整执行' },
          context: { type: 'string', description: '相关上下文（页面名称、已有流程、表单 ID 及字段 key 等）' },
        },
        required: ['requirement'],
      },
      async execute(args, execCtx) {
        // 内核确认重执行：为子会话即将重试的危险操作放行（批准接力）
        if ((execCtx as { kernelCall?: { resume?: boolean } } | undefined)?.kernelCall?.resume) {
          approvePendingApproval();
        }
        const { requirement, context } = args as { requirement: string; context?: string };
        const taskType = (args as { task_type?: string }).task_type;
        const mode: WorkflowDelegateMode
          = taskType === 'design_form' || taskType === 'design_workflow' ? taskType : 'full';

        if (activeDelegations.has('workflow')) {
          console.warn(`[delegate_workflow] 流程设计助手正在工作中，拒绝重复调用`);
          return { success: false, message: '流程设计助手正在工作中，请等待其完成后再试', _noRetry: true };
        }
        activeDelegations.add('workflow');

        const execStart = Date.now();
        console.log(`[delegate_workflow] 开始委派流程设计任务 | mode=${mode}`);

        ctx.dispatch?.({
          type: 'DELEGATE_WORKFLOW_START',
          payload: { requirement },
        });

        try {
          let existingFormsInfo = '';
          try {
            const forms = await formApi.list({ applicationId: ctx.applicationId });
            if (forms && forms.length > 0) {
              existingFormsInfo = `\n## 当前应用已有表单\n${forms.map((f: { id: number; name: string }) => `- ${f.name} (ID: ${f.id})`).join('\n')}\n\n⚠️ 如果已有表单能满足需求，直接用已有表单 ID 绑定，不要重复创建！`;
            }
          } catch {
            // 查询失败不阻塞流程
          }

          const systemPrompt = buildWorkflowDelegateSystemPrompt(mode, {
            applicationId: ctx.applicationId,
            existingFormsInfo,
            context,
            currentUser: getCallerIdentity(),
          });

          const executor = await chatRouter!.routeTo('workflow-assistant', `请设计流程：${requirement}`, `wf-${Date.now()}`, {
            systemPrompt,
            isDelegated: true,
            initialMessages: loadDelegationMemory(ctx.applicationId, 'workflow-assistant'),
            agentContext: { requirement, context, taskType: mode },
          });

          const messages = executor.getMessages();
          saveDelegationMemory(ctx.applicationId, 'workflow-assistant', messages);

          // 确认门暂停传播：与 delegate_query 相同，子智能体带未确认操作返回时主智能体必须暂停
          const pauseReason = detectSubAgentPause(messages);
          if (pauseReason) {
            console.warn(`[delegate_workflow] 子智能体等待用户确认，主智能体暂停 | ${pauseReason.slice(0, 80)}`);
            const kernelCallId = (execCtx as { kernelCall?: { callId?: string } } | undefined)?.kernelCall?.callId || '';
            const delegateArgs = args as Record<string, unknown>;
            return {
              success: false,
              _pause: true,
              message: `流程设计助手有一个危险操作等待用户确认，本次任务未完成。请向用户转述下面的确认请求，等用户回复"确认"后重新委派本任务；用户回复"取消"则放弃该操作：\n${pauseReason}`,
              data: kernelCallId ? {
                suspendRequest: {
                  kind: 'danger-confirm',
                  callId: kernelCallId,
                  toolName: 'delegate_workflow',
                  args: delegateArgs,
                  argsKey: toolArgsKey(delegateArgs),
                  message: `子智能体危险操作待确认：${pauseReason}`,
                },
              } : undefined,
            };
          }

          const response = messages
            .filter((m) => (m as Message).role === 'assistant')
            .map((m) => (m as Message).content)
            .join('\n\n')
            .trim();

          // 检测子智能体执行过程中的工具失败，失败时不能向主智能体返回成功。
          // 只看本次任务的消息，避免上一轮已解决的失败反复误报为"本次失败"
          const failedToolMessages = Array.from(new Set(
            messagesSinceLastUserTask(messages)
              .filter((m) => (m as Message).role === 'tool')
              .map((m) => (m as Message).content || '')
              .filter((content: string) => !content.includes('已暂停，等待用户确认后继续'))
              .map((content: string) => {
                try {
                  const parsed = JSON.parse(content) as { success?: boolean; message?: string };
                  return parsed.success === false ? (parsed.message || '未知错误') : null;
                } catch {
                  return null;
                }
              })
              .filter((msg): msg is string => !!msg),
          ));

          if (failedToolMessages.length > 0) {
            console.warn(`[delegate_workflow] 子智能体执行中有 ${failedToolMessages.length} 次工具失败 | ${failedToolMessages.join('；')}`);
            ctx.dispatch?.({
              type: 'DELEGATE_WORKFLOW_END',
              payload: { success: false, error: failedToolMessages.join('；'), details: response },
            });
            return {
              success: false,
              message: `流程设计智能体执行过程中有工具调用失败，任务可能未完成，请将以下失败信息如实转达用户，禁止标记为已完成：\n${failedToolMessages.map((f) => `- ${f}`).join('\n')}\n\n子智能体最后回复：${response || '（无）'}`,
              data: { response, outcomes: extractWorkflowOutcomes(messages), failures: failedToolMessages },
            };
          }

          const outcomes = extractWorkflowOutcomes(messages);
          ctx.dispatch?.({
            type: 'DELEGATE_WORKFLOW_END',
            payload: { success: true, details: response },
          });

          console.log(`[delegate_workflow] 完成 | 总耗时: ${Date.now() - execStart}ms | outcomes: ${JSON.stringify(outcomes)}`);
          const outcomeSummary = outcomes
            .map((o) => `${o.type} ${o.name || ''}(ID: ${o.id})${o.fields ? ` 字段[${o.fields.map((f) => f.key).join(',')}]` : ''}`)
            .join('；');
          return {
            success: true,
            message: `流程设计任务完成${outcomeSummary ? `。产出资源：${outcomeSummary}` : ''}`,
            data: { response, outcomes },
          };
        } catch (e: unknown) {
          console.error(`[delegate_workflow] 失败:`, e);
          ctx.dispatch?.({
            type: 'DELEGATE_WORKFLOW_END',
            payload: { success: false, error: (e as Error).message },
          });
          return { success: false, message: `流程设计智能体执行失败: ${(e as Error).message}`, _noRetry: true };
        } finally {
          activeDelegations.delete('workflow');
        }
      },
    };
  },

  'delegate:orchestration': (_ctx, chatRouter) => {
    if (!chatRouter) {
      return {
        id: 'delegate:orchestration',
        category: SkillCategory.DELEGATE,
        name: 'delegate_orchestration',
        description: '委派 API 编排任务（不可用：缺少 ChatRouter）',
        parameters: { type: 'object', properties: {} },
        async execute() { return { success: false, message: 'ChatRouter 不可用' }; },
      };
    }

    return {
      id: 'delegate:orchestration',
      category: SkillCategory.DELEGATE,
      name: 'delegate_orchestration',
      description: `委派 API 编排任务给编排设计助手：自然语言描述数据聚合/调用链需求，助手产出 DSL 并完成校验、试运行；发布需你确认。`,
      parameters: {
        type: 'object',
        properties: {
          requirement: { type: 'string', description: '编排需求描述，如"聚合客户 360 视图：查客户基础信息+订单列表，Python 合并返回"' },
          context: { type: 'string', description: '相关上下文（页面名称、已有 queryId/toolId 等）' },
        },
        required: ['requirement'],
      },
      async execute(args) {
        const { requirement, context } = args as { requirement: string; context?: string };
        console.log(`[delegate_orchestration] 开始 | ${String(requirement).slice(0, 60)}`);
        try {
          const executor = await chatRouter.routeTo('orchestration-assistant',
            `请设计编排：${requirement}${context ? `（上下文：${context}）` : ''}`,
            `orch-${Date.now()}`, { isDelegated: true, agentContext: { requirement, context } });
          const messages = executor.getMessages();
          const response = messages
            .filter((m) => (m as Message).role === 'assistant')
            .map((m) => (m as Message).content || '')
            .join('\n\n')
            .trim();
          return { success: true, message: response || '编排设计助手已完成', data: { response } };
        } catch (e) {
          return { success: false, message: `编排设计助手执行失败: ${(e as Error).message}` };
        }
      },
    };
  },

  'delegate:analysis': () => ({
    id: 'delegate:analysis',
    category: SkillCategory.DELEGATE,
    name: 'delegate_analysis',
    description: '【已废弃】需求分析已由主智能体自行完成，请直接调用 list_pages/list_queries/get_query 探查后输出分析报告，再调用 create_plan',
    parameters: {
      type: 'object',
      properties: {
        requirement: { type: 'string', description: '用户需求描述' },
      },
      required: ['requirement'],
    },
    async execute() {
      return {
        success: false,
        message: 'delegate_analysis 已废弃。需求分析由主智能体自行完成：请调用 list_pages → list_queries → get_query → 输出分析报告 → create_plan 创建计划。',
      };
    },
  }),
};