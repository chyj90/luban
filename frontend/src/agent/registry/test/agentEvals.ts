/**
 * Agent 回归评测（需求 R11 首批）
 *
 * 设计原则：
 * - 全部为确定性断言（不依赖 LLM，可在 dev/CI 稳定运行）；LLM 判分类场景留待后续批次；
 * - 通过依赖注入隔离网络与运行时（fake ChatRouter / 桩 ToolContext）；
 * - 首批用例覆盖 2026-09-08 请假审批流程事故链的每个环节：
 *   E1 提示词-工具一致性（事故根因：update_workflow 未注册）
 *   E2 事故场景复现：模拟 allowedSkills 漂移，校验器必须报警（回归防线）
 *   E3 计划自动推导：请假审批分析 → 2 个 delegate_workflow 步骤 + task_type + 依赖
 *   E4 委派失败检测：子智能体工具失败时 delegate_workflow 必须返回 success=false
 *   E5 危险操作确认门：delete 类工具被拦截，用户确认后放行一次
 *   E6 委派提示词阶段隔离：design_form 模式禁止创建流程的指令存在
 */
import type { ChatRouter } from '../../core/chatRouter';
import type { ToolContext, ToolExecuteResult, Message } from '@/types/agent';
import type { LLMMessage } from '../../core/llmClient';
import { parseToolArguments } from '../../core/llmClient';
import {
  runConsistencyCheck,
  checkTarget,
  buildConsistencyTargets,
  toolNameUniverse,
  type ConsistencyTarget,
} from '../agentSelfCheck';
import { derivePlanFromAnalysis } from '../skills/planSkills';
import { delegateSkills, buildWorkflowDelegateSystemPrompt, extractWorkflowOutcomes, validateDDLExecution } from '../skills/delegateSkills';
import * as contextWindowModule from '../../core/contextWindow';
import * as agentMemoryModule from '../agentMemory';
import { resolveSkills } from '../skillRegistry';
import { consumeApproval, onUserMessage, resetConfirmationGuard, hasPending } from '../../core/confirmationGuard';

export interface EvalResult {
  name: string;
  passed: boolean;
  detail: string;
}

const STUB_CTX: ToolContext = {
  applicationId: 1,
  pageId: 1,
} as ToolContext;

function evalResult(name: string, passed: boolean, detail: string): EvalResult {
  return { name, passed, detail };
}

/** E1: 当前代码库的提示词-工具一致性必须全部通过 */
function evalConsistencyClean(): EvalResult {
  const violations = runConsistencyCheck();
  return evalResult(
    'E1-提示词工具一致性(现状)',
    violations.length === 0,
    violations.length === 0
      ? '全部通过'
      : violations.map((v) => `[${v.agentId}/${v.source}] ${v.toolName}: ${v.reason}`).join('\n'),
  );
}

/** E2: 复现 2026-09-08 事故——工具从 allowedSkills 漂移掉时，校验器必须报警 */
function evalIncidentToolDrift(): EvalResult {
  const workflowTarget = buildConsistencyTargets().find((t) => t.agentId === 'workflow-assistant');
  if (!workflowTarget) {
    return evalResult('E2-事故复现(工具漂移)', false, '找不到 workflow-assistant 校验目标');
  }
  // 模拟事故现场：工具列表里去掉 update_workflow（等价于当时 allowedSkills 漏注册）
  const drifted: ConsistencyTarget = {
    ...workflowTarget,
    toolNames: workflowTarget.toolNames.filter((n) => n !== 'update_workflow'),
  };
  const violations = checkTarget(drifted, toolNameUniverse());
  const caught = violations.some((v) => v.toolName === 'update_workflow');
  return evalResult(
    'E2-事故复现(工具漂移)',
    caught,
    caught
      ? '校验器成功捕获 update_workflow 漂移'
      : `校验器未捕获漂移！违规列表: ${violations.map((v) => v.toolName).join(',') || '(空)'}`,
  );
}

/** E3: 计划自动推导回归——chat.log 中请假审批的分析数据 */
function evalPlanDerivation(): EvalResult {
  const analysis = {
    title: '创建请假审批流程',
    summary: '设计请假表单，再设计条件分支审批流程',
    pages: [],
    workflows: [
      {
        description: '请假审批流程：员工填写请假表单发起申请，按请假天数条件自动流转审批节点',
        hasForm: true,
        formDescription: '设计请假表单，字段：请假类型(下拉选项:年假/事假/病假/调休,必填)、请假天数(数字,必填)',
        hasWorkflow: true,
        workflowDescription: '设计请假审批流程，条件分支：请假天数≤3天→直属上级审批；>3天→直属上级审批→部门经理审批',
      },
    ],
  };
  const items = derivePlanFromAnalysis(analysis);

  const checks: string[] = [];
  if (items.length !== 2) checks.push(`步骤数应为 2，实际 ${items.length}`);
  const [step1, step2] = items;
  if (step1?.toolName !== 'delegate_workflow') checks.push(`步骤1 toolName 应为 delegate_workflow，实际 ${step1?.toolName}`);
  if (step1?.toolInput.task_type !== 'design_form') checks.push(`步骤1 task_type 应为 design_form，实际 ${step1?.toolInput.task_type}`);
  if (step2?.toolName !== 'delegate_workflow') checks.push(`步骤2 toolName 应为 delegate_workflow，实际 ${step2?.toolName}`);
  if (step2?.toolInput.task_type !== 'design_workflow') checks.push(`步骤2 task_type 应为 design_workflow，实际 ${step2?.toolInput.task_type}`);
  if (JSON.stringify(step2?.dependencies) !== '["1"]') checks.push(`步骤2 依赖应为 ["1"]，实际 ${JSON.stringify(step2?.dependencies)}`);

  return evalResult('E3-计划自动推导(请假审批)', checks.length === 0, checks.length === 0 ? '结构完全符合预期' : checks.join('；'));
}

