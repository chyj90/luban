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
import { delegateSkills, buildWorkflowDelegateSystemPrompt, extractWorkflowOutcomes, validateDDLExecution, detectManualInterventionRequest } from '../skills/delegateSkills';
import * as contextWindowModule from '../../core/contextWindow';
import * as agentMemoryModule from '../agentMemory';
import { resolveSkills } from '../skillRegistry';
import { consumeApproval, onUserMessage, resetConfirmationGuard, hasPending } from '../../core/confirmationGuard';
import { buildInteliSystemPrompt } from '../../prompts/systemPrompt';
import { getComponentCatalog, getComponentSpecByName } from '@/luban-ui/componentSpecs';
import { lintQuery } from '../skills/queryLint';

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
  if (items.length !== 6) checks.push(`步骤数应为 6（表单/流程/发布/挂接/链路验证/链路自检），实际 ${items.length}`);
  const [step1, step2, step3, step4, step5, step6] = items;
  if (step1?.toolName !== 'delegate_workflow') checks.push(`步骤1 toolName 应为 delegate_workflow，实际 ${step1?.toolName}`);
  if (step1?.toolInput.task_type !== 'design_form') checks.push(`步骤1 task_type 应为 design_form，实际 ${step1?.toolInput.task_type}`);
  if (step2?.toolName !== 'delegate_workflow') checks.push(`步骤2 toolName 应为 delegate_workflow，实际 ${step2?.toolName}`);
  if (step2?.toolInput.task_type !== 'design_workflow') checks.push(`步骤2 task_type 应为 design_workflow，实际 ${step2?.toolInput.task_type}`);
  if (JSON.stringify(step2?.dependencies) !== '["1"]') checks.push(`步骤2 依赖应为 ["1"]，实际 ${JSON.stringify(step2?.dependencies)}`);
  // 业务闭环：设计后必须自动追加"发布流程"与"发起链路接入"（2026-09-14 请假管理案例）
  if (step3?.toolName !== 'delegate_workflow') checks.push(`步骤3（发布流程）toolName 应为 delegate_workflow，实际 ${step3?.toolName}`);
  if (!step3 || !/发布/.test(step3.description)) checks.push('步骤3 描述应包含"发布流程"');
  if (JSON.stringify(step3?.dependencies) !== '["2"]') checks.push(`步骤3 依赖应为 ["2"]，实际 ${JSON.stringify(step3?.dependencies)}`);
  if (step4?.toolName !== 'update_code_page') checks.push(`步骤4（发起链路接入）toolName 应为 update_code_page，实际 ${step4?.toolName}`);
  if (!step4 || !/发起链路接入|startWorkflow/.test(step4.description)) checks.push('步骤4 描述应包含"发起链路接入/startWorkflow"');
  if (JSON.stringify(step4?.dependencies) !== JSON.stringify([step3?.id])) checks.push(`步骤4 依赖应为 [${step3?.id}]，实际 ${JSON.stringify(step4?.dependencies)}`);
  // 链路验证收尾步骤（触发器预演）：完成定义是预演通过而非资源创建成功
  if (step5?.toolName !== 'rehearse_triggers') checks.push(`步骤5（链路验证）toolName 应为 rehearse_triggers，实际 ${step5?.toolName}`);
  if (!step5 || !/链路验证|预演/.test(step5.description)) checks.push('步骤5 描述应包含"链路验证/预演"');
  if (JSON.stringify(step5?.dependencies) !== JSON.stringify([step3?.id, step4?.id])) {
    checks.push(`步骤5 依赖应为 [${step3?.id},${step4?.id}]，实际 ${JSON.stringify(step5?.dependencies)}`);
  }
  // 应用链路自检收尾步骤（2026-09-18 升级）：计划必须以运行时验证结束，依赖此前全部步骤
  if (step6?.toolName !== 'app_selfcheck') checks.push(`步骤6（链路自检）toolName 应为 app_selfcheck，实际 ${step6?.toolName}`);
  if (!step6 || !/自检/.test(step6.description)) checks.push('步骤6 描述应包含"自检"');
  if (JSON.stringify(step6?.dependencies) !== JSON.stringify(['1', '2', '3', '4', '5'])) {
    checks.push(`步骤6 依赖应为 ["1","2","3","4","5"]，实际 ${JSON.stringify(step6?.dependencies)}`);
  }

  return evalResult('E3-计划自动推导(请假审批)', checks.length === 0, checks.length === 0 ? '结构完全符合预期（含闭环步骤）' : checks.join('；'));
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

