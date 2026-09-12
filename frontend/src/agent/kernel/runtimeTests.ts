/**
 * 事件驱动 Runtime 回放测试（Phase 2.2）
 *
 * 脚本化 LLM 驱动真实 createKernelRuntime，验证：
 * - 普通回合的事件流与状态折叠正确（K7）
 * - 确认门挂起 → confirm 后内核精确重执行同一调用（K8，取代"模型重发+正则放行"）
 * - cancel 恢复：工具不执行、占位结果被改写、模型收尾（K9）
 * - 干预挂起 → complete(note) 恢复继续（K10）
 * - 坏参数反馈（K11，与 E20 同场景对照旧循环）
 */
import type { Plan, ToolDefinition, ToolExecuteResult } from '@/types/agent';
import type { LLMStreamChunk } from '../core/llmClient';
import type { SessionState } from './session';
import { createKernelRuntime, type KernelRuntime } from './runtime';
import { createPlanPolicy } from './planPolicy';
import type { PlanStorePort } from './policy';
import { runDelegation } from './delegation';

export interface RuntimeTestResult {
  name: string;
  passed: boolean;
  detail: string;
}

function result(name: string, checks: string[]): RuntimeTestResult {
  return { name, passed: checks.length === 0, detail: checks.length === 0 ? '通过' : checks.join('；') };
}

interface ScriptedTurn {
  content?: string;
  /** 覆盖本回合所有工具调用的原始参数串（构造坏 JSON） */
  rawArguments?: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
}

function scriptedLLM(turns: ScriptedTurn[]): () => AsyncGenerator<LLMStreamChunk> {
  let i = 0;
  return async function* (): AsyncGenerator<LLMStreamChunk> {
    const turn = turns[i] || { content: '（脚本已耗尽）' };
    i++;
    if (turn.content) yield { type: 'content', content: turn.content };
    for (const tc of turn.toolCalls || []) {
      yield {
        type: 'tool_call',
        toolCall: { id: `call-${i}`, function: { name: tc.name, arguments: turn.rawArguments ?? JSON.stringify(tc.arguments) } },
      };
    }
    yield { type: 'done' };
  };
}

function plainTool(name: string, execute: (args: Record<string, unknown>) => Promise<ToolExecuteResult>): ToolDefinition {
  return { name, category: 'query', description: name, parameters: {}, execute };
}

function makeRuntime(tools: ToolDefinition[], turns: ScriptedTurn[]): { rt: KernelRuntime; events: string[] } {
  const events: string[] = [];
  const rt = createKernelRuntime({
    model: 'test-model',
    systemPrompt: 'test-system',
    tools,
    llmStream: scriptedLLM(turns),
    onEvent: (e) => events.push(e.type),
  });
  return { rt, events };
}

/** K7: 普通回合 —— 工具执行 + 模型收尾，事件流与状态正确 */
async function testNormalTurnReplay(): Promise<RuntimeTestResult> {
  const checks: string[] = [];
  const { rt, events } = makeRuntime(
    [plainTool('list_queries', async () => ({ success: true, message: '共 3 条查询' }))],
    [
      { toolCalls: [{ name: 'list_queries', arguments: {} }] },
      { content: '查询完成，共 3 条。' },
    ],
  );

  const r = await rt.runTurn({ kind: 'user-message', text: '列出所有查询' });

  if (r.suspended || r.cancelled) checks.push('普通回合不应挂起/取消');
  if (r.state.status !== 'idle') checks.push(`结束后应 idle，实际 ${r.state.status}`);
  const turn = r.state.turns[0];
  if (turn?.outcome !== 'completed' || turn.response !== '查询完成，共 3 条。') checks.push('回合 outcome/response 错误');
  if (turn?.toolCalls[0]?.status !== 'completed' || turn?.toolCalls[0]?.result?.ok !== true) checks.push('工具结果未记录');
  if (!events.includes('turn.started') || !events.includes('tool.call.finished') || !events.includes('turn.completed')) {
    checks.push(`事件流不完整: ${events.join(',')}`);
  }
  const toolMsg = r.conversationMessages.find((m) => m.role === 'tool');
  if (!toolMsg || !toolMsg.content.includes('共 3 条查询')) checks.push('工具结果应写入对话');
  return result('K7-Runtime普通回合', checks);
}