/** E3b: 计划自动推导——含编排（pages[].orchestrations）的回归 */
function evalPlanDerivationWithOrch(): EvalResult {
  const analysis = {
    title: '创建请假申请应用',
    summary: '新建请假页面，绑定查询与编排，配套审批流程',
    pages: [
      {
        name: '请假申请',
        action: 'create' as const,
        queries: [
          { queryName: 'GetLeaves', purpose: '请假记录列表', needsNewTable: true, fields: 'id,applicant,reason,status,created_at', filterParams: 'applicant(文本,精确匹配)' },
        ],
        apis: [],
        orchestrations: [
          { orchName: 'OrcLeaveApply', purpose: '先查询再发起审批' },
        ],
      },
    ],
    workflows: [],
  };
  const items = derivePlanFromAnalysis(analysis);

  const checks: string[] = [];
  // 预期 3 步：delegate_query → delegate_orchestration → create_code_page
  if (items.length !== 3) checks.push(`步骤数应为 3，实际 ${items.length}: ${items.map(i => i.toolName).join(', ')}`);
  const [step1, step2, step3] = items;
  if (step1?.toolName !== 'delegate_query') checks.push(`步骤1 应为 delegate_query，实际 ${step1?.toolName}`);
  if (step2?.toolName !== 'delegate_orchestration') checks.push(`步骤2 应为 delegate_orchestration，实际 ${step2?.toolName}`);
  if (step3?.toolName !== 'create_code_page') checks.push(`步骤3 应为 create_code_page，实际 ${step3?.toolName}`);
  // 编排依赖查询，页面依赖查询+编排
  if (JSON.stringify(step2?.dependencies) !== '["1"]') checks.push(`步骤2 依赖应为 ["1"]，实际 ${JSON.stringify(step2?.dependencies)}`);
  if (JSON.stringify(step3?.dependencies) !== '["1","2"]') checks.push(`步骤3 依赖应为 ["1","2"]，实际 ${JSON.stringify(step3?.dependencies)}`);

  return evalResult('E3b-计划推导(含编排)', checks.length === 0, checks.length === 0 ? '步骤顺序与依赖正确' : checks.join('；'));
}

/** E4: 委派失败检测回归——子智能体工具报"不存在"时，delegate_workflow 不得返回成功 */
async function evalDelegateFailureDetection(): Promise<EvalResult> {
  const failedToolContent = JSON.stringify({ success: false, message: '工具 "update_workflow" 不存在' });
  const fakeMessages: Message[] = [
    { id: 'u1', role: 'user', content: '请设计流程：修改流程17', timestamp: 0 },
    {
      id: 'a1', role: 'assistant', content: '尝试调用 update_workflow', timestamp: 0,
      toolCalls: [{ id: 't1', name: 'update_workflow', arguments: {}, status: 'done' }],
    },
    { id: 'm1', role: 'tool', content: failedToolContent, toolCallId: 't1', timestamp: 0 },
    { id: 'a2', role: 'assistant', content: '执行完毕。', timestamp: 0 },
  ];

  const fakeRouter = {
    routeTo: async () => ({
      run: async () => {},
      cancel: () => {},
      getMessages: () => fakeMessages,
    }),
  } as unknown as ChatRouter;

  const factory = delegateSkills['delegate:workflow'];
  if (!factory) return evalResult('E4-委派失败检测', false, 'delegate:workflow 技能未注册');
  const skill = factory(STUB_CTX, fakeRouter);
  const result: ToolExecuteResult = await skill.execute(
    {
      requirement: '修改流程 17，加条件分支',
      task_type: 'design_workflow',
    },
    STUB_CTX,
  );

  const passed = result.success === false && result.message.includes('update_workflow');
  return evalResult(
    'E4-委派失败检测',
    passed,
    passed
      ? '工具失败被正确透传（success=false）'
      : `期望 success=false 且 message 含失败工具名，实际 success=${result.success}，message="${result.message.slice(0, 120)}"`,
  );
}

/** E5: 危险操作确认门 */
function evalConfirmationGate(): EvalResult {
  const checks: string[] = [];
  resetConfirmationGuard();

  // delete_page 必须带确认标记
  const pageDelete = resolveSkills(['page:delete'], STUB_CTX)[0];
  if (!pageDelete?.requiresConfirmation) checks.push('page:delete 未标记 requiresConfirmation');
  const queryDelete = resolveSkills(['query:delete'], STUB_CTX)[0];
  if (!queryDelete?.requiresConfirmation) checks.push('query:delete 未标记 requiresConfirmation');
  const workflowCancel = resolveSkills(['workflow:cancel'], STUB_CTX)[0];
  if (!workflowCancel?.requiresConfirmation) checks.push('workflow:cancel 未标记 requiresConfirmation');

  // 未确认 → 拦截；确认后同参数 → 放行一次；换参数 → 再拦截
  const args = { pageId: 84 };
  if (consumeApproval('delete_page', args) !== 'blocked') checks.push('未确认时应 blocked');
  onUserMessage('确认');
  if (consumeApproval('delete_page', args) !== 'approved') checks.push('用户确认后同参数应 approved');
  if (consumeApproval('delete_page', args) !== 'blocked') checks.push('放行一次后应重新 blocked（一次性确认）');
  onUserMessage('确认');
  if (consumeApproval('delete_page', { pageId: 85 }) === 'approved') checks.push('参数变化时应 mismatch/blocked 而非 approved');
  onUserMessage('取消');

  resetConfirmationGuard();
  return evalResult('E5-危险操作确认门', checks.length === 0, checks.length === 0 ? '标记与门逻辑全部正确' : checks.join('；'));
}