/**
 * E3c: 计划自动推导——流程+编排+页面共存的排序回归（2026-09-14 请假管理案例）。
 * 编排的 workflow 节点需要已发布的流程定义 ID，执行器又是严格按步骤顺序串行的，
 * 所以编排步骤必须物理排在"发布流程"之后；wire（update_code_page）必须排在页面之后。
 */
function evalPlanDerivationOrchAfterWorkflow(): EvalResult {
  const analysis = {
    title: '创建员工管理应用',
    summary: '员工页面+请假编排+请假审批流程',
    pages: [
      {
        name: '员工管理',
        action: 'create' as const,
        queries: [
          { queryName: 'GetEmployees', purpose: '员工列表', needsNewTable: true, fields: 'id,name,department,status', filterParams: 'keyword(文本,模糊匹配)' },
        ],
        apis: [],
        orchestrations: [
          { orchName: 'OrcLeaveApply', purpose: '写入请假记录并发起审批流程' },
        ],
      },
    ],
    workflows: [
      {
        description: '员工请假审批流程',
        hasForm: true,
        formDescription: '请假表单：类型/起止日期/天数/原因',
        hasWorkflow: true,
        workflowDescription: '请假审批：≤3天直属上级，>3天加部门经理',
      },
    ],
  };
  const items = derivePlanFromAnalysis(analysis);

  const checks: string[] = [];
  // 预期 9 步：query → form → design → publish → orchestration → page → wire → rehearse → selfcheck
  if (items.length !== 9) checks.push(`步骤数应为 9，实际 ${items.length}: ${items.map(i => i.toolName).join(', ')}`);
  // 2026-09-14 回归：步骤 id 必须与清单序号一致（publish/wire 也要占数字 id），
  // 否则主智能体按 submit_analysis 清单序号标状态会命中错误步骤
  const idMismatchIdx = items.findIndex((it, idx) => it.id !== String(idx + 1));
  if (idMismatchIdx >= 0) checks.push(`步骤 id 应等于清单序号：第 ${idMismatchIdx + 1} 步的 id 是 "${items[idMismatchIdx].id}"`);
  const toolNames = items.map(i => i.toolName);
  const orchIdx = toolNames.indexOf('delegate_orchestration');
  const publishIdx = items.findIndex(i => i.description.startsWith('发布流程'));
  const pageIdx = toolNames.indexOf('create_code_page');
  const wireIdx = toolNames.findIndex((t, i) => t === 'update_code_page' && i > 0);
  if (orchIdx < 0) checks.push('缺少 delegate_orchestration 步骤');
  if (publishIdx < 0) checks.push('缺少发布流程步骤');
  if (orchIdx >= 0 && publishIdx >= 0 && orchIdx < publishIdx) {
    checks.push(`编排步骤(序号${orchIdx + 1})必须排在发布流程步骤(序号${publishIdx + 1})之后`);
  }
  if (wireIdx >= 0 && pageIdx >= 0 && wireIdx < pageIdx) {
    checks.push(`流程挂接步骤(序号${wireIdx + 1})必须排在页面创建步骤(序号${pageIdx + 1})之后`);
  }
  const orch = items[orchIdx];
  const publishId = items[publishIdx]?.id;
  if (orch && publishId && !orch.dependencies.includes(publishId)) {
    checks.push(`编排步骤应依赖发布流程步骤 ${publishId}，实际 ${JSON.stringify(orch.dependencies)}`);
  }
  const wire = items[wireIdx];
  if (wire && publishId && !wire.dependencies.includes(publishId)) {
    checks.push(`流程挂接步骤应依赖发布流程步骤 ${publishId}，实际 ${JSON.stringify(wire.dependencies)}`);
  }
  // 链路验证（触发器预演）收尾：必须存在、排在 wire 之后、依赖 publish+wire
  const rehearseIdx = toolNames.indexOf('rehearse_triggers');
  if (rehearseIdx < 0) {
    checks.push('缺少 rehearse_triggers（链路验证）步骤');
  } else if (wireIdx >= 0 && rehearseIdx < wireIdx) {
    checks.push(`链路验证步骤(序号${rehearseIdx + 1})必须排在流程挂接步骤(序号${wireIdx + 1})之后`);
  } else {
    const rehearse = items[rehearseIdx];
    const wireId = items[wireIdx]?.id;
    if (wireId && !rehearse.dependencies.includes(wireId)) {
      checks.push(`链路验证步骤应依赖流程挂接步骤 ${wireId}，实际 ${JSON.stringify(rehearse.dependencies)}`);
    }
  }

  // 应用链路自检收尾：必须存在且排在预演之后（2026-09-18 升级）
  const selfcheckIdx = toolNames.indexOf('app_selfcheck');
  if (selfcheckIdx < 0) {
    checks.push('缺少 app_selfcheck（链路自检）收尾步骤');
  } else if (rehearseIdx >= 0 && selfcheckIdx < rehearseIdx) {
    checks.push(`链路自检步骤(序号${selfcheckIdx + 1})必须排在链路验证步骤(序号${rehearseIdx + 1})之后`);
  }

  return evalResult('E3c-计划推导(编排排在流程发布后)', checks.length === 0, checks.length === 0 ? '查询→表单→流程→发布→编排→页面→挂接 顺序与依赖正确' : checks.join('；'));
}