/** K8: 确认门挂起 → confirm → 内核精确重执行同一 callId/args */
async function testConfirmResumeReplay(): Promise<RuntimeTestResult> {
  const checks: string[] = [];
  const executed: Array<Record<string, unknown>> = [];
  const delTool: ToolDefinition = {
    name: 'delete_query', category: 'query', description: '删除查询', parameters: {},
    requiresConfirmation: true,
    execute: async (args) => { executed.push(args); return { success: true, message: '已删除 (id: 7)' }; },
  };
  const { rt } = makeRuntime(
    [delTool],
    [
      { toolCalls: [{ name: 'delete_query', arguments: { queryId: 7 } }] },
      { content: '好的，已为你删除查询 7。' },
    ],
  );

  const r1 = await rt.runTurn({ kind: 'user-message', text: '删除查询 7' });
  if (!r1.suspended) checks.push('危险操作应挂起');
  if (executed.length !== 0) checks.push('未确认时工具不应执行');
  const pending = r1.state.pendingInput;
  if (pending?.kind !== 'danger-confirm' || pending.args.queryId !== 7 || !pending.callId) {
    checks.push(`挂起请求应携带 callId+args，实际 ${JSON.stringify(pending)}`);
  }

  const r2 = await rt.runTurn({ kind: 'confirm' });
  if (r2.suspended) checks.push('confirm 后不应再挂起');
  if (executed.length !== 1 || executed[0].queryId !== 7) {
    checks.push(`内核应精确重执行一次且参数一致，实际 executed=${JSON.stringify(executed)}`);
  }
  if (r2.state.status !== 'idle' || r2.state.pendingInput !== null) checks.push('恢复完成后应 idle 且清空挂起');
  if (r2.state.turns[0].toolCalls[0].callId !== r2.state.turns[1].toolCalls[0].callId) {
    checks.push('两次执行应共享同一 callId');
  }
  const toolMsg = r2.conversationMessages.find((m) => m.role === 'tool');
  if (!toolMsg || toolMsg.content.includes('_pause') || !toolMsg.content.includes('已删除')) {
    checks.push('占位暂停结果应被改写为真实执行结果');
  }
  return result('K8-Runtime确认门恢复执行', checks);
}

/** K9: cancel 恢复 —— 工具不执行，占位结果改写为取消，模型收尾 */
async function testCancelResumeReplay(): Promise<RuntimeTestResult> {
  const checks: string[] = [];
  let executed = 0;
  const delTool: ToolDefinition = {
    name: 'delete_page', category: 'page', description: '删除页面', parameters: {},
    requiresConfirmation: true,
    execute: async () => { executed++; return { success: true, message: '已删除' }; },
  };
  const { rt } = makeRuntime(
    [delTool],
    [
      { toolCalls: [{ name: 'delete_page', arguments: { pageId: 3 } }] },
      { content: '好的，已取消删除操作。' },
    ],
  );

  const r1 = await rt.runTurn({ kind: 'user-message', text: '删除页面3' });
  if (!r1.suspended) checks.push('危险操作应挂起');

  const r2 = await rt.runTurn({ kind: 'cancel' });
  if (executed !== 0) checks.push('cancel 后工具不应执行');
  const toolMsg = r2.conversationMessages.find((m) => m.role === 'tool');
  if (!toolMsg || !toolMsg.content.includes('用户已取消')) checks.push('占位结果应改写为取消说明');
  if (r2.state.status !== 'idle') checks.push('取消流程结束后应 idle');
  const lastContent = r2.state.turns[1]?.content;
  if (lastContent !== '好的，已取消删除操作。') checks.push(`模型收尾内容错误: "${lastContent}"`);
  return result('K9-Runtime取消恢复', checks);
}