/** E6: 委派提示词阶段隔离——design_form 模式必须包含禁止建流程的指令 */
function evalDelegateModeIsolation(): EvalResult {
  const checks: string[] = [];

  const formMode = buildWorkflowDelegateSystemPrompt('design_form', { applicationId: 1 });
  if (!formMode.includes('禁止创建流程')) checks.push('design_form 模式缺少"禁止创建流程"指令');
  if (!formMode.includes('design_workflow') || !formMode.includes('bind_workflow')) {
    checks.push('design_form 模式应显式点名禁止的工具（design_workflow/bind_workflow）');
  }

  const wfMode = buildWorkflowDelegateSystemPrompt('design_workflow', { applicationId: 1 });
  if (!wfMode.includes('get_definition')) checks.push('design_workflow 模式缺少 get_definition 先读后写指引');
  if (!wfMode.includes('update_workflow')) checks.push('design_workflow 模式缺少 update_workflow 指引');
  if (!/禁止猜测字段名|真实字段 key/.test(wfMode)) checks.push('design_workflow 模式缺少"禁止猜测字段 key"规则');

  const fullMode = buildWorkflowDelegateSystemPrompt('full', { applicationId: 1 });
  if (!fullMode.includes('update_workflow')) checks.push('full 模式应包含修改已有流程路径（update_workflow）');

  return evalResult('E6-委派提示词阶段隔离', checks.length === 0, checks.length === 0 ? '三种模式的关键指令齐全' : checks.join('；'));
}

/** E7: 步骤完成核验（R2）——伪造的 result 必须被拦截，真实的必须放行 */
async function evalStepVerifier(): Promise<EvalResult> {
  const { verifyStepCompletion, setStepVerifierDeps } = await import('../skills/stepVerifier');
  const checks: string[] = [];

  // 桩：流程 17 存在但只有串行节点（无 condition）——正是 chat.log 事故的现场
  setStepVerifierDeps({
    getForm: async (id) => (id === 21 ? { id: 21, fields: JSON.stringify([{ key: 'leaveDays', type: 'number' }]) } : Promise.reject(new Error('404'))),
    getWorkflow: async (id) => (id === 17
      ? { id: 17, name: '请假审批流程', nodes: JSON.stringify([{ nodeType: 'start' }, { nodeType: 'approval' }, { nodeType: 'end' }]), edges: '[]' } as never
      : Promise.reject(new Error('404'))),
    listQueries: async () => ({ data: [] }),
  });

  // 事故现场：result 声称配置了条件分支，但流程 17 实际无 condition 节点 → 必须拦截
  const fakeBranch = await verifyStepCompletion(
    'delegate_workflow', 1,
    '设计请假审批流程，条件分支：请假天数≤3天→直属上级审批',
    '请假审批流程已配置条件分支（流程ID: 17）',
  );
  if (fakeBranch.verified) checks.push('声称有条件分支但实际无 condition 节点，应拦截');
  if (!fakeBranch.reason?.includes('condition')) checks.push('拦截原因应指出缺少 condition 节点');

  // 无 condition 描述 + 串行流程 → 放行
  const simple = await verifyStepCompletion('delegate_workflow', 1, '设计简单审批流程', '流程创建成功（流程ID: 17）');
  if (!simple.verified) checks.push(`串行流程 + 无分支描述应放行，实际拦截: ${simple.reason}`);

  // result 中没有资源 ID → 拦截并指导补 ID
  const noId = await verifyStepCompletion('delegate_workflow', 1, '设计请假流程', '任务完成');
  if (noId.verified) checks.push('result 无资源 ID 应拦截');

  // 表单存在且有字段 → 放行
  const formOk = await verifyStepCompletion('delegate_workflow', 1, '设计请假表单', '表单创建成功（表单ID: 21）');
  if (!formOk.verified) checks.push(`表单存在且有字段应放行，实际拦截: ${formOk.reason}`);

  // 声称有条件分支且流程真有 condition → 放行
  setStepVerifierDeps({
    getWorkflow: async (id) => (id === 17
      ? { id: 17, name: '请假审批流程', nodes: JSON.stringify([{ nodeType: 'start' }, { nodeType: 'approval' }, { nodeType: 'condition' }, { nodeType: 'end' }]), edges: '[]' } as never
      : Promise.reject(new Error('404'))),
  });
  const realBranch = await verifyStepCompletion(
    'delegate_workflow', 1,
    '设计请假审批流程，条件分支：≤3天/＞3天',
    '已配置条件分支（流程ID: 17）',
  );
  if (!realBranch.verified) checks.push(`真实条件分支应放行，实际拦截: ${realBranch.reason}`);

  setStepVerifierDeps(); // 恢复真实 API 依赖
  return evalResult('E7-步骤完成核验(grounding)', checks.length === 0, checks.length === 0 ? '伪造完成被拦截、真实完成被放行' : checks.join('；'));
}