/**
 * E3d: TOOL 型回调回归——TOOL 目标（已有 API 工具）必须与 QUERY 一样折叠进流程设计步骤，
 * 不得静默丢弃、也不得像 ORCHESTRATION 那样生成独立的"配触发器+重发布"步骤
 * （2026-09-15 契约缺口：targetType 只有 QUERY|ORCHESTRATION，TOOL 回调被两处 filter 吞掉，联动无声断链）。
 */
function evalPlanDerivationWithToolCallback(): EvalResult {
  const analysis = {
    title: '请假审批+结果通知',
    summary: '审批结果回写业务库并调用已有通知工具',
    pages: [],
    workflows: [
      {
        description: '请假审批',
        hasForm: true,
        formDescription: '请假表单：类型/起止日期/天数',
        hasWorkflow: true,
        workflowDescription: '请假审批流程',
        callbacks: [
          { on: 'APPROVED', targetType: 'QUERY' as const, targetRef: 'UpdateLeaveApproved', params: 'id←form.data.id', purpose: '置已通过' },
          { on: 'INSTANCE_COMPLETED', targetType: 'TOOL' as const, targetRef: 'SendLeaveResultNotice', params: 'instanceId←instance.id', purpose: '推送结果通知' },
        ],
      },
    ],
  };
  const items = derivePlanFromAnalysis(analysis);

  const checks: string[] = [];
  // 预期 7 步：回写查询 → 表单 → 设计(含触发器) → 发布 → 挂接 → 链路验证 → 链路自检；TOOL 不另生成步骤
  if (items.length !== 7) checks.push(`步骤数应为 7，实际 ${items.length}: ${items.map(i => i.toolName).join(', ')}`);
  const step1 = items[0];
  if (step1?.toolName !== 'delegate_query' || !step1.description.includes('UpdateLeaveApproved')) {
    checks.push('步骤1 应为回写查询 UpdateLeaveApproved 的 delegate_query 步骤');
  }
  const design = items[2];
  if (design?.toolName !== 'delegate_workflow' || design.toolInput.task_type !== 'design_workflow') {
    checks.push(`步骤3 应为流程设计步骤，实际 ${design?.toolName}/${design?.toolInput.task_type}`);
  } else {
    const req = String(design.toolInput.requirement || '');
    if (!req.includes('UpdateLeaveApproved') || !req.includes('type 填 "QUERY"')) {
      checks.push('设计步骤 requirement 缺少 QUERY 型触发器配置指引');
    }
    if (!req.includes('SendLeaveResultNotice') || !req.includes('type 填 "TOOL"')) {
      checks.push('设计步骤 requirement 缺少 TOOL 型触发器配置指引（TOOL 回调被丢弃）');
    }
    if (!req.includes('list_apis')) {
      checks.push('TOOL 型指引应要求用 list_apis 核对工具 ID');
    }
  }
  if (!design?.description.includes('on→QUERY/TOOL')) {
    checks.push(`设计步骤描述应包含"on→QUERY/TOOL"，实际 "${design?.description}"`);
  }
  const wireTriggerStep = items.find((i) => i.description.includes('配置审批结果触发器'));
  if (wireTriggerStep) {
    checks.push(`TOOL 回调不应生成独立的触发器配置步骤（那是 ORCHESTRATION 专用）：${wireTriggerStep.description}`);
  }

  return evalResult('E3d-计划推导(TOOL回调折叠)', checks.length === 0, checks.length === 0 ? 'TOOL 回调折叠进设计步骤且未被丢弃' : checks.join('；'));
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
      wasLastRunCancelled: () => false,
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

  // 2026-09-14 案例回归：编排步骤贴了发布流程的 result（无编排ID）→ 必须拦截；
  // 编排存在且名称与步骤声明一致 → 放行；名称不符 → 拦截
  setStepVerifierDeps({
    getOrchestration: async (id) => (id === 70
      ? { data: { id: 70, name: 'OrcLeaveApply' } }
      : Promise.reject(new Error('404'))),
  });
  const orchCrossStep = await verifyStepCompletion(
    'delegate_orchestration', 1,
    '创建编排 OrcLeaveApply（先插入请假记录再发起审批流程）',
    '请假审批流程发布成功，流程ID: 212，状态已发布(PUBLISHED) v1，绑定表单ID: 64',
  );
  if (orchCrossStep.verified) checks.push('编排步骤 result 无编排ID应拦截（防跨步骤贴结果）');
  const orchOk = await verifyStepCompletion(
    'delegate_orchestration', 1,
    '创建编排 OrcLeaveApply（先插入请假记录再发起审批流程）',
    '编排 OrcLeaveApply 创建成功，编排ID: 70，试运行通过',
  );
  if (!orchOk.verified) checks.push(`编排存在且名称匹配应放行，实际拦截: ${orchOk.reason}`);
  const orchNameMismatch = await verifyStepCompletion(
    'delegate_orchestration', 1,
    '创建编排 OrcOther（其他编排）',
    '编排ID: 70',
  );
  if (orchNameMismatch.verified) checks.push('编排名称与步骤声明不符应拦截');

  // 表单ID 用 = 连接的变体也应可解析（2026-09-14 案例中 "表单ID=64" 被误判为无资源 ID）
  const formEq = await verifyStepCompletion('delegate_workflow', 1, '设计请假表单', '表单创建成功，表单ID=21');
  if (!formEq.verified) checks.push(`"表单ID=21" 变体应放行，实际拦截: ${formEq.reason}`);

  // 2026-09-17 表单 71 案例回归：result 只写 "表单「XX」(ID: 71)"（裸 ID 形态），此前被
  // PROCESS_ID_PATTERNS 的裸 (ID: N) 正则误判成流程 ID → getWorkflow(71) 404 误报"流程不存在"。
  // 现在裸形态走宽松探测，按描述关键词优先按表单核验 → 放行
  const bareFormId = await verifyStepCompletion('delegate_workflow', 1, '设计请假表单', '表单「请假申请单」(ID: 21) 创建完成，字段：leaveDays(number)');
  if (!bareFormId.verified) checks.push(`裸 (ID: N) 表单形态应按表单核验放行，实际拦截: ${bareFormId.reason}`);

  // 对照：裸 ID 实际是流程（描述只提流程不提表单）→ 宽松探测按流程核验放行
  const bareProcessId = await verifyStepCompletion('delegate_workflow', 1, '设计请假审批流程', '流程创建完成（ID: 17）');
  if (!bareProcessId.verified) checks.push(`裸 (ID: N) 流程形态应按流程核验放行，实际拦截: ${bareProcessId.reason}`);

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
        // 只读用法：只传 formId 查字段，不是产出（2026-09-16 表单 67 案例：只读被误报为产出，
        // 主智能体拿从未创建的资源 ID 标记完成，被核验器拦下后无路可走）
        { id: 't4', name: 'design_form', arguments: { formId: 99 } },
      ],
    },
    { id: 'm1', role: 'tool', content: JSON.stringify({ success: true, message: '表单创建成功', data: { id: 21, name: '请假申请单' } }), toolCallId: 't1', timestamp: 0 },
    { id: 'm2', role: 'tool', content: JSON.stringify({ success: true, message: '流程创建成功', data: { id: 17, name: '请假审批流程' } }), toolCallId: 't2', timestamp: 0 },
    { id: 'm3', role: 'tool', content: JSON.stringify({ success: true, message: '流程绑定成功' }), toolCallId: 't3', timestamp: 0 },
    { id: 'm4', role: 'tool', content: JSON.stringify({ success: true, message: '表单「旧表单」(ID: 99) 已有字段：x(x, text)', data: { id: 99, name: '旧表单' } }), toolCallId: 't4', timestamp: 0 },
  ];

  const outcomes = extractWorkflowOutcomes(messages);
  const form = outcomes.find((o) => o.type === 'form');
  const wf = outcomes.find((o) => o.type === 'workflow');
  const binding = outcomes.find((o) => o.type === 'binding');
  if (!form || form.id !== 21) checks.push('应提取 form id=21');
  if (!form?.fields?.some((f) => f.key === 'leaveDays')) checks.push('form outcome 应携带字段 key leaveDays');
  if (!wf || wf.id !== 17) checks.push('应提取 workflow id=17');
  if (!binding || binding.boundFormId !== 21 || binding.boundProcessId !== 17) checks.push('应提取 binding 21↔17');
  if (outcomes.some((o) => o.type === 'form' && o.id === 99)) checks.push('design_form 只读（不传 fields）不应计为产出');

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