/** K10: 干预挂起 → complete(note) 恢复继续 */
async function testUserActionResumeReplay(): Promise<RuntimeTestResult> {
  const checks: string[] = [];
  const delegateTool = plainTool('delegate_query', async () => ({
    success: false,
    _pause: true,
    message: '需要用户手动操作',
    data: { interventionRequired: true, interventionReason: 'DDL 被拦截，已降级生成手动 SQL' },
  }));
  const { rt } = makeRuntime(
    [delegateTool],
    [
      { toolCalls: [{ name: 'delegate_query', arguments: { requirement: '建订单查询' } }] },
      { content: '表已建好，继续创建查询。' },
    ],
  );

  const r1 = await rt.runTurn({ kind: 'user-message', text: '创建订单查询' });
  if (!r1.suspended) checks.push('干预应挂起');
  if (r1.state.pendingInput?.kind !== 'user-action' || r1.state.pendingInput.reason !== 'DDL 被拦截，已降级生成手动 SQL') {
    checks.push(`干预原因应从结构化 data 提取，实际 ${JSON.stringify(r1.state.pendingInput)}`);
  }

  const r2 = await rt.runTurn({ kind: 'complete', note: '已在数据源面板建表' });
  if (r2.suspended || r2.state.status !== 'idle') checks.push('complete 后应正常完成');
  const sysMsg = r2.conversationMessages.find((m) => m.role === 'system' && m.content.includes('已在数据源面板建表'));
  if (!sysMsg) checks.push('complete 的 note 应注入对话上下文');
  return result('K10-Runtime干预恢复', checks);
}

/** K11: 坏参数反馈 —— 解析失败不执行、错误回传模型、下一轮重试成功 */
async function testParseFailureFeedbackReplay(): Promise<RuntimeTestResult> {
  const checks: string[] = [];
  let executed = 0;
  const { rt } = makeRuntime(
    [plainTool('list_queries', async () => { executed++; return { success: true, message: 'ok' }; })],
    [
      { toolCalls: [{ name: 'list_queries', arguments: {} }], rawArguments: '{"broken' },
      { toolCalls: [{ name: 'list_queries', arguments: {} }] },
      { content: '完成。' },
    ],
  );

  const r = await rt.runTurn({ kind: 'user-message', text: '列出查询' });
  if (executed !== 1) checks.push(`坏参数轮不应执行、重试轮应执行一次，实际 ${executed} 次`);
  if (!r.conversationMessages.some((m) => m.role === 'tool' && m.content.includes('参数不是合法 JSON'))) {
    checks.push('解析错误应作为工具结果反馈给模型');
  }
  if (r.state.status !== 'idle') checks.push('回合应正常完成');
  return result('K11-Runtime坏参数反馈', checks);
}

// ============================================================================
// P2.3：策略层 + 结构化委派（K12-K16）
// ============================================================================

interface TestStore extends PlanStorePort {
  confirmed: string[];
  updates: Array<{ id: string; updates: Partial<Plan> }>;
}

function makeStore(plans: Plan[]): TestStore {
  const store: TestStore = {
    confirmed: [],
    updates: [],
    getPlans: () => plans,
    confirmPlan: (id) => store.confirmed.push(id),
    updatePlan: (id, updates) => store.updates.push({ id, updates }),
  };
  return store;
}

function makePlan(partial: Partial<Plan>): Plan {
  return {
    id: 'plan-1', agentId: 'main-agent', agentName: '主智能体', agentIcon: '',
    steps: [], createdAt: 0, status: 'draft',
    ...partial,
  };
}