/** E8: 结构化委派契约（R7）——从 tool 消息聚合 outcomes，不依赖模型汇报格式 */
function evalDelegateOutcomes(): EvalResult {
  const checks: string[] = [];

  const messages = [
    {
      id: 'a1', role: 'assistant', content: '', timestamp: 0,
      toolCalls: [
        { id: 't1', name: 'design_form', arguments: { name: '请假申请单', fields: [{ key: 'leaveDays', label: '请假天数', type: 'number', required: true }] } },
        { id: 't2', name: 'design_workflow', arguments: { name: '请假审批流程' } },
        { id: 't3', name: 'bind_workflow', arguments: { processId: 17, formId: 21 } },
      ],
    },
    { id: 'm1', role: 'tool', content: JSON.stringify({ success: true, message: '表单创建成功', data: { id: 21, name: '请假申请单' } }), toolCallId: 't1', timestamp: 0 },
    { id: 'm2', role: 'tool', content: JSON.stringify({ success: true, message: '流程创建成功', data: { id: 17, name: '请假审批流程' } }), toolCallId: 't2', timestamp: 0 },
    { id: 'm3', role: 'tool', content: JSON.stringify({ success: true, message: '流程绑定成功' }), toolCallId: 't3', timestamp: 0 },
  ];

  const outcomes = extractWorkflowOutcomes(messages);
  const form = outcomes.find((o) => o.type === 'form');
  const wf = outcomes.find((o) => o.type === 'workflow');
  const binding = outcomes.find((o) => o.type === 'binding');
  if (!form || form.id !== 21) checks.push('应提取 form id=21');
  if (!form?.fields?.some((f) => f.key === 'leaveDays')) checks.push('form outcome 应携带字段 key leaveDays');
  if (!wf || wf.id !== 17) checks.push('应提取 workflow id=17');
  if (!binding || binding.boundFormId !== 21 || binding.boundProcessId !== 17) checks.push('应提取 binding 21↔17');

  return evalResult('E8-结构化委派契约', checks.length === 0, checks.length === 0 ? 'outcomes 提取完整（form+fields/workflow/binding）' : checks.join('；'));
}

/** E9: 上下文压缩（R4）——预算内原样返回；超预算裁剪旧工具结果、整组丢弃、保护 system 与最近窗口 */
function evalContextCompaction(): EvalResult {
  const checks: string[] = [];
  const { compactForApi, estimateChars } = contextWindowModule;

  // 构造：system + user + 30 组 (assistant+tool)，tool 内容 4000 字符 → 约 12 万字符
  const messages: LLMMessage[] = [
    { role: 'system', content: 'S'.repeat(2000) },
    { role: 'user', content: '创建请假流程' },
  ];
  for (let i = 0; i < 30; i++) {
    messages.push({
      role: 'assistant', content: '', tool_calls: [{ id: `t${i}`, type: 'function', function: { name: 'run_query', arguments: '{"id":1}' } }],
    });
    messages.push({ role: 'tool', content: 'X'.repeat(4000), tool_call_id: `t${i}` });
  }

  // 预算内 → 原样返回（同一引用，零行为变化）
  if (compactForApi(messages, 10 ** 9) !== messages) checks.push('预算内应原样返回');

  // 层 1：预算 65000 → 只裁剪旧工具结果，保护窗口（最近 24 条 = 后 12 组）原样
  const l1 = compactForApi(messages, 65_000, 24);
  const l1OldTrimmed = l1.filter((m) => m.role === 'tool' && m.content.includes('已裁剪'));
  if (l1OldTrimmed.length === 0) checks.push('层1应裁剪旧工具结果为占位标记');
  const l1TailTools = l1.slice(-24).filter((m) => m.role === 'tool');
  if (!l1TailTools.every((m) => m.content === 'X'.repeat(4000))) checks.push('保护窗口内的工具结果不应被裁剪');
  if (l1[0].role !== 'system' || l1[0].content !== 'S'.repeat(2000)) checks.push('system 消息必须完整保留');
  if (estimateChars(l1) > 65_000) checks.push(`层1结果应回到预算内，实际 ${estimateChars(l1)}`);

  // 层 2：预算 20000 → 旧单元整组丢弃，且 tool 消息必须紧跟配对 assistant
  const l2 = compactForApi(messages, 20_000, 24);
  if (l2.length >= messages.length) checks.push('层2应丢弃部分最旧消息');
  if (l2[0].role !== 'system') checks.push('压缩后首条必须是 system');
  for (let i = 0; i < l2.length; i++) {
    if (l2[i].role === 'tool') {
      const prev = l2[i - 1];
      const paired = prev?.role === 'assistant' && (prev.tool_calls || []).some((tc) => tc.id === l2[i].tool_call_id);
      if (!paired) {
        checks.push(`tool 消息 ${l2[i].tool_call_id} 与前一条 assistant 配对断裂`);
        break;
      }
    }
  }

  // 层 3：全部消息都在保护窗口内且 tool 结果巨大 → 裁剪窗口内旧工具结果（最近 6 条原样）
  const heavy: LLMMessage[] = [
    { role: 'system', content: 'S'.repeat(2000) },
    { role: 'user', content: '改页面' },
  ];
  for (let i = 0; i < 8; i++) {
    heavy.push({
      role: 'assistant', content: '', tool_calls: [{ id: `h${i}`, type: 'function', function: { name: 'get_code_page', arguments: '{}' } }],
    });
    heavy.push({ role: 'tool', content: 'Y'.repeat(18000), tool_call_id: `h${i}` });
  }
  const l3 = compactForApi(heavy, 70_000, 24);
  const l3Tools = l3.filter((m) => m.role === 'tool');
  const trimmed = l3Tools.filter((m) => m.content.includes('已裁剪'));
  const intact = l3Tools.filter((m) => m.content === 'Y'.repeat(18000));
  if (trimmed.length !== 5) checks.push(`层3应裁剪窗口内 5 条旧工具结果（最近 6 条消息原样），实际裁剪 ${trimmed.length} 条`);
  if (intact.length !== 3) checks.push(`最近 6 条消息内的工具结果应原样保留，实际完整 ${intact.length} 条`);
  if (estimateChars(l3) > 70_000) checks.push(`层3结果应回到预算内，实际 ${estimateChars(l3)}`);
  for (let i = 0; i < l3.length; i++) {
    if (l3[i].role === 'tool') {
      const prev = l3[i - 1];
      const paired = prev?.role === 'assistant' && (prev.tool_calls || []).some((tc) => tc.id === l3[i].tool_call_id);
      if (!paired) { checks.push('层3 tool 配对断裂'); break; }
    }
  }

  return evalResult('E9-上下文压缩', checks.length === 0, checks.length === 0 ? '预算直通/裁剪/整组丢弃/配对不变量全部正确' : checks.join('；'));
}

