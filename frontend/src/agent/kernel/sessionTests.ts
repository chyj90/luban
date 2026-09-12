/**
 * Session 内核回归测试（Phase 2.1）
 *
 * 全部为纯 reducer 测试：事件序列进、状态断言出，无任何浏览器/网络依赖。
 * 这些用例是后续里程碑的迁移基准——Runtime/策略层重构时，同一事件序列
 * 必须折叠出相同状态。
 */
import type { SessionEvent } from './events';
import { applyEvent, createSessionState, foldEvents, isSuspended, lastTurn, activeTurn } from './session';

export interface KernelTestResult {
  name: string;
  passed: boolean;
  detail: string;
}

function result(name: string, checks: string[]): KernelTestResult {
  return { name, passed: checks.length === 0, detail: checks.length === 0 ? '通过' : checks.join('；') };
}

const T = 'turn-1';

/** 用例 1：普通回合（LLM 文本 + 工具执行 + 完成） */
function testNormalTurn(): KernelTestResult {
  const checks: string[] = [];
  let s = applyEvent(createSessionState(), { type: 'turn.started', turnId: T, input: { kind: 'user-message', text: '查一下' }, at: 1 });
  if (s.status !== 'running') checks.push('turn.started 后应为 running');

  s = applyEvent(s, { type: 'llm.delta', turnId: T, text: '好的，' });
  s = applyEvent(s, { type: 'llm.delta', turnId: T, text: '正在查询' });
  s = applyEvent(s, { type: 'llm.delta', turnId: T, text: '(思考过程)', reasoning: true });
  s = applyEvent(s, { type: 'llm.turn.finished', turnId: T, content: '好的，正在查询' });

  s = applyEvent(s, { type: 'tool.call.started', turnId: T, callId: 'c1', name: 'list_queries', args: {} });
  s = applyEvent(s, { type: 'tool.call.finished', turnId: T, callId: 'c1', name: 'list_queries', ok: true, message: '共 3 条' });
  s = applyEvent(s, { type: 'turn.completed', turnId: T, response: '查询完成', at: 2 });

  const turn = lastTurn(s);
  if (s.status !== 'idle') checks.push('完成后会话应回到 idle');
  if (s.pendingInput !== null) checks.push('完成后不应有挂起输入');
  if (turn?.content !== '好的，正在查询') checks.push(`content 应被 llm.turn.finished 权威覆盖，实际 "${turn?.content}"`);
  if (turn?.reasoning !== '(思考过程)') checks.push('reasoning 应与正文分离累积');
  if (turn?.outcome !== 'completed' || turn?.response !== '查询完成') checks.push('回合 outcome/response 记录错误');
  if (turn?.toolCalls[0]?.status !== 'completed' || turn?.toolCalls[0]?.result?.ok !== true) checks.push('工具调用结果记录错误');
  return result('K1-普通回合折叠', checks);
}

/** 用例 2：危险操作确认门（挂起 → confirm 恢复 → 同一 callId 重新执行） */
function testDangerConfirmFlow(): KernelTestResult {
  const checks: string[] = [];
  let s = applyEvent(
    createSessionState(),
    { type: 'turn.started', turnId: T, input: { kind: 'user-message', text: '删除查询 7' }, at: 1 },
  );
  s = applyEvent(s, { type: 'tool.call.started', turnId: T, callId: 'c-del', name: 'delete_query', args: { queryId: 7 } });
  s = applyEvent(s, { type: 'tool.call.blocked', turnId: T, callId: 'c-del', name: 'delete_query', reason: '确认门拦截' });
  s = applyEvent(s, {
    type: 'turn.suspended', turnId: T,
    request: { kind: 'danger-confirm', callId: 'c-del', toolName: 'delete_query', args: { queryId: 7 }, argsKey: '{"queryId":7}', message: '⚠️ 危险操作待确认' },
  });

  if (s.status !== 'suspended') checks.push('确认门拦截后应挂起');
  if (s.pendingInput?.kind !== 'danger-confirm' || s.pendingInput.argsKey !== '{"queryId":7}') checks.push('挂起请求应携带工具名与参数指纹');
  if (activeTurn(s)?.toolCalls[0]?.status !== 'blocked') checks.push('被拦截调用应记为 blocked');

  // 恢复：confirm 命令开新回合，同一 callId 重新执行
  s = applyEvent(s, { type: 'turn.started', turnId: 'turn-2', input: { kind: 'resume', command: { kind: 'confirm' } }, at: 3 });
  s = applyEvent(s, { type: 'tool.call.started', turnId: 'turn-2', callId: 'c-del', name: 'delete_query', args: { queryId: 7 } });
  if (activeTurn(s)?.toolCalls[0]?.status !== 'running') checks.push('恢复后同一 callId 应回到 running');
  s = applyEvent(s, { type: 'tool.call.finished', turnId: 'turn-2', callId: 'c-del', name: 'delete_query', ok: true, message: '已删除' });
  s = applyEvent(s, { type: 'turn.completed', turnId: 'turn-2', response: '完成', at: 4 });

  if (s.status !== 'idle' || s.pendingInput !== null) checks.push('恢复完成后应回到 idle 且清空挂起');
  if (s.turns.length !== 2) checks.push(`应保留两个回合记录，实际 ${s.turns.length}`);
  if (s.turns[0].toolCalls[0].callId !== s.turns[1].toolCalls[0].callId) checks.push('两回合应共享同一 callId（同一逻辑调用的两次执行）');
  return result('K2-危险操作确认流', checks);
}

