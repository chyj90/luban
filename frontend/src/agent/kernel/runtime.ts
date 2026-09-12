/**
 * 事件驱动 Agent Runtime（Phase 2.2）
 *
 * 与旧 agentLoop 的区别（最终将整体取代它）：
 * - 对外只 emit SessionEvent（无回调管道），UI 桥接通过订阅事件实现；
 * - 挂起是一等公民：确认门拦截 → turn.suspended(danger-confirm)，恢复 confirm 后
 *   由内核按 callId+args 精确重执行——不依赖模型重发、不再有确认门单例和正则放行；
 * - 控制流只认显式 ResumeCommand；挂起中收到自由文本时交给模型判断（运行时只负责
 *   把待处理请求作为 system 上下文转述给模型），运行时自身永不解析自然语言；
 * - 策略（计划完成检查、强制工具注入等）在 P2.3 以纯函数 policy 接入，本文件只做编排。
 */
import type { Message, ToolDefinition, ToolExecuteResult } from '@/types/agent';
import type { LLMCallOptions, LLMStreamChunk } from '../core/llmClient';
import { callLLMAPIStream, parseToolArguments } from '../core/llmClient';
import { compactForApi } from '../core/contextWindow';
import type { SessionEvent, ResumeCommand } from './events';
import { describeInputRequest } from './events';
import { applyEvent, createSessionState, type SessionState } from './session';
import type { KernelPolicy } from './policy';

/** 与旧 confirmationGuard.argsKey 相同的参数指纹算法 */
export function toolArgsKey(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, Object.keys(args).sort());
  } catch {
    return JSON.stringify(args);
  }
}

/** Message[] → LLM API 消息（与旧 agentLoop.buildAPIMessages 一致） */
function toApiMessages(messages: Message[]): LLMCallOptions['messages'] {
  return messages.map((m) => {
    if (m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant' as const,
        content: m.content,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    if (m.toolCallId) {
      return { role: 'tool' as const, content: m.content, tool_call_id: m.toolCallId };
    }
    return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
  });
}

export interface KernelRuntimeOptions {
  model: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  maxIterations?: number;
  temperature?: number;
  timeout?: number;
  signal?: AbortSignal;
  /** 继承的对话历史（含 system）；内核运行期持有并追加 */
  conversationMessages?: Message[];
  /** 跨实例恢复：传入上一实例折叠出的会话状态（挂起/待输入请求随之迁移） */
  initialSession?: SessionState;
  /** LLM 流工厂（测试回放注入点）；缺省真实 callLLMAPIStream */
  llmStream?: (options: LLMCallOptions) => AsyncGenerator<LLMStreamChunk>;
  /** 事件订阅（UI 桥接 / 调试） */
  onEvent?: (event: SessionEvent) => void;
  /** 业务策略（计划确认/完成拦截/工具过滤）；无策略时仅保留内核内置语义 */
  policy?: KernelPolicy;
  /**
   * 危险工具预批通道：返回 'execute' 则跳过挂起直接执行（用于委派链路的批准接力）；
   * 缺省/返回 'suspend' → 挂起等显式 ResumeCommand（内核原生语义）。
   */
  confirmGate?: (toolName: string, args: Record<string, unknown>) => 'execute' | 'suspend';
}

export interface RunResult {
  state: SessionState;
  conversationMessages: Message[];
  suspended: boolean;
  cancelled: boolean;
}

export type KernelTurnInput =
  | { kind: 'user-message'; text: string }
  | ResumeCommand;

export interface KernelRuntime {
  getState(): SessionState;
  getMessages(): Message[];
  runTurn(input: KernelTurnInput): Promise<RunResult>;
}

const MAX_TOOL_FAILURES = 3;
/** beforeComplete 注入继续指令的最大次数（迁移自旧 MAX_LOOP_EXTENSIONS） */
const MAX_LOOP_EXTENSIONS = 5;
let turnSeq = 0;

export function createKernelRuntime(options: KernelRuntimeOptions): KernelRuntime {
  const {
    model, systemPrompt, tools,
    maxIterations = 100, temperature = 0.3, timeout = 300000, signal,
    llmStream = callLLMAPIStream, onEvent, policy, confirmGate,
  } = options;

  const conversation: Message[] = [...(options.conversationMessages || [])];
  if (!conversation.some((m) => m.role === 'system')) {
    conversation.unshift({ id: 'sys-prompt', role: 'system', content: systemPrompt, timestamp: Date.now() });
  }

  let session: SessionState = options.initialSession ? { ...options.initialSession } : createSessionState();
  const failCounts = new Map<string, number>();

  const emit = (event: SessionEvent): void => {
    session = applyEvent(session, event);
    onEvent?.(event);
  };

  const pushSystemMessage = (content: string): void => {
    conversation.push({ id: `sys-${++turnSeq}`, role: 'system', content, timestamp: Date.now() });
  };

  const makeResult = (suspended: boolean, cancelled = false): RunResult =>
    ({ state: session, conversationMessages: [...conversation], suspended, cancelled });

  /** 把对话中某次调用的占位工具结果改写为最终结果（保持 tool_call_id 配对不变） */
  const rewriteToolResult = (callId: string, resultJson: string): void => {
    const msg = conversation.find((m) => m.role === 'tool' && m.toolCallId === callId);
    if (msg) msg.content = resultJson;
  };

  /** 策略可要求切换 system prompt（如确认计划后从分析阶段切到执行阶段提示词） */
  const applySystemPromptReplace = (effect: { replaceSystemPrompt?: string } | null | undefined): void => {
    if (effect?.replaceSystemPrompt) {
      const sys = conversation.find((m) => m.role === 'system');
      if (sys) sys.content = effect.replaceSystemPrompt;
    }
  };

  async function executeTool(tool: ToolDefinition, args: Record<string, unknown>, callId?: string, resume?: boolean): Promise<ToolExecuteResult> {
    const context = callId ? { kernelCall: { callId, resume } } : {};
    try {
      return await tool.execute(args, context as never);
    } catch (e) {
      return { success: false, message: (e as Error).message };
    }
  }

  function interventionReason(result: ToolExecuteResult): string {
    const fromData = (result.data as { interventionReason?: string } | undefined)?.interventionReason;
    if (fromData) return fromData.slice(0, 120);
    return result.message.split('\n')[0].slice(0, 120) || '需要用户手动操作';
  }

  /** LLM→工具主循环。turn.started 必须已 emit。 */
  async function runLlmLoop(turnId: string): Promise<RunResult> {
    let loopExtensions = 0;
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (signal?.aborted) {
        emit({ type: 'turn.cancelled', turnId, at: Date.now() });
        return makeResult(false, true);
      }

      const activeTools = policy?.filterTools ? policy.filterTools(session, tools) : tools;
      const apiMessages = compactForApi(toApiMessages(conversation));
      emit({ type: 'llm.request', turnId, messages: apiMessages });
      let content = '';
      const accumulated: Array<{ id: string; name: string; arguments: string }> = [];

      try {
        const streamGen = llmStream({
          model,
          messages: apiMessages,
          tools: activeTools.map((t) => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          temperature, timeout, signal,
        });
        for await (const chunk of streamGen) {
          if (chunk.type === 'content' && chunk.content) {
            emit({ type: 'llm.delta', turnId, text: chunk.content, reasoning: chunk.reasoning });
            content += chunk.content;
          } else if (chunk.type === 'tool_call' && chunk.toolCall) {
            accumulated.push({ id: chunk.toolCall.id, name: chunk.toolCall.function.name, arguments: chunk.toolCall.function.arguments });
          }
        }
      } catch (e) {
        const message = (e as Error).message;
        if (message === 'Cancelled' || (e as Error).name === 'AbortError') {
          emit({ type: 'turn.cancelled', turnId, at: Date.now() });
          return makeResult(false, true);
        }
        emit({ type: 'turn.failed', turnId, error: message, at: Date.now() });
        return makeResult(false);
      }

      emit({ type: 'llm.turn.finished', turnId, content: content.trim() });

      if (accumulated.length === 0) {
        const assistantContent = content.trim() || '执行完毕。';
        conversation.push({ id: `a-${++turnSeq}`, role: 'assistant', content: assistantContent, timestamp: Date.now() });

        // 完成前策略拦截（计划有未完成步骤等）：注入指令继续循环，有上限
        const intervention = policy?.beforeComplete?.(session, { content: assistantContent });
        if (intervention?.systemMessage && loopExtensions < MAX_LOOP_EXTENSIONS) {
          loopExtensions++;
          pushSystemMessage(intervention.systemMessage);
          continue;
        }

        emit({ type: 'turn.completed', turnId, response: assistantContent, at: Date.now() });
        return makeResult(false);
      }

      conversation.push({
        id: `a-${++turnSeq}`,
        role: 'assistant',
        content: content.trim(),
        timestamp: Date.now(),
        toolCalls: accumulated.map((tc) => ({ id: tc.id, name: tc.name, arguments: parseToolArguments(tc.arguments) ?? {}, status: 'pending' as const })),
      });

      for (const tc of accumulated) {
        const args = parseToolArguments(tc.arguments);
        const tool = tools.find((t) => t.name === tc.name);

        if (args === null) {
          const reason = '参数解析失败';
          emit({ type: 'tool.call.blocked', turnId, callId: tc.id, name: tc.name, reason });
          conversation.push({
            id: `t-${++turnSeq}`, role: 'tool', toolCallId: tc.id, timestamp: Date.now(),
            content: JSON.stringify({ success: false, message: `工具 "${tc.name}" 的参数不是合法 JSON，未执行。请重新调用，参数必须是完整、合法的 JSON 对象。` }),
          });
          continue;
        }
        if (!tool) {
          emit({ type: 'tool.call.blocked', turnId, callId: tc.id, name: tc.name, reason: '工具不存在' });
          conversation.push({
            id: `t-${++turnSeq}`, role: 'tool', toolCallId: tc.id, timestamp: Date.now(),
            content: JSON.stringify({ success: false, message: `工具 "${tc.name}" 不存在` }),
          });
          continue;
        }

        emit({ type: 'tool.call.started', turnId, callId: tc.id, name: tc.name, args });

        // 确认门：预批通道放行则直接执行；否则挂起等显式命令（不查单例、不猜文本）
        if (tool.requiresConfirmation && confirmGate?.(tc.name, args) !== 'execute') {
          emit({ type: 'tool.call.blocked', turnId, callId: tc.id, name: tc.name, reason: '等待用户确认危险操作' });
          conversation.push({
            id: `t-${++turnSeq}`, role: 'tool', toolCallId: tc.id, timestamp: Date.now(),
            content: JSON.stringify({ success: false, _pause: true, message: `⚠️ 危险操作待确认：「${tc.name}」。本次未执行，等待用户确认。` }),
          });
          emit({
            type: 'turn.suspended', turnId,
            request: { kind: 'danger-confirm', callId: tc.id, toolName: tc.name, args, argsKey: toolArgsKey(args), message: `危险操作「${tc.name}」等待用户确认` },
          });
          return makeResult(true);
        }

        const result = await executeTool(tool, args, tc.id);
        emit({ type: 'tool.call.finished', turnId, callId: tc.id, name: tc.name, ok: result.success, message: result.message, data: result.data });
        conversation.push({ id: `t-${++turnSeq}`, role: 'tool', toolCallId: tc.id, content: JSON.stringify(result), timestamp: Date.now() });

        // 失败重试计数（暂停不计失败）
        if (!result.success && !result._pause) {
          const n = (failCounts.get(tc.name) || 0) + 1;
          failCounts.set(tc.name, n);
          if (n >= MAX_TOOL_FAILURES) {
            pushSystemMessage(`工具 ${tc.name} 已连续失败 ${n} 次，不要再重试，将失败情况如实告知用户，等待用户指导。`);
          }
        }

        // 策略级挂起优先（如 submit_analysis 后等待计划确认——其结果可能同时携带
        // 旧机制的 _pause 标记，必须由策略给出语义正确的挂起类型）
        const policyRequest = policy?.afterToolResult?.(session, { name: tc.name, result });
        if (policyRequest) {
          emit({ type: 'turn.suspended', turnId, request: policyRequest });
          return makeResult(true);
        }

        // 干预挂起：工具以结构化 _pause 声明需要用户手动操作（非文本猜测）。
        // data.suspendRequest 允许委派类工具把子会话的 danger-confirm 原样上浮到父层
        if (result._pause) {
          const suspendRequest = (result.data as { suspendRequest?: import('./events').InputRequest } | undefined)?.suspendRequest;
          emit({
            type: 'turn.suspended', turnId,
            request: suspendRequest || { kind: 'user-action', reason: interventionReason(result) },
          });
          return makeResult(true);
        }

      }
    }

    emit({ type: 'turn.completed', turnId, response: '达到最大迭代次数，强制结束。', at: Date.now() });
    return makeResult(false);
  }

  return {
    getState: () => session,
    getMessages: () => [...conversation],

    async runTurn(input: KernelTurnInput): Promise<RunResult> {
      if (session.status === 'running') {
        console.warn('[KernelRuntime] 上一回合仍在进行，拒绝并发 runTurn');
        return makeResult(false);
      }
      const isResume = input.kind !== 'user-message';
      if (isResume && session.status !== 'suspended') {
        console.warn(`[KernelRuntime] 收到恢复命令但会话未挂起（${session.status}），忽略`);
        return makeResult(false);
      }

      const turnId = `turn-${++turnSeq}`;

      if (input.kind === 'user-message') {
        conversation.push({ id: `u-${turnSeq}`, role: 'user', content: input.text, timestamp: Date.now() });
        // 挂起中收到自由文本：不猜意图，把待处理请求转述给模型，由模型判断
        if (session.status === 'suspended' && session.pendingInput) {
          pushSystemMessage(`注意：此前有一个未处理完的等待项——${describeInputRequest(session.pendingInput)}。请结合用户这条消息判断：若用户表示同意/已完成，按对应工具的说明继续；若用户在说别的事，请先回应用户。`);
        }
        emit({ type: 'turn.started', turnId, input: { kind: 'user-message', text: input.text }, at: Date.now() });
        return runLlmLoop(turnId);
      }

      const pending = session.pendingInput;

      if (input.kind === 'confirm' || input.kind === 'cancel') {
        // danger-confirm：内核内置语义（精确重执行 / 改写取消），不经过策略
        if (pending?.kind === 'danger-confirm') {
          emit({ type: 'turn.started', turnId, input: { kind: 'resume', command: input }, at: Date.now() });
          if (input.kind === 'confirm') {
            const tool = tools.find((t) => t.name === pending.toolName);
            emit({ type: 'tool.call.started', turnId, callId: pending.callId, name: pending.toolName, args: pending.args });
            // 携带恢复标记：delegate 类工具据此知道这是"用户已确认的重试"，为子会话放行
            const result = tool
              ? await executeTool(tool, pending.args, pending.callId, true)
              : { success: false, message: `工具 "${pending.toolName}" 不存在` };
            emit({ type: 'tool.call.finished', turnId, callId: pending.callId, name: pending.toolName, ok: result.success, message: result.message, data: result.data });
            rewriteToolResult(pending.callId, JSON.stringify(result));
          } else {
            rewriteToolResult(pending.callId, JSON.stringify({ success: false, message: `用户已取消危险操作「${pending.toolName}」，本次未执行。` }));
          }
          return runLlmLoop(turnId);
        }
        // 其余挂起（plan-confirm 等）：由策略解除并给出注入指令。
        // 注意 onResume 必须在 turn.started 之前调用——折叠器开新回合时会清空 pendingInput
        const effect = policy?.onResume?.(session, input)
          || { systemMessage: input.kind === 'confirm' ? '用户已确认，请继续执行。' : '用户已取消上述待处理项，请继续。' };
        emit({ type: 'turn.started', turnId, input: { kind: 'resume', command: input }, at: Date.now() });
        if (effect.systemMessage) pushSystemMessage(effect.systemMessage);
        applySystemPromptReplace(effect);
        return runLlmLoop(turnId);
      }

      // complete：用户表示挂起事项已完成
      const completeEffect = pending?.kind !== 'user-action'
        ? policy?.onResume?.(session, input)
        : undefined;
      emit({ type: 'turn.started', turnId, input: { kind: 'resume', command: input }, at: Date.now() });
      if (pending?.kind === 'user-action') {
        pushSystemMessage(`【挂起事项已解除】用户已完成所需的手动操作。挂起原因：${pending.reason}。${input.note ? `用户补充：${input.note}。` : ''}请继续执行后续步骤。`);
      } else {
        pushSystemMessage(completeEffect?.systemMessage || `用户已确认挂起事项已完成${input.note ? `：${input.note}` : ''}，请继续执行后续步骤。`);
      }
      applySystemPromptReplace(completeEffect);
      return runLlmLoop(turnId);
    },
  };
}