/** E10: 委派记忆上限（R5）——条数封顶 + 大体积 tool 内容截断 */
function evalDelegationMemoryBound(): EvalResult {
  const checks: string[] = [];
  const { loadDelegationMemory, saveDelegationMemory } = agentMemoryModule;

  const appId = 99901; // 独立 appId 避免污染其他用例
  const bigTool = 'Y'.repeat(20_000);
  const messages: Message[] = [];
  for (let i = 0; i < 249; i++) {
    messages.push({ id: `m${i}`, role: 'assistant', content: `msg-${i}`, timestamp: 0 });
  }
  // 大体积 tool 消息放在最近端（保留窗口内），单独验证截断逻辑
  messages.push({ id: 'm-tool', role: 'tool', content: bigTool, toolCallId: 't0', timestamp: 0 });
  saveDelegationMemory(appId, 'memory-test-agent', messages);

  const loaded = loadDelegationMemory(appId, 'memory-test-agent');
  if (loaded.length !== 200) checks.push(`应只保留最近 200 条，实际 ${loaded.length}`);
  const bigStored = loaded.find((m) => m.role === 'tool');
  if (!bigStored || bigStored.content.length >= 20_000 || !bigStored.content.includes('已截断')) {
    checks.push('超大 tool 内容应被截断并带标记');
  }

  return evalResult('E10-委派记忆上限', checks.length === 0, checks.length === 0 ? '200 条封顶 + 8000 字符截断生效' : checks.join('；'));
}

/** E11: 表单容器校验误报回归（chat.log 2026-09-09 事故）——真实 <form> 内的 luban-form-item div 不得命中 */
async function evalFormContainerFalsePositive(): Promise<EvalResult> {
  const checks: string[] = [];
  const { validateCode } = await import('../skills/codeValidate');
  // validateCode 返回的 errors 只含阻断项，[表单容器] 属于 fixable（页面创建时的"待修问题"即来源于此）
  const findFormContainerIssue = async (html: string, js: string) => {
    const r = await validateCode(html, '', js);
    return [...r.errors, ...r.fixable].find((e) => e.startsWith('[表单容器]'));
  };

  // 事故现场：真实 <form> 容器 + 内部 luban-form-item / luban-form-label-row div + form.name.value 访问
  const okHtml = '<div class="page-container">'
    + '<form class="luban-form" id="customerForm">'
    + '<div class="luban-form-item"><label class="luban-form-label">客户名称</label><input name="name"></div>'
    + '<div class="luban-form-item"><div class="luban-form-label-row"><label>备注</label></div><textarea name="note"></textarea></div>'
    + '</form></div>';
  const js = "var form = document.getElementById('customerForm');\nform.name.value = 'x';\nform.note.value = 'y';";

  const okIssue = await findFormContainerIssue(okHtml, js);
  if (okIssue) checks.push(`正常 <form> 结构被误报：${okIssue.slice(0, 120)}`);

  // 反向对照：div 真的当容器用 + 属性访问 → 必须报错
  const badIssue = await findFormContainerIssue('<div class="luban-form" id="customerForm"><input name="name"></div>', js);
  if (!badIssue) checks.push('div 充当表单容器时未被拦截（回归修复把真检查也弄丢了）');

  return evalResult('E11-表单容器误报回归', checks.length === 0, checks.length === 0 ? '误报消除且真检查保留（fixable 通道）' : checks.join('；'));
}

/** E12: 计划推导按页合并查询委派（chat.log 2026-09-09：4 次串行委派近 2 分钟） */
function evalPlanQueryBatching(): EvalResult {
  const checks: string[] = [];
  const analysis = {
    title: '创建客户管理页面',
    summary: '客户管理页',
    pages: [
      {
        name: '客户管理',
        action: 'create' as const,
        queries: [
          { queryName: 'GetCustomers', purpose: '统计卡片+列表', needsNewTable: false, fields: 'id,name,level', filterParams: 'keyword(文本,模糊搜索name), level(选项,精确匹配)' },
          { queryName: 'InsertCustomer', purpose: '新增客户', needsNewTable: false },
          { queryName: 'UpdateCustomer', purpose: '编辑客户', needsNewTable: false },
          { queryName: 'DeleteCustomer', purpose: '删除客户', needsNewTable: false },
        ],
        apis: [],
        orchestrations: [],
      },
    ],
    workflows: [],
  };
  const items = derivePlanFromAnalysis(analysis);
  const querySteps = items.filter((i) => i.toolName === 'delegate_query');
  const pageSteps = items.filter((i) => i.toolName === 'create_code_page');

  if (querySteps.length !== 1) checks.push(`4 个查询应合并为 1 个 delegate_query 步骤，实际 ${querySteps.length}`);
  const batch = querySteps[0];
  if (batch) {
    for (const name of ['GetCustomers', 'InsertCustomer', 'UpdateCustomer', 'DeleteCustomer']) {
      if (!batch.description.includes(name)) checks.push(`批次描述缺少查询 ${name}`);
    }
    if (batch.toolInput.query_name !== 'GetCustomers') checks.push(`query_name 应为主查询 GetCustomers，实际 ${batch.toolInput.query_name}`);
    if (!String(batch.toolInput.filter_params || '').includes('keyword')) checks.push('filter_params 应携带主查询的筛选参数');
    // 多查询必须以结构化 queries 数组声明（校验器按查询逐一校验筛选参数覆盖）
    const queriesArr = batch.toolInput.queries as Array<{ query_name: string; filter_params?: string }> | undefined;
    if (!Array.isArray(queriesArr) || queriesArr.length !== 4) {
      checks.push(`toolInput.queries 应为 4 元素数组，实际 ${Array.isArray(queriesArr) ? queriesArr.length : '缺失'}`);
    } else {
      const byName = new Map(queriesArr.map((q) => [q.query_name, q]));
      if (!String(byName.get('GetCustomers')?.filter_params || '').includes('keyword')) {
        checks.push('queries 数组中 GetCustomers 应携带自己的筛选参数');
      }
    }
  }
  if (pageSteps.length !== 1) checks.push(`应有 1 个 create_code_page 步骤，实际 ${pageSteps.length}`);
  if (batch && pageSteps[0] && JSON.stringify(pageSteps[0].dependencies) !== JSON.stringify([batch.id])) {
    checks.push(`页面步骤应依赖查询批次步骤 ${batch.id}，实际 ${JSON.stringify(pageSteps[0].dependencies)}`);
  }

  return evalResult('E12-计划查询批次合并', checks.length === 0, checks.length === 0 ? '4 查询合并为 1 次委派，页面依赖正确' : checks.join('；'));
}