/** K12: planPolicy 完整流 —— submit_analysis → plan-confirm 挂起 → confirm 恢复（策略确认计划） */
async function testPlanConfirmFlow(): Promise<RuntimeTestResult> {
  const checks: string[] = [];
  const plan = makePlan({ steps: [{ id: 's1', description: '创建查询 orders', status: 'pending', order: 0 }] });
  const store = makeStore([plan]);
  const events: string[] = [];
  const rt2 = createKernelRuntime({
    model: 'test-model', systemPrompt: 'sys',
    tools: [plainTool('submit_analysis', async () => ({ success: true, message: '分析已提交' }))],
    policy: createPlanPolicy(store),
    llmStream: scriptedLLM([
      { toolCalls: [{ name: 'submit_analysis', arguments: {} }] },
      { content: '计划已确认，开始执行。' },
    ]),
    onEvent: (e) => events.push(e.type),
  });

  const r1 = await rt2.runTurn({ kind: 'user-message', text: '做一个订单页' });
  if (!r1.suspended) checks.push('submit_analysis 成功后应挂起等待计划确认');
  if (r1.state.pendingInput?.kind !== 'plan-confirm' || r1.state.pendingInput.planId !== 'plan-1') {
    checks.push(`应挂起 plan-confirm 且携带计划 ID，实际 ${JSON.stringify(r1.state.pendingInput)}`);
  }
  if (store.confirmed.length !== 0) checks.push('挂起时不应提前确认计划');

  const r2 = await rt2.runTurn({ kind: 'confirm' });
  if (!store.confirmed.includes('plan-1')) checks.push('confirm 恢复应触发 store.confirmPlan');
  if (!r2.conversationMessages.some((m) => m.role === 'system' && m.content.includes('计划已确认'))) {
    checks.push('确认后应注入计划已确认的 system 指令');
  }
  if (r2.suspended || r2.state.status !== 'idle') checks.push('确认后回合应正常完成');
  return result('K12-计划确认流', checks);
}

/** K13: planPolicy.filterTools —— plan-confirm 挂起期间屏蔽校验类工具；
 *  submit_analysis 必须放行（挂起期间用户修改需求时，模型要能重新提交分析生成新计划） */
function testPlanConfirmToolFilter(): RuntimeTestResult {
  const checks: string[] = [];
  const policy = createPlanPolicy(makeStore([]));
  const state: SessionState = {
    status: 'suspended',
    turns: [],
    pendingInput: { kind: 'plan-confirm', planId: 'plan-1' },
    activeTurnId: 't',
    lastError: null,
    eventCount: 0,
  };
  const tools = ['submit_analysis', 'validate_plan', 'report_user_action_done', 'list_queries', 'update_plan_item']
    .map((name) => plainTool(name, async () => ({ success: true, message: 'ok' })));
  const filtered = policy.filterTools!(state, tools).map((t) => t.name);
  if (filtered.includes('validate_plan') || filtered.includes('report_user_action_done')) {
    checks.push(`挂起期间应屏蔽校验类工具，实际 ${filtered.join(',')}`);
  }
  if (!filtered.includes('submit_analysis')) {
    checks.push('submit_analysis 不应被屏蔽——挂起期间需求变更需重新提交分析生成新计划');
  }
  if (!filtered.includes('list_queries') || !filtered.includes('update_plan_item')) {
    checks.push('不应误伤正常工具');
  }
  if (policy.filterTools!({ ...state, status: 'idle', pendingInput: null }, tools).length !== tools.length) {
    checks.push('非挂起状态不应过滤工具');
  }
  return result('K13-计划确认工具过滤', checks);
}

/** K18: plan-confirm 挂起期间收到自由文本（需求修改/闲聊）且模型纯文本回复 → 必须重新挂起，
 *  保证确认横幅不消失（否则用户只能退化成聊天文字确认） */