/** 用例 3：干预挂起（user-action）与 cancel 恢复 */
function testUserActionFlow(): KernelTestResult {
  const checks: string[] = [];
  let s = applyEvent(createSessionState(), { type: 'turn.started', turnId: T, input: { kind: 'user-message', text: '创建订单查询' }, at: 1 });
  s = applyEvent(s, { type: 'tool.call.started', turnId: T, callId: 'c-dq', name: 'delegate_query', args: { requirement: '...' } });
  s = applyEvent(s, { type: 'tool.call.finished', turnId: T, callId: 'c-dq', name: 'delegate_query', ok: false, message: '需要用户手动建表' });
  s = applyEvent(s, { type: 'turn.suspended', turnId: T, request: { kind: 'user-action', reason: 'DDL 被拦截，已降级生成手动 SQL' } });

  if (s.pendingInput?.kind !== 'user-action') checks.push('干预挂起请求类型应为 user-action');
  if (!isSuspended(s)) checks.push('isSuspended 选择器应返回 true');

  s = applyEvent(s, { type: 'turn.started', turnId: 'turn-2', input: { kind: 'resume', command: { kind: 'cancel' } }, at: 3 });
  s = applyEvent(s, { type: 'turn.completed', turnId: 'turn-2', response: '已放弃该操作', at: 4 });
  if (s.status !== 'idle') checks.push('cancel 恢复并完成后应回到 idle');
  return result('K3-用户操作干预流', checks);
}

/** 用例 4：失败/取消回合的记录 */
function testFailureAndCancel(): KernelTestResult {
  const checks: string[] = [];
  let s = applyEvent(createSessionState(), { type: 'turn.started', turnId: T, input: { kind: 'user-message', text: 'x' }, at: 1 });
  s = applyEvent(s, { type: 'turn.failed', turnId: T, error: 'LLM 超时', at: 2 });
  if (s.status !== 'idle') checks.push('失败后应回到 idle');
  if (s.lastError !== 'LLM 超时') checks.push('lastError 应记录失败信息');
  if (lastTurn(s)?.outcome !== 'failed') checks.push('回合 outcome 应为 failed');

  s = applyEvent(s, { type: 'turn.started', turnId: 'turn-2', input: { kind: 'user-message', text: 'y' }, at: 3 });
  s = applyEvent(s, { type: 'turn.cancelled', turnId: 'turn-2', at: 4 });
  if (lastTurn(s)?.outcome !== 'cancelled') checks.push('回合 outcome 应为 cancelled');
  if (s.lastError !== 'LLM 超时') checks.push('取消不应覆盖 lastError');
  return result('K4-失败与取消记录', checks);
}

/** 用例 5：非法序列被忽略且返回原引用（不复制状态） */
function testInvalidSequencesIgnored(): KernelTestResult {
  const checks: string[] = [];
  let s = applyEvent(createSessionState(), { type: 'turn.started', turnId: T, input: { kind: 'user-message', text: 'x' }, at: 1 });

  const before = s;
  s = applyEvent(s, { type: 'turn.started', turnId: 'turn-2', input: { kind: 'user-message', text: 'y' }, at: 2 });
  if (s !== before) checks.push('running 中开新回合应被忽略（返回原引用）');

  s = applyEvent(s, { type: 'llm.delta', turnId: 'ghost', text: 'z' });
  if (s !== before && s.eventCount !== before.eventCount) checks.push('幽灵回合事件应被忽略');

  const done = applyEvent(s, { type: 'turn.completed', turnId: T, response: 'ok', at: 3 });
  const ghost = applyEvent(done, { type: 'llm.delta', turnId: T, text: 'z' });
  if (ghost !== done) checks.push('完成后旧回合事件应被忽略');
  return result('K5-非法序列忽略', checks);
}

/** 用例 6：重放一致性 —— foldEvents(全部事件) 与逐条 applyEvent 结果完全一致 */
function testReplayDeterminism(): KernelTestResult {
  const checks: string[] = [];
  const events: SessionEvent[] = [
    { type: 'turn.started', turnId: T, input: { kind: 'user-message', text: '创建查询' }, at: 1 },
    { type: 'llm.delta', turnId: T, text: '开始执行' },
    { type: 'tool.call.started', turnId: T, callId: 'c1', name: 'delegate_query', args: { requirement: '...' } },
    { type: 'tool.call.finished', turnId: T, callId: 'c1', name: 'delegate_query', ok: false, message: '需要手动建表' },
    { type: 'turn.suspended', turnId: T, request: { kind: 'user-action', reason: 'DDL' } },
    { type: 'turn.started', turnId: 'turn-2', input: { kind: 'resume', command: { kind: 'complete', note: '已建表' } }, at: 2 },
    { type: 'tool.call.started', turnId: 'turn-2', callId: 'c2', name: 'delegate_query', args: { requirement: '继续' } },
    { type: 'tool.call.finished', turnId: 'turn-2', callId: 'c2', name: 'delegate_query', ok: true, message: '查询已创建' },
    { type: 'turn.completed', turnId: 'turn-2', response: '完成', at: 3 },
  ];

  let incremental = createSessionState();
  for (const e of events) incremental = applyEvent(incremental, e);
  const replayed = foldEvents(events);

  if (JSON.stringify(incremental) !== JSON.stringify(replayed)) checks.push('重放结果与增量折叠不一致');
  if (incremental.turns.length !== 2 || replayed.turns.length !== 2) checks.push('应折叠出两个回合');
  if (incremental.status !== 'idle') checks.push('重放后应为 idle');
  return result('K6-重放一致性', checks);
}

export function runSessionTests(): KernelTestResult[] {
  return [
    testNormalTurn(),
    testDangerConfirmFlow(),
    testUserActionFlow(),
    testFailureAndCancel(),
    testInvalidSequencesIgnored(),
    testReplayDeterminism(),
  ];
}