/** E13: DDL 降级校验——DDL 被拦截后未提供降级 SQL 时必须报警 */
function evalDDLFallbackValidation(): EvalResult {
  const checks: string[] = [];

  // 场景 1：DDL 被拦截 + 未提供降级 SQL → 必须报警
  const noFallbackMessages = [
    {
      role: 'assistant',
      content: '我来创建表',
      toolCalls: [{ id: 'call_1', name: 'execute_sql', arguments: { sql: 'CREATE TABLE leaves (id INT)' } }],
    },
    { role: 'tool', content: JSON.stringify({ success: false, message: 'DDL 操作不允许' }), toolCallId: 'call_1' },
    { role: 'assistant', content: '抱歉，无法创建表，请手动操作。' },
  ];
  const noFallbackCheck = validateDDLExecution(noFallbackMessages);
  if (noFallbackCheck.warnings.length === 0) {
    checks.push('场景1-无降级SQL：应产生警告但未产生');
  }
  if (noFallbackCheck.interventionRequired) {
    checks.push('场景1-无降级SQL：不应标记 interventionRequired');
  }

  // 场景 2：DDL 被拦截 + 提供了降级 SQL → 不应报警
  const withFallbackMessages = [
    {
      role: 'assistant',
      content: '我来创建表',
      toolCalls: [{ id: 'call_2', name: 'execute_sql', arguments: { sql: 'CREATE TABLE leaves (id INT)' } }],
    },
    { role: 'tool', content: JSON.stringify({ success: false, message: 'DDL 操作不允许' }), toolCallId: 'call_2' },
    { role: 'assistant', content: '建表被拦截，请在数据源管理面板手动执行：\n```sql\nCREATE TABLE leaves (\n  id INT PRIMARY KEY AUTO_INCREMENT\n);\n```' },
  ];
  const withFallbackCheck = validateDDLExecution(withFallbackMessages);
  if (withFallbackCheck.warnings.length > 0) {
    checks.push(`场景2-有降级SQL：不应产生警告但产生了: ${withFallbackCheck.warnings.join('; ')}`);
  }
  if (!withFallbackCheck.interventionRequired) {
    checks.push('场景2-有降级SQL：应标记 interventionRequired 但未标记');
  }
  if (!withFallbackCheck.interventionReason) {
    checks.push('场景2-有降级SQL：应有 interventionReason 但为空');
  }

  // 场景 3：无 DDL 操作 → 不应报警
  const noDDLMessages = [
    {
      role: 'assistant',
      content: '我来查询数据',
      toolCalls: [{ id: 'call_3', name: 'execute_sql', arguments: { sql: 'SELECT * FROM leaves' } }],
    },
    { role: 'tool', content: JSON.stringify({ success: true, message: '查询成功' }), toolCallId: 'call_3' },
    { role: 'assistant', content: '查询完成，共 3 条记录。' },
  ];
  const noDDLCheck = validateDDLExecution(noDDLMessages);
  if (noDDLCheck.warnings.length > 0) {
    checks.push(`场景3-无DDL操作：不应产生警告但产生了: ${noDDLCheck.warnings.join('; ')}`);
  }
  if (noDDLCheck.interventionRequired) {
    checks.push('场景3-无DDL操作：不应标记 interventionRequired');
  }

  // 场景 4：DDL 执行成功 → 不应报警
  const ddlSuccessMessages = [
    {
      role: 'assistant',
      content: '我来创建表',
      toolCalls: [{ id: 'call_4', name: 'execute_sql', arguments: { sql: 'CREATE TABLE leaves (id INT)' } }],
    },
    { role: 'tool', content: JSON.stringify({ success: true, message: '执行成功' }), toolCallId: 'call_4' },
    { role: 'assistant', content: '表创建成功！' },
  ];
  const ddlSuccessCheck = validateDDLExecution(ddlSuccessMessages);
  if (ddlSuccessCheck.warnings.length > 0) {
    checks.push(`场景4-DDL成功：不应产生警告但产生了: ${ddlSuccessCheck.warnings.join('; ')}`);
  }
  if (ddlSuccessCheck.interventionRequired) {
    checks.push('场景4-DDL成功：不应标记 interventionRequired');
  }

  return evalResult('E13-DDL降级校验', checks.length === 0, checks.length === 0 ? '4 个场景全部通过' : checks.join('；'));
}