async function testPlanConfirmFreeTextResuspend(): Promise<RuntimeTestResult> {
  const checks: string[] = [];
  const plan = makePlan({ steps: [{ id: 's1', description: '创建查询 orders', status: 'pending', order: 0 }] });
  const store = makeStore([plan]);
  const rt = createKernelRuntime({
    model: 'test-model', systemPrompt: 'sys',
    tools: [plainTool('submit_analysis', async () => ({ success: true, message: '分析已提交' }))],
    policy: createPlanPolicy(store),
    llmStream: scriptedLLM([
      { toolCalls: [{ name: 'submit_analysis', arguments: {} }] },
      { content: '好的，我理解您想把地图放到中间，请确认调整后的计划。' },
    ]),
  });

  const r1 = await rt.runTurn({ kind: 'user-message', text: '做一个订单页' });
  if (!r1.suspended || r1.state.pendingInput?.kind !== 'plan-confirm') {
    checks.push('前置条件：submit_analysis 后应挂起 plan-confirm');
    return result('K18-挂起期自由文本重新挂起', checks);
  }

  // 用户没点按钮，而是发了需求修改；模型纯文本回复（无工具调用）
  const r2 = await rt.runTurn({ kind: 'user-message', text: '地图放在屏幕中间' });
  if (!r2.suspended) checks.push('纯文本回复未处理挂起事项，应重新挂起（保留确认横幅）');
  if (r2.state.pendingInput?.kind !== 'plan-confirm' || r2.state.pendingInput.planId !== 'plan-1') {
    checks.push(`重新挂起应保留原 plan-confirm 请求，实际 ${JSON.stringify(r2.state.pendingInput)}`);
  }
  if (!r2.conversationMessages.some((m) => m.role === 'system' && m.content.includes('submit_analysis'))) {
    checks.push('plan-confirm 挂起期的自由文本应注入需求修改的处理指引（重新 submit_analysis）');
  }
  return result('K18-挂起期自由文本重新挂起', checks);
}

/** K19: 聊天文本确认路径——模型自行调用 confirm_plan 时，必须通过 toolEffect 切换执行阶段 system prompt
 *  （按钮路径走 onResume，此路径此前完全丢失执行规则/设计规范） */
async function testChatConfirmPromptSwitch(): Promise<RuntimeTestResult> {
  const checks: string[] = [];
  const plan = makePlan({ steps: [{ id: 's1', description: '创建查询 orders', status: 'pending', order: 0 }] });
  const store = makeStore([plan]);
  const rt = createKernelRuntime({
    model: 'test-model', systemPrompt: 'ANALYSIS-PROMPT',
    tools: [
      plainTool('submit_analysis', async () => ({ success: true, message: '分析已提交' })),
      plainTool('confirm_plan', async () => ({ success: true, message: '计划已确认，开始执行' })),
    ],
    policy: createPlanPolicy(store, { buildExecutionPrompt: (id) => 'EXEC-PROMPT-' + id }),
    llmStream: scriptedLLM([
      { toolCalls: [{ name: 'submit_analysis', arguments: {} }] },
      { toolCalls: [{ name: 'confirm_plan', arguments: { plan_id: 'plan-1', action: 'confirm' } }] },
      { content: '开始执行步骤 1。' },
    ]),
  });

  await rt.runTurn({ kind: 'user-message', text: '做一个订单页' });
  const r2 = await rt.runTurn({ kind: 'user-message', text: '开始' });

  const sys = r2.conversationMessages.find((m) => m.role === 'system');
  if (!sys || !sys.content.includes('EXEC-PROMPT-plan-1')) {
    checks.push('confirm_plan 工具成功后应切换为执行阶段 system prompt（toolEffect）');
  }
  if (!r2.conversationMessages.some((m) => m.role === 'system' && m.content.includes('计划已确认'))) {
    checks.push('应注入"计划已确认，已切换到执行阶段"的 system 指令');
  }
  return result('K19-聊天确认切换执行prompt', checks);
}