/**
 * E13b: 文本介入标记检测——子智能体"不尝试 DDL、直接请求人工操作"时也必须识别为介入。
 * 2026-09-14 员工管理死循环案例：主智能体委派时禁止尝试 DDL，DBA 照做（无 execute_sql 调用），
 * validateDDLExecution 探测不到 → 委派被判成功 → 主智能体文本转达后想结束回合 →
 * planPolicy 强制继续提醒顶回 → 死循环。
 */
function evalManualInterventionDetection(): EvalResult {
  const checks: string[] = [];

  // 场景 1（事故原文风格）：显式 interventionRequired 标记 + SQL 块 → 必须识别
  const incidentReport = [
    '## ⚠️ interventionRequired：leave_requests 表缺 user_id 列，需人工补列',
    '### 三、需要您在数据源管理面板手动执行的 DDL（禁止 Agent 执行）',
    '```sql',
    'ALTER TABLE leave_requests ADD COLUMN user_id INT NULL;',
    '```',
  ].join('\n');
  const incident = detectManualInterventionRequest(incidentReport);
  if (!incident.required) checks.push('场景1-显式标记：应识别为介入但未识别');
  if (incident.required && !/interventionRequired/i.test(incident.reason || '')) {
    checks.push(`场景1-显式标记：reason 应取标记行，实际: ${incident.reason}`);
  }

  // 场景 2：无显式标记，但按 DBA 契约措辞请求人工执行 SQL → 必须识别
  const contractReport = '建表被拦截，请在数据源管理面板手动执行以下 SQL：\n```sql\nCREATE TABLE leaves (id INT);\n```';
  const contract = detectManualInterventionRequest(contractReport);
  if (!contract.required) checks.push('场景2-契约措辞：应识别为介入但未识别');

  // 场景 3：普通完成汇报 → 不得误报
  const normalReport = '查询 GetEmployeeStats 创建成功（ID 131）并验证通过，共 2 个查询全部完成。';
  if (detectManualInterventionRequest(normalReport).required) {
    checks.push('场景3-正常完成：不应识别为介入');
  }

  // 场景 4：提及过去已完成的手动操作（无请求语气、无 SQL 依据）→ 不得误报
  const pastReport = '用户此前已在数据源管理面板完成建表，本次任务全部完成。';
  if (detectManualInterventionRequest(pastReport).required) {
    checks.push('场景4-历史操作提及：不应识别为介入');
  }

  // 场景 5（2026-09-17 事故原文）：按汇报纪律在【风险与残留】写否定式"无 interventionRequired"
  // → 散文子串匹配曾误判为介入请求。修复后：剔除否定式后不得误报
  const negationReport = [
    '【结论】三条审批触发器查询复核全部符合规范，无需修改；测试数据已修正补齐。',
    '【证据】employees 8 条绑定就位，守卫语义回滚验证通过（重复派发命中 0 行）。',
    '【风险与残留】- 其他：employees 中原 id=3 王强（user_id=5）未在需求清单中，保留未动。无 interventionRequired。',
  ].join('\n');
  const negation = detectManualInterventionRequest(negationReport);
  if (negation.required) {
    checks.push(`场景5-否定式残留：不应识别为介入，实际: ${negation.reason}`);
  }

  // 场景 6：状态行 JSON（协议行）为 false，但散文里另有显式标记 → JSON 为权威，不得误报
  const jsonFalseReport = [
    '## 汇报',
    '查询单已创建（表单ID: 70）。',
    '注意：interventionRequired 相关字段已在迁移中处理。',
    '{"interventionRequired": false, "reason": ""}',
  ].join('\n');
  const jsonFalse = detectManualInterventionRequest(jsonFalseReport);
  if (jsonFalse.required) {
    checks.push('场景6-状态行false：JSON 为权威信号，不应识别为介入');
  }

  // 场景 7：状态行 JSON 为 true（带围栏）→ 必须识别介入，reason 取 JSON 的 reason
  const jsonTrueReport = [
    '## 汇报',
    '需要用户手动操作：请在数据源管理面板执行以下 DDL。',
    '```json',
    '{"interventionRequired": true, "reason": "leave_requests 表缺 user_id 列，需手动补列"}',
    '```',
  ].join('\n');
  const jsonTrue = detectManualInterventionRequest(jsonTrueReport);
  if (!jsonTrue.required) {
    checks.push('场景7-状态行true：应识别为介入但未识别');
  }
  if (jsonTrue.required && jsonTrue.reason !== 'leave_requests 表缺 user_id 列，需手动补列') {
    checks.push(`场景7-状态行true：reason 应取 JSON 的 reason，实际: ${jsonTrue.reason}`);
  }

  return evalResult('E13b-文本介入检测', checks.length === 0, checks.length === 0 ? '显式标记/契约措辞/状态行JSON可识别，否定式残留/正常完成/历史提及/状态行false不误报' : checks.join('；'));
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
      wasLastRunCancelled: () => false,
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

/** E20: 大屏能力知识可达性 —— setPalette/setDensity/画布参数必须被 agent 实际看到（常驻提示词 + 工具 schema + 按需 spec 三层） */
async function evalScreenCapabilityReachability(): Promise<EvalResult> {
  const problems: string[] = [];
  const execution = buildInteliSystemPrompt(1, 1, 'demo', [{ id: 1, name: 'demo' }], 'execution');
  for (const kw of ['setPalette', 'setDensity', 'decor.', '禁止手写覆盖']) {
    if (!execution.includes(kw)) problems.push(`执行阶段系统提示词缺少 "${kw}"`);
  }
  const analysis = buildInteliSystemPrompt(1, 1, 'demo', [{ id: 1, name: 'demo' }], 'analysis');
  for (const kw of ['画布尺寸', 'canvasWidth', '超宽', 'setDensity']) {
    if (!analysis.includes(kw)) problems.push(`分析阶段系统提示词缺少 "${kw}"`);
  }
  const scaffoldSkills = resolveSkills(['code:scaffold'], STUB_CTX);
  const scaffoldParams = ((scaffoldSkills[0]?.parameters as { properties?: Record<string, unknown> })?.properties) || {};
  for (const kw of ['primaryColor', 'density', 'canvasWidth', 'canvasHeight']) {
    if (!scaffoldParams[kw]) problems.push(`create_page_scaffold 参数 schema 缺少 "${kw}"`);
  }
  const catalog = getComponentCatalog();
  if (catalog.includes('ScreenDecor')) {
    const decorSpec = getComponentSpecByName(['ScreenDecor']);
    for (const kw of ['setPalette', 'setDensity', 'screenScaler', 'decor.panel']) {
      if (!decorSpec.includes(kw)) problems.push(`ScreenDecor spec 缺少 "${kw}" 用法说明`);
    }
  } else {
    // node 环境 import.meta.glob 不可用（浏览器打包正常），回退读源文件校验按需层
    try {
      // 动态 import 规避应用包对 node 内置模块的解析（本评测仅 agent:check node 环境执行到此处）
      const fs = (await import('node:fs' as unknown as string)) as unknown as { readFileSync: (p: URL) => string };
      const specPath = new URL('../../../luban-ui/components/screen-decor.spec.ts', import.meta.url);
      const specSrc = fs.readFileSync(specPath);
      for (const kw of ['setPalette', 'setDensity', 'screenScaler', 'decor.panel']) {
        if (!specSrc.includes(kw)) problems.push(`ScreenDecor spec 缺少 "${kw}" 用法说明`);
      }
    } catch {
      problems.push('组件目录中不可见 ScreenDecor 且无法回退源文件校验（按需层入口断了）');
    }
  }

  return evalResult(
    'E20-大屏能力知识可达性',
    problems.length === 0,
    problems.length === 0 ? '常驻提示词/工具 schema/按需 spec 三层全部在位' : problems.join('；'),
  );
}

/** 运行全部 eval */
/** E21: 委派取消感知 —— 用户中止时 delegate 工具必须返回结构化取消结果，
 *  不得把半成品记成"成功完成"，也不得保存截断的委派记忆（中止→继续链路治理） */
async function evalDelegateCancellation(): Promise<EvalResult> {
  const factory = delegateSkills['delegate:query'];
  if (!factory) return evalResult('E21-委派取消感知', false, 'delegate:query 技能未注册');

  // 子会话已执行 create_query（部分产出是事实），随后整个任务被用户中止
  const messages: Message[] = [
    { id: 'u1', role: 'user', content: '创建查询 partial', timestamp: 0 },
    {
      id: 'a1', role: 'assistant', content: '创建查询', timestamp: 0,
      toolCalls: [{ id: 't1', name: 'create_query', arguments: { name: 'PartialQuery' }, status: 'done' }],
    },
    {
      id: 'm1', role: 'tool', toolCallId: 't1', timestamp: 0,
      content: JSON.stringify({ success: true, message: '创建成功', data: { id: 66, name: 'PartialQuery' } }),
    },
  ];
  agentMemoryModule.clearAppMemory(Number(STUB_CTX.applicationId));
  const cancelledRouter = {
    routeTo: async () => ({
      run: async () => {},
      cancel: () => {},
      getMessages: () => messages,
      wasLastRunCancelled: () => true,
    }),
  } as unknown as ChatRouter;

  const skill = factory(STUB_CTX, cancelledRouter);
  const result: ToolExecuteResult = await skill.execute({ requirement: '创建查询 partial' }, STUB_CTX);

  const data = result.data as { cancelled?: boolean; partialOutcomes?: unknown[] } | undefined;
  const memoryCount = agentMemoryModule.getAgentMemory(Number(STUB_CTX.applicationId), 'data-assistant').length;
  const checks: string[] = [];
  if (result.success !== false) checks.push('取消的委派必须返回 success=false（半成品不是成功）');
  if (data?.cancelled !== true) checks.push('data.cancelled 应为 true');
  if (!Array.isArray(data?.partialOutcomes) || data.partialOutcomes.length === 0) checks.push('partialOutcomes 应携带中止前的部分产出');
  if (memoryCount !== 0) checks.push(`截断的子会话记忆不应被保存（当前 ${memoryCount} 条）`);
  if (result._pause === true) checks.push('取消不是挂起，不应携带 _pause');

  return evalResult('E21-委派取消感知', checks.length === 0, checks.length === 0 ? '中止委派返回结构化取消结果且不污染委派记忆' : checks.join('；'));
}

/** E22: 查询静态检查的业务绑定豁免 —— 2026-09-17 员工管理案例：
 *  管理端写查询绑定业务归属用户（InsertEmployee 的 userId 参数）被身份检查误伤，
 *  DBA 被迫改名 empUserId 规避。规范机制：参数 description 标注 [业务绑定] 且仅
 *  INSERT/UPDATE 的顶层 WHERE 之外使用时豁免；SELECT / WHERE 中的身份用法仍必须拦截 */
function evalQueryLintBusinessBinding(): EvalResult {
  const checks: string[] = [];

  const insertBody = "INSERT INTO employees (user_id, employee_no) VALUES ({{ this.params.userId }}, {{ this.params.employee_no }})";
  const bindingParam = { name: 'userId', description: '平台用户ID [业务绑定]，管理端选择的员工归属' };

  // 1. INSERT + [业务绑定] 标注 → 放行
  const exempt = lintQuery({ name: 'InsertEmployee', body: insertBody, params: [bindingParam] });
  if (exempt.errors.length > 0) checks.push(`标注 [业务绑定] 的 INSERT 写参数应放行，实际: ${exempt.errors[0]}`);

  // 2. 同样 SQL 不标注 → 拦截，且错误信息教逃生通道
  const blocked = lintQuery({ name: 'InsertEmployee', body: insertBody, params: [{ name: 'userId', description: '平台用户ID' }] });
  if (blocked.errors.length === 0) checks.push('未标注 [业务绑定] 的 this.params.userId 仍应拦截');
  if (blocked.errors.length > 0 && !blocked.errors[0].includes('[业务绑定]')) {
    checks.push('拦截信息应提示 [业务绑定] 逃生通道');
  }

  // 3. UPDATE SET 段使用标注参数 → 放行
  const updateSet = "UPDATE employees <set><if test=\"this.params.userId != null\">user_id = {{ this.params.userId }},</if></set> WHERE id = {{ this.params.id }}";
  const updateExempt = lintQuery({ name: 'UpdateEmployee', body: updateSet, params: [bindingParam] });
  if (updateExempt.errors.length > 0) checks.push(`UPDATE SET 段的标注参数应放行，实际: ${updateExempt.errors[0]}`);

  // 4. 标注参数出现在 WHERE 段（当身份过滤用）→ 仍拦截
  const updateWhere = "UPDATE employees SET status = '离职' WHERE user_id = {{ this.params.userId }}";
  const whereBlocked = lintQuery({ name: 'ResignByUser', body: updateWhere, params: [bindingParam] });
  if (whereBlocked.errors.length === 0) checks.push('标注参数出现在 WHERE 中应仍拦截（身份过滤风险不变）');

  // 5. SELECT 中即使用标注参数 → 仍拦截（豁免仅限 INSERT/UPDATE）
  const selectBlocked = lintQuery({ name: 'GetEmployeeList', body: 'SELECT * FROM employees WHERE user_id = {{ this.params.userId }}', params: [bindingParam] });
  if (selectBlocked.errors.length === 0) checks.push('SELECT 中的 this.params.userId 应仍拦截（豁免仅限写查询）');

  // 6. 原有身份域检查不受影响：名字表明"我的XX"但缺 this.auth → 拦截
  const myScoped = lintQuery({ name: 'MyLeaveRecords', body: 'SELECT * FROM leave_records WHERE user_id = 1' });
  if (myScoped.errors.length === 0) checks.push('身份域查询缺 this.auth 过滤应仍拦截');

  // 7. 无 params 输入（旧调用方/存量查询 lint_query）→ 行为与原来一致
  const legacy = lintQuery({ name: 'InsertEmployee', body: insertBody });
  if (legacy.errors.length === 0) checks.push('不传 params 时应维持原拦截行为');

  return evalResult('E22-查询静态检查业务绑定豁免', checks.length === 0, checks.length === 0 ? '豁免/拦截边界全部正确（写查询+标注+WHERE 之外）' : checks.join('；'));
}

export async function runAgentEvals(): Promise<EvalResult[]> {
  const results: EvalResult[] = [
    evalConsistencyClean(),
    evalIncidentToolDrift(),
    evalPlanDerivation(),
    evalPlanDerivationWithOrch(),
    evalPlanDerivationOrchAfterWorkflow(),
    evalPlanDerivationWithToolCallback(),
    evalConfirmationGate(),
    evalDelegateModeIsolation(),
    evalDelegateOutcomes(),
    evalContextCompaction(),
    evalDelegationMemoryBound(),
    evalPlanQueryBatching(),
    evalDDLFallbackValidation(),
    evalManualInterventionDetection(),
    evalConfirmationGuardTightening(),
    evalParseToolArgumentsStrictness(),
    evalQueryLintBusinessBinding(),
  ];
  results.push(await evalDelegateFailureDetection());
  results.push(await evalStepVerifier());
  results.push(await evalFormContainerFalsePositive());
  results.push(await evalDelegatePausePropagationQuery());
  results.push(await evalDelegatePausePropagationWorkflow());
  results.push(await evalDDLInterventionPause());
  results.push(await evalDelegationMemorySlice());
  results.push(await evalScreenCapabilityReachability());
  results.push(await evalDelegateCancellation());
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