// ============================================================================
// Phase 0 止血补丁回归（E14-E20）
// ============================================================================

/** 构造 routeTo 返回固定消息的 fake ChatRouter（E4 同款模式） */
function makeFakeRouter(messages: Message[]): ChatRouter {
  return {
    routeTo: async () => ({
      run: async () => {},
      cancel: () => {},
      getMessages: () => messages,
    }),
  } as unknown as ChatRouter;
}

/** agentLoop 确认门暂停时写入的 tool 结果消息（与 agentLoop 实际 JSON 结构一致） */
const PAUSE_TOOL_MSG: Message = {
  id: 'm-pause',
  role: 'tool',
  toolCallId: 't-del',
  content: JSON.stringify({
    success: false,
    _pause: true,
    message: '⚠️ 危险操作待确认：「delete_query」。本次未执行。请向用户说明该操作的影响，等待用户回复"确认"后重新调用相同工具；用户回复"取消"则放弃该操作。',
  }),
  timestamp: 0,
};

/** E14: delegate_query —— 子智能体带未确认危险操作返回时，必须以 _pause 暂停主智能体（此前返回 success=true） */
async function evalDelegatePausePropagationQuery(): Promise<EvalResult> {
  const factory = delegateSkills['delegate:query'];
  if (!factory) return evalResult('E14-委派暂停传播(query)', false, 'delegate:query 技能未注册');

  const messages: Message[] = [
    { id: 'u1', role: 'user', content: '为页面创建查询 A', timestamp: 0 },
    {
      id: 'a1', role: 'assistant', content: '', timestamp: 0,
      toolCalls: [{ id: 't-del', name: 'delete_query', arguments: { queryId: 7 }, status: 'done' }],
    },
    PAUSE_TOOL_MSG,
  ];
  const skill = factory(STUB_CTX, makeFakeRouter(messages));
  const result = await skill.execute({ requirement: '为页面创建查询 A' }, STUB_CTX);

  const passed = result._pause === true && result.success === false && result.message.includes('等待用户确认');
  return evalResult(
    'E14-委派暂停传播(query)',
    passed,
    passed
      ? '子智能体确认门暂停被正确传播为 _pause'
      : `期望 success=false + _pause=true，实际 success=${result.success}，_pause=${String(result._pause)}`,
  );
}

/** E15: delegate_workflow —— 同上，且暂停不得被误报为"工具失败" */
async function evalDelegatePausePropagationWorkflow(): Promise<EvalResult> {
  const factory = delegateSkills['delegate:workflow'];
  if (!factory) return evalResult('E15-委派暂停传播(workflow)', false, 'delegate:workflow 技能未注册');

  const messages: Message[] = [
    { id: 'u1', role: 'user', content: '请设计流程：请假审批', timestamp: 0 },
    {
      id: 'a1', role: 'assistant', content: '', timestamp: 0,
      toolCalls: [{ id: 't-cancel', name: 'cancel_workflow', arguments: { instanceId: 9 }, status: 'done' }],
    },
    PAUSE_TOOL_MSG,
  ];
  const skill = factory(STUB_CTX, makeFakeRouter(messages));
  const result = await skill.execute({ requirement: '请假审批', task_type: 'design_workflow' }, STUB_CTX);

  const passed = result._pause === true && result.success === false && result.message.includes('等待用户确认');
  return evalResult(
    'E15-委派暂停传播(workflow)',
    passed,
    passed
      ? '暂停正确传播且未被失败扫描误报'
      : `期望暂停传播，实际 success=${result.success}，message="${result.message.slice(0, 120)}"`,
  );
}

/** E16: delegate_query —— DDL 被拦截且已提供降级 SQL 时，必须返回 _pause 让主循环硬暂停（此前只放 data，主循环不停） */
async function evalDDLInterventionPause(): Promise<EvalResult> {
  const factory = delegateSkills['delegate:query'];
  if (!factory) return evalResult('E16-DDL干预暂停', false, 'delegate:query 技能未注册');

  const messages: Message[] = [
    { id: 'u1', role: 'user', content: '为订单页创建查询 orders', timestamp: 0 },
    {
      id: 'a1', role: 'assistant', content: '我来创建表', timestamp: 0,
      toolCalls: [{ id: 't-sql', name: 'execute_sql', arguments: { sql: 'CREATE TABLE orders (id INT)' }, status: 'done' }],
    },
    { id: 'm1', role: 'tool', content: JSON.stringify({ success: false, message: 'DDL 操作不允许' }), toolCallId: 't-sql', timestamp: 0 },
    { id: 'a2', role: 'assistant', content: '建表被拦截，请在数据源管理面板手动执行：\nCREATE TABLE orders (id INT);', timestamp: 0 },
  ];
  const skill = factory(STUB_CTX, makeFakeRouter(messages));
  const result = await skill.execute({ requirement: '为订单页创建查询 orders' }, STUB_CTX);

  const data = result.data as { interventionRequired?: boolean } | undefined;
  const passed = result._pause === true && result.success === false && data?.interventionRequired === true;
  return evalResult(
    'E16-DDL干预暂停',
    passed,
    passed
      ? 'DDL 干预以 _pause 硬暂停主循环，不再依赖 prompt 劝说'
      : `期望 _pause=true + data.interventionRequired=true，实际 _pause=${String(result._pause)}，data=${JSON.stringify(data)?.slice(0, 120)}`,
  );
}