/** K14: beforeComplete —— 计划有未完成步骤时拦截退出；达到上限后放行 */
async function testCompletionInterception(): Promise<RuntimeTestResult> {
  const checks: string[] = [];
  // 场景 1：有未完成步骤 → 注入强制继续，模型补做后完成
  const plan = makePlan({ status: 'executing', steps: [{ id: 's1', description: '创建查询 orders', status: 'pending', order: 0 }] });
  const store = makeStore([plan]);
  const rt = createKernelRuntime({
    model: 'test-model', systemPrompt: 'sys',
    tools: [plainTool('update_plan_item', async () => {
      plan.steps[0].status = 'done';
      return { success: true, message: '已标记完成' };
    })],
    policy: createPlanPolicy(store),
    llmStream: scriptedLLM([
      { content: '我先汇报一下进度。' },
      { toolCalls: [{ name: 'update_plan_item', arguments: { stepId: 's1', status: 'done' } }] },
      { content: '全部步骤已完成。' },
    ]),
  });
  const r = await rt.runTurn({ kind: 'user-message', text: '执行计划' });
  if (!r.conversationMessages.some((m) => m.role === 'system' && m.content.includes('未完成的步骤'))) {
    checks.push('未完成步骤应触发强制继续注入');
  }
  if (r.state.status !== 'idle') checks.push('补做完成后应正常结束');

  // 场景 2：模型连续空转 → 注入 5 次后放行完成
  const plan2 = makePlan({ status: 'executing', steps: [{ id: 's1', description: '永远不做', status: 'pending', order: 0 }] });
  const rt2 = createKernelRuntime({
    model: 'test-model', systemPrompt: 'sys',
    tools: [],
    policy: createPlanPolicy(makeStore([plan2])),
    llmStream: scriptedLLM([
      { content: '1' }, { content: '2' }, { content: '3' }, { content: '4' },
      { content: '5' }, { content: '6' }, { content: '7' },
    ]),
  });
  const r2 = await rt2.runTurn({ kind: 'user-message', text: '执行' });
  const injected = r2.conversationMessages.filter((m) => m.role === 'system' && m.content.includes('未完成的步骤')).length;
  if (injected !== 5) checks.push(`注入应恰好 5 次后放行，实际 ${injected} 次`);
  if (r2.state.status !== 'idle') checks.push('达到上限后应放行完成');
  return result('K14-完成拦截与上限', checks);
}

/** K15: 结构化委派 —— 信封确定性注入 + outcomes 从事件账本收集 */
async function testDelegationCompleted(): Promise<RuntimeTestResult> {
  const checks: string[] = [];
  const r = await runDelegation({
    childSystemPrompt: '你是流程设计助手。',
    childTools: [plainTool('design_form', async () => ({
      success: true,
      message: '表单已创建',
      data: { outcomes: [{ type: 'form', id: 21, name: '请假表', fields: [{ key: 'days' }] }] },
    }))],
    envelope: {
      taskType: 'design_form',
      task: '设计请假表单',
      params: { name: '请假表' },
      callerContext: { userId: 42, userName: '张三' },
    },
    llmStream: scriptedLLM([
      { toolCalls: [{ name: 'design_form', arguments: { name: '请假表' } }] },
      { content: '表单创建完成。' },
    ]),
  });

  if (r.status !== 'completed') checks.push(`委派应完成，实际 ${r.status}`);
  if (r.outcomes.length !== 1 || r.outcomes[0].id !== 21 || r.outcomes[0].type !== 'form') {
    checks.push(`产出应从结构化 data.outcomes 收集，实际 ${JSON.stringify(r.outcomes)}`);
  }
  const sysMsg = r.messages.find((m) => m.role === 'system');
  if (!sysMsg || !sysMsg.content.includes('张三') || !sysMsg.content.includes('设计请假表单')) {
    checks.push('信封（调用方上下文+任务）应确定性注入子会话 system prompt');
  }
  if (r.response !== '表单创建完成。') checks.push('子会话最终回复应返回');
  return result('K15-结构化委派完成', checks);
}

/** K16: 委派挂起传播 —— 子会话确认门挂起以结构化状态向上返回（不再被误报为失败） */
async function testDelegationSuspended(): Promise<RuntimeTestResult> {
  const checks: string[] = [];
  let executed = 0;
  const delTool: ToolDefinition = {
    name: 'delete_form', category: 'workflow', description: '删除表单', parameters: {},
    requiresConfirmation: true,
    execute: async () => { executed++; return { success: true, message: '已删除' }; },
  };
  const r = await runDelegation({
    childSystemPrompt: '你是流程设计助手。',
    childTools: [delTool],
    envelope: { task: '删除旧表单' },
    llmStream: scriptedLLM([
      { toolCalls: [{ name: 'delete_form', arguments: { formId: 5 } }] },
      { content: '已删除。' },
    ]),
  });

  if (r.status !== 'suspended') checks.push(`子会话挂起应向上传播，实际 ${r.status}`);
  if (r.pendingInput?.kind !== 'danger-confirm' || r.pendingInput.toolName !== 'delete_form') {
    checks.push(`应携带子会话的 danger-confirm 请求，实际 ${JSON.stringify(r.pendingInput)}`);
  }
  if (executed !== 0) checks.push('挂起时工具不应执行');
  if (r.failures.length !== 0) checks.push('确认门拦截不得计入失败');
  return result('K16-委派挂起传播', checks);
}

/** K17: 跨实例恢复 —— 挂起状态随 initialSession 迁移到新实例后仍可恢复（工厂每回合新建内核的模式） */
async function testCrossInstanceResume(): Promise<RuntimeTestResult> {
  const checks: string[] = [];
  const executed: Array<Record<string, unknown>> = [];
  const delTool: ToolDefinition = {
    name: 'delete_query', category: 'query', description: '删除查询', parameters: {},
    requiresConfirmation: true,
    execute: async (args) => { executed.push(args); return { success: true, message: '已删除 (id: 7)' }; },
  };
  const turnsA = [{ toolCalls: [{ name: 'delete_query', arguments: { queryId: 7 } }] }];
  const turnsB = [{ content: '好的，已为你删除查询 7。' }];
  let ti = 0;
  const makeLLM = (turns: ScriptedTurn[]) => {
    let i = 0;
    return async function* (): AsyncGenerator<LLMStreamChunk> {
      const turn = turns[i] || { content: '（脚本已耗尽）' };
      i++;
      if (turn.content) yield { type: 'content', content: turn.content };
      for (const tc of turn.toolCalls || []) {
        yield { type: 'tool_call', toolCall: { id: `call-${++ti}`, function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } } };
      }
      yield { type: 'done' };
    };
  };

  const common = { model: 'test-model', systemPrompt: 'sys', tools: [delTool] as ToolDefinition[] };
  const instA = createKernelRuntime({ ...common, llmStream: makeLLM(turnsA) });
  const r1 = await instA.runTurn({ kind: 'user-message', text: '删除查询 7' });
  if (!r1.suspended) checks.push('实例 A 应挂起');

  // 新实例：迁移会话状态 + 对话（工厂模式），恢复 confirm
  const instB = createKernelRuntime({
    ...common,
    llmStream: makeLLM(turnsB),
    conversationMessages: r1.conversationMessages,
    initialSession: r1.state,
  });
  if (instB.getState().status !== 'suspended') checks.push('实例 B 应继承 suspended 状态');
  const r2 = await instB.runTurn({ kind: 'confirm' });
  if (r2.suspended) checks.push('实例 B 恢复后不应再挂起');
  if (executed.length !== 1 || executed[0].queryId !== 7) checks.push(`恢复应精确重执行，实际 executed=${JSON.stringify(executed)}`);
  if (r2.state.status !== 'idle') checks.push('恢复完成后应 idle');
  return result('K17-跨实例恢复', checks);
}

export async function runRuntimeTests(): Promise<RuntimeTestResult[]> {
  return [
    await testNormalTurnReplay(),
    await testConfirmResumeReplay(),
    await testCancelResumeReplay(),
    await testUserActionResumeReplay(),
    await testParseFailureFeedbackReplay(),
    testPlanConfirmToolFilter(),
    await testPlanConfirmFlow(),
    await testPlanConfirmFreeTextResuspend(),
    await testChatConfirmPromptSwitch(),
    await testCompletionInterception(),
    await testDelegationCompleted(),
    await testDelegationSuspended(),
    await testCrossInstanceResume(),
  ];
}
