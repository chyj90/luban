/**
 * 结构化委派（Phase 2.3）
 *
 * 迁移自旧 delegate 技能的 routeTo + extractWorkflowOutcomes 消息扫描模式：
 * - 任务以结构化信封传入（task/params/callerContext），调用方上下文由内核确定性
 *   注入子会话 system prompt——不再依赖主模型把用户信息转述进任务字符串；
 * - 产出以结构化 outcomes 返回：子会话工具在 ToolExecuteResult.data.outcomes 中
 *   声明产出，父层从事件账本收集——不再解析子代理的消息 JSON；
 * - 子会话挂起（危险操作确认/干预）以结构化状态向上传播，由调用方决定映射方式
 *   （P2.4 中 delegate 技能把它映射为父层挂起），子代理的暂停不再被误报为失败。
 */
import type { Message, ToolDefinition } from '@/types/agent';
import type { SessionEvent, InputRequest } from './events';
import type { KernelRuntime, KernelRuntimeOptions, RunResult } from './runtime';
import { createKernelRuntime } from './runtime';

export interface DelegationEnvelope {
  /** 任务类型（如 design_form / design_workflow），子会话 prompt 按此裁剪 */
  taskType?: string;
  /** 自然语言任务描述 */
  task: string;
  /** 结构化参数（查询名、筛选参数、字段 key 等） */
  params?: Record<string, unknown>;
  /** 调用方上下文：用户身份、页面、计划步骤等——内核注入，不经主模型转述 */
  callerContext?: Record<string, unknown>;
}

export interface DelegationOutcome {
  type: string;
  id?: number;
  name?: string;
  [key: string]: unknown;
}

export interface DelegationResult {
  status: 'completed' | 'suspended' | 'failed' | 'cancelled';
  /** status='suspended' 时：子会话的挂起请求，调用方负责映射到父层 */
  pendingInput?: InputRequest;
  /** 子会话工具声明的结构化产出（data.outcomes 聚合） */
  outcomes: DelegationOutcome[];
  /** 子会话最终回复文本 */
  response: string;
  /** 子会话执行期间失败的工具调用信息 */
  failures: string[];
  /** 子会话事件日志（调试/对账） */
  events: SessionEvent[];
  state: RunResult['state'];
  /** 子会话完整对话（含注入的信封 system 段）；P2.4 替代委派记忆 */
  messages: Message[];
}

export interface DelegationOptions {
  /** 子智能体的系统提示词（技能自带）；信封由本函数追加注入 */
  childSystemPrompt: string;
  childTools: ToolDefinition[];
  envelope: DelegationEnvelope;
  /** 继承给子会话的对话记忆（旧 delegationMemory 的替代，P2.4 决定去留） */
  childMessages?: Message[];
  llmStream?: KernelRuntimeOptions['llmStream'];
  signal?: AbortSignal;
  onEvent?: (event: SessionEvent) => void;
}

/** 把信封渲染为子会话 system prompt 的追加段（确定性注入，无模型参与） */
export function renderEnvelopeSection(envelope: DelegationEnvelope): string {
  const lines: string[] = ['## 本次任务信封（由调用方注入，内容可信）'];
  if (envelope.taskType) lines.push(`- 任务类型: ${envelope.taskType}`);
  lines.push(`- 任务: ${envelope.task}`);
  if (envelope.params && Object.keys(envelope.params).length > 0) {
    lines.push(`- 参数: ${JSON.stringify(envelope.params)}`);
  }
  if (envelope.callerContext && Object.keys(envelope.callerContext).length > 0) {
    lines.push(`- 调用方上下文: ${JSON.stringify(envelope.callerContext)}`);
  }
  return lines.join('\n');
}

export async function runDelegation(options: DelegationOptions): Promise<DelegationResult> {
  const { envelope } = options;
  const outcomes: DelegationOutcome[] = [];
  const failures: string[] = [];
  const events: SessionEvent[] = [];

  const collectEvent = (event: SessionEvent): void => {
    events.push(event);
    options.onEvent?.(event);
    if (event.type === 'tool.call.finished') {
      const data = event.data as { outcomes?: DelegationOutcome[] } | undefined;
      if (Array.isArray(data?.outcomes)) outcomes.push(...data.outcomes);
      if (!event.ok) failures.push(`${event.name}: ${event.message}`);
    }
  };

  const child: KernelRuntime = createKernelRuntime({
    model: 'default',
    systemPrompt: [options.childSystemPrompt, renderEnvelopeSection(envelope)].filter(Boolean).join('\n\n'),
    tools: options.childTools,
    conversationMessages: options.childMessages,
    llmStream: options.llmStream,
    signal: options.signal,
    onEvent: collectEvent,
  });

  const run = await child.runTurn({ kind: 'user-message', text: envelope.task });
  const lastTurn = run.state.turns[run.state.turns.length - 1];

  if (run.cancelled) {
    return { status: 'cancelled', outcomes, response: '', failures, events, state: run.state, messages: run.conversationMessages };
  }
  if (run.suspended && run.state.pendingInput) {
    return {
      status: 'suspended',
      pendingInput: run.state.pendingInput,
      outcomes,
      response: lastTurn?.content || '',
      failures,
      events,
      state: run.state,
      messages: run.conversationMessages,
    };
  }
  if (lastTurn?.outcome === 'failed') {
    return { status: 'failed', outcomes, response: '', failures, events, state: run.state, messages: run.conversationMessages };
  }
  return {
    status: 'completed',
    outcomes,
    response: lastTurn?.response || lastTurn?.content || '',
    failures,
    events,
    state: run.state,
    messages: run.conversationMessages,
  };
}