/** E17: 委派记忆切片 —— 上一轮已解决的 DDL 干预不得在后续委派中误报（修复前每次委派都会重复暂停） */
async function evalDelegationMemorySlice(): Promise<EvalResult> {
  const factory = delegateSkills['delegate:query'];
  if (!factory) return evalResult('E17-委派记忆切片', false, 'delegate:query 技能未注册');

  const messages: Message[] = [
    // 上一轮任务：DDL 被拦截，用户已完成手动操作（已解决）
    { id: 'u-old', role: 'user', content: '为旧页创建查询 legacy', timestamp: 0 },
    {
      id: 'a-old1', role: 'assistant', content: '我来创建表', timestamp: 0,
      toolCalls: [{ id: 't-old', name: 'execute_sql', arguments: { sql: 'CREATE TABLE legacy_tmp (id INT)' }, status: 'done' }],
    },
    { id: 'm-old', role: 'tool', content: JSON.stringify({ success: false, message: 'DDL 操作不允许' }), toolCallId: 't-old', timestamp: 0 },
    { id: 'a-old2', role: 'assistant', content: '请手动执行：CREATE TABLE legacy_tmp (id INT);', timestamp: 0 },
    // 当前任务：干净完成，无任何 DDL
    { id: 'u-new', role: 'user', content: '创建查询 current', timestamp: 0 },
    { id: 'a-new', role: 'assistant', content: '查询 current 已创建完成。', timestamp: 0 },
  ];
  const skill = factory(STUB_CTX, makeFakeRouter(messages));
  const result = await skill.execute({ requirement: '创建查询 current' }, STUB_CTX);

  const passed = result.success === true && result._pause !== true;
  return evalResult(
    'E17-委派记忆切片',
    passed,
    passed
      ? '历史干预不再误报，本次干净任务正常返回成功'
      : `历史 DDL 干预被误报（应只看本次任务），实际 success=${result.success}，_pause=${String(result._pause)}`,
  );
}

/** E18: 确认门收紧 —— 长句含"确认"不误放行、长句"不要…"不误取消 */
function evalConfirmationGuardTightening(): EvalResult {
  const checks: string[] = [];
  resetConfirmationGuard();

  if (consumeApproval('delete_page', { pageId: 1 }) !== 'blocked') checks.push('首次调用应 blocked');
  onUserMessage('我确认一下需求：你是要删除页面A吗？');
  if (consumeApproval('delete_page', { pageId: 1 }) !== 'blocked') checks.push('长句含"确认"不应放行（includes 兜底已删）');
  onUserMessage('不要忘了加筛选字段，另外把标题改成蓝色');
  if (!hasPending()) checks.push('长句"不要…"不应取消挂起操作（长度门生效）');
  onUserMessage('算了');
  if (hasPending()) checks.push('短句"算了"应取消挂起操作');

  // 重新登记一个挂起操作，验证短句"确认"放行一次（取消后 pending 已清空，需重新拦截登记）
  if (consumeApproval('delete_query', { queryId: 2 }) !== 'blocked') checks.push('重新登记应 blocked');
  onUserMessage('确认');
  if (consumeApproval('delete_query', { queryId: 2 }) !== 'approved') checks.push('短句"确认"应放行一次');

  resetConfirmationGuard();
  return evalResult('E18-确认门收紧', checks.length === 0, checks.length === 0 ? '误放行/误取消路径全部封死' : checks.join('；'));
}

/** E19: parseToolArguments —— 不可修复的非法 JSON 返回 null（此前静默返回 {}，工具带空参数"成功"执行） */
function evalParseToolArgumentsStrictness(): EvalResult {
  const checks: string[] = [];

  if (JSON.stringify(parseToolArguments('{"a":1}')) !== '{"a":1}') checks.push('合法 JSON 解析错误');
  const empty = parseToolArguments('');
  if (empty === null || Object.keys(empty).length !== 0) checks.push('空参数应返回 {}（无参工具）');
  if (parseToolArguments('{"broken json') !== null) checks.push('不可修复的非法 JSON 应返回 null 而非 {}');
  const repaired = parseToolArguments('{"sql":"SELECT 1\nFROM t"}');
  if (repaired === null || (repaired as { sql?: string }).sql !== 'SELECT 1\nFROM t') checks.push('字符串内裸换行应被修复');

  return evalResult('E19-参数解析严格化', checks.length === 0, checks.length === 0 ? '解析失败不再静默降级' : checks.join('；'));
}

/** 运行全部 eval */
export async function runAgentEvals(): Promise<EvalResult[]> {
  const results: EvalResult[] = [
    evalConsistencyClean(),
    evalIncidentToolDrift(),
    evalPlanDerivation(),
    evalPlanDerivationWithOrch(),
    evalConfirmationGate(),
    evalDelegateModeIsolation(),
    evalDelegateOutcomes(),
    evalContextCompaction(),
    evalDelegationMemoryBound(),
    evalPlanQueryBatching(),
    evalDDLFallbackValidation(),
    evalConfirmationGuardTightening(),
    evalParseToolArgumentsStrictness(),
  ];
  results.push(await evalDelegateFailureDetection());
  results.push(await evalStepVerifier());
  results.push(await evalFormContainerFalsePositive());
  results.push(await evalDelegatePausePropagationQuery());
  results.push(await evalDelegatePausePropagationWorkflow());
  results.push(await evalDDLInterventionPause());
  results.push(await evalDelegationMemorySlice());
  return results;
}

/** 输出到控制台并返回是否全部通过 */
export async function runAgentEvalsAndReport(): Promise<boolean> {
  const results = await runAgentEvals();
  const failed = results.filter((r) => !r.passed);
  for (const r of results) {
    const line = `${r.passed ? '✅' : '❌'} ${r.name}${r.passed ? '' : `\n   ${r.detail}`}`;
    if (r.passed) console.log(line);
    else console.error(line);
  }
  console.log(`[AgentEvals] ${results.length - failed.length}/${results.length} 通过`);
  return failed.length === 0;
}