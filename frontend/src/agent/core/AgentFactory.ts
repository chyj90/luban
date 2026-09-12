/**
 * AgentFactory（Phase 2.4：内核接线版）
 *
 * 职责收缩为两件事：
 * 1. 组装 KernelRuntime（系统提示词、工具、计划策略、确认门适配）；
 * 2. 事件适配器：把内核 SessionEvent 映射为 zustand store 操作（旧回调管道的替代）。
 *
 * 旧职责的去向：
 * - runAgentLoop / 状态机 / streamingManager / planCompletionChecker → 已删除，内核取代；
 * - 计划确认（旧状态机正则猜意图）→ planPolicy 的 plan-confirm 挂起 + UI 显式按钮；
 * - 危险操作确认 → 内核挂起 danger-confirm + UI 按钮；委派链路经确认门批准接力保留。
 */
import type { Message, Plan, Step, ToolDefinition } from '@/types/agent';
import { AGENT_CONFIG } from '../config';
import {
  onUserMessage as onConfirmGateUserMessage,
  consumeApproval,
} from './confirmationGuard';
import type { ChatRouter } from './chatRouter';
import type { IStoreReader } from './ports';
import { buildAnalysisPrompt, buildExecutionPrompt, type PromptBuildContext } from './promptBuilder';
import { createKernelRuntime } from '../kernel/runtime';
import { createPlanPolicy } from '../kernel/planPolicy';
import { describeInputRequest, type SessionEvent } from '../kernel/events';
import { createSessionState, type SessionState } from '../kernel/session';
import type { ResumeCommand } from '../kernel/events';

export interface AgentFactoryOptions {
  model: string;
  currentPageId: number;
  currentPageName: string;
  allPages: Array<{ id: number; name: string }>;
  sessionId: string;
  dispatch: (event: { type: string; payload: unknown }) => void;
  applicationId: string;
  addMessage: (msg: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  removeMessage: (id: string) => void;
  setStatus: (status: string) => void;
  setStreaming: (isStreaming: boolean) => void;
  setError: (error: string) => void;
  setPendingInput?: (pending: { kind: string; message: string } | null) => void;
  addPlan: (plan: Plan) => void;
  updatePlan: (planId: string, updates: Partial<Plan>) => void;
  updateStep: (planId: string, stepId: string, updates: Partial<Step>) => void;
  agentType?: 'main-agent' | 'data-assistant';
  storeReader?: IStoreReader;
  overrideSystemPrompt?: string;
  overrideTools?: ToolDefinition[];
  chatRouter?: ChatRouter;
  agentId?: string;
  agentName?: string;
  agentIcon?: string;
  isDelegated?: boolean;
  initialMessages?: Message[];
}

export type AgentExecutor = {
  run: (userMessage: string) => Promise<void>;
  /** 恢复挂起回合（UI 确认/取消/完成按钮的入口） */
  resume: (command: ResumeCommand) => Promise<void>;
  isSuspended: () => boolean;
  cancel: () => void;
  getMessages: () => Message[];
};

function injectRecentCompletedSummary(
  storeReader: IStoreReader,
  conversationMessages: Message[],
  isMainAgent: boolean,
) {
  if (!isMainAgent) return;

  const recentCompleted = storeReader
    .getPlans()
    .filter((p) => p.status === 'completed')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 1);

  for (const plan of recentCompleted) {
    const doneSteps = plan.steps.filter((s) => s.status === 'done' && s.result);
    if (doneSteps.length > 0) {
      const summary = doneSteps.map((s) => `- ${s.result}`).join('\n');
      conversationMessages.push({
        id: crypto.randomUUID(),
        role: 'system',
        content: `## 上轮操作摘要\n${summary}`,
        timestamp: Date.now(),
      });
    }
  }
}

function injectActivePlanContext(
  storeReader: IStoreReader,
  conversationMessages: Message[],
) {
  const executingPlan = storeReader.getPlans().find((p) => p.status === 'executing');
  if (!executingPlan) return;

  const steps = executingPlan.steps
    .map((s) => {
      const icon = s.status === 'done' ? '[完成]' : s.status === 'running' ? '[执行中]' : s.status === 'error' ? '[失败]' : '[待定]';
      return `${icon} ${s.description}`;
    })
    .join('\n');

  conversationMessages.push({
    id: crypto.randomUUID(),
    role: 'system',
    content: `当前活跃计划 ID: ${executingPlan.id}\n状态: ${executingPlan.status}\n步骤:\n${steps}`,
    timestamp: Date.now(),
  });
}

export async function createAgent(options: AgentFactoryOptions): Promise<AgentExecutor> {
  const {
    model,
    currentPageId, currentPageName, allPages,
    sessionId: _sessionId, dispatch,
    applicationId,
    addMessage, updateMessage, removeMessage, setStatus, setStreaming, setError, setPendingInput,
    updatePlan: _updatePlan,
    storeReader: _storeReader,
    overrideSystemPrompt, overrideTools,
    agentId, agentName, agentIcon, isDelegated, initialMessages,
  } = options;

  const storeReader = _storeReader!;
  const name = agentName || '主智能体';
  const icon = agentIcon || '';
  const agentIdFinal = agentId || 'main-agent';
  const isMainAgent = options.agentType !== 'data-assistant';

  const promptCtx: PromptBuildContext = {
    applicationId,
    currentPageId,
    currentPageName,
    allPages,
    storeReader,
    isMainAgent,
    overrideSystemPrompt,
  };
  const finalSystemPrompt = buildAnalysisPrompt(promptCtx);
  const tools = overrideTools || [];

  // —— 计划策略（仅主智能体）：计划确认挂起 + 完成拦截，确认后切换执行阶段提示词 ——
  const policy = isMainAgent
    ? createPlanPolicy(
        {
          getPlans: () => storeReader.getPlans(),
          confirmPlan: (planId) => storeReader.confirmPlan(planId),
          updatePlan: (planId, updates) => storeReader.updatePlan(planId, updates),
        },
        {
          buildExecutionPrompt: (planId) =>
            buildExecutionPrompt(promptCtx, storeReader.getPlans().find((p) => p.id === planId)?.analysisReport),
        },
      )
    : undefined;

  // —— 确认门适配：已批准的操作直接执行（委派批准接力），否则交内核挂起等 UI 按钮 ——
  const confirmGate = (toolName: string, args: Record<string, unknown>) =>
    consumeApproval(toolName, args) === 'approved' ? 'execute' as const : 'suspend' as const;

  // —— 事件适配器：SessionEvent → store 操作 ——
  let streamingId = '';
  let streamingContent = '';
  let streamingReasoning = '';
  let lastFlush = 0;
  let llmContent = '';
  let lastResultSuspended = false;
  let assistantMsgId = '';
  let batchToolCalls: Message['toolCalls'] = [];
  let batchFlushed = false;

  const clearStreamingPlaceholder = () => {
    if (streamingId) {
      removeMessage(streamingId);
      streamingId = '';
    }
    streamingContent = '';
    streamingReasoning = '';
    setStreaming(false);
  };

  const flushAssistantBatch = () => {
    if (batchFlushed) return;
    assistantMsgId = crypto.randomUUID();
    batchToolCalls = [];
    batchFlushed = true;
    addMessage({
      id: assistantMsgId,
      role: 'assistant',
      content: llmContent,
      timestamp: Date.now(),
      isStreaming: false,
      agentId: agentIdFinal,
      agentName: name,
      agentIcon: icon,
      toolCalls: batchToolCalls,
    });
  };

  const updateBatchToolCall = (callId: string, patch: Partial<NonNullable<Message['toolCalls']>[number]>) => {
    if (!assistantMsgId) return;
    batchToolCalls = batchToolCalls?.map((tc) => (tc.id === callId ? { ...tc, ...patch } : tc)) || [];
    updateMessage(assistantMsgId, { toolCalls: batchToolCalls });
  };

  const onEvent = (event: SessionEvent) => {
    switch (event.type) {
      case 'llm.request': {
        dispatch({ type: 'DEBUG_CHAT_LOG', payload: event.messages });
        break;
      }

      case 'llm.delta': {
        streamingContent += event.text;
        if (event.reasoning) streamingReasoning += event.text;
        const now = Date.now();
        if (now - lastFlush < 50 && streamingId) return;
        lastFlush = now;
        if (!streamingId) {
          streamingId = crypto.randomUUID();
          setStreaming(true);
          setStatus('streaming');
          addMessage({
            id: streamingId,
            role: 'assistant',
            content: streamingContent,
            reasoningContent: streamingReasoning || undefined,
            timestamp: Date.now(),
            isStreaming: true,
            agentId: agentIdFinal,
            agentName: name,
            agentIcon: icon,
          });
        } else {
          updateMessage(streamingId, {
            content: streamingContent,
            reasoningContent: streamingReasoning || undefined,
            isStreaming: true,
          });
        }
        break;
      }

      case 'llm.turn.finished': {
        clearStreamingPlaceholder();
        llmContent = event.content;
        batchFlushed = false;
        break;
      }

      case 'tool.call.started': {
        flushAssistantBatch();
        batchToolCalls = [...(batchToolCalls || []), {
          id: event.callId,
          name: event.name,
          arguments: event.args,
          status: 'running' as const,
        }];
        updateMessage(assistantMsgId, { toolCalls: batchToolCalls });
        break;
      }

      case 'tool.call.finished': {
        updateBatchToolCall(event.callId, {
          status: event.ok ? 'done' : 'error',
          result: event.message,
        });
        break;
      }

      case 'tool.call.blocked': {
        flushAssistantBatch();
        if (!batchToolCalls?.some((tc) => tc.id === event.callId)) {
          batchToolCalls = [...(batchToolCalls || []), {
            id: event.callId,
            name: event.name,
            arguments: {},
            status: 'error' as const,
            result: event.reason,
          }];
          updateMessage(assistantMsgId, { toolCalls: batchToolCalls });
        } else {
          updateBatchToolCall(event.callId, { status: 'error', result: event.reason });
        }
        break;
      }

      case 'turn.started': {
        lastResultSuspended = false;
        setPendingInput?.(null);
        break;
      }

      case 'turn.completed': {
        clearStreamingPlaceholder();
        if (!batchFlushed) {
          addMessage({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: event.response,
            timestamp: Date.now(),
            agentId: agentIdFinal,
            agentName: name,
            agentIcon: icon,
          });
        }
        setStatus('completed');
        setPendingInput?.(null);
        break;
      }

      case 'turn.suspended': {
        clearStreamingPlaceholder();
        lastResultSuspended = true;
        setStatus('suspended');
        setPendingInput?.({
          kind: event.request.kind,
          message: describeInputRequest(event.request),
        });
        break;
      }

      case 'turn.failed': {
        clearStreamingPlaceholder();
        setError(event.error);
        setStatus('error');
        setPendingInput?.(null);
        break;
      }

      case 'turn.cancelled': {
        clearStreamingPlaceholder();
        setStatus('cancelled');
        setPendingInput?.(null);
        break;
      }

      default:
        break;
    }
  };

  // 对话与会话状态留在工厂跨回合持有；内核按回合创建（独立的 AbortSignal / 迭代预算），
  // 结束后取回对话与折叠状态——挂起恢复依赖状态迁移，不能随实例丢弃
  let conversation: Message[] = initialMessages ? [...initialMessages] : [];
  let lastSession: SessionState = createSessionState();
  let abortController: AbortController | null = null;

  const runStartLog = (action: string, detail: string) =>
    console.log(`[AgentFactory:${name}] ${action} | ${detail}`);

  async function settlePlansAfterRun(suspended: boolean): Promise<void> {
    if (!isMainAgent) return;
    const activePlans = storeReader.getPlans().filter(
      (p) => p.status === 'confirmed' || p.status === 'executing' || p.status === 'stopped',
    );
    for (const plan of activePlans) {
      const unfinished = plan.steps.filter((s) => s.status === 'pending' || s.status === 'running');
      if (unfinished.length === 0) {
        storeReader.updatePlan(plan.id, { status: 'completed' });
      } else if (!suspended) {
        console.warn(`[AgentFactory:${name}] 回合结束但计划未完成：${plan.id}，标记为 stopped`);
        storeReader.updatePlan(plan.id, { status: 'stopped' });
        addMessage({
          id: crypto.randomUUID(),
          role: 'system',
          content: `⚠️ 任务异常结束：计划仍有 ${unfinished.length} 个步骤未完成。`,
          timestamp: Date.now(),
          agentId: agentIdFinal,
          agentName: name,
          agentIcon: icon,
        });
      }
    }
  }

  async function executeTurn(input: Parameters<ReturnType<typeof createKernelRuntime>['runTurn']>[number]): Promise<void> {
    setStatus('planning');
    setStreaming(true);
    abortController = new AbortController();
    const kernel = createKernelRuntime({
      model,
      systemPrompt: conversation.find((m) => m.role === 'system')?.content || finalSystemPrompt,
      tools,
      maxIterations: AGENT_CONFIG.maxIterations,
      temperature: AGENT_CONFIG.temperature,
      timeout: AGENT_CONFIG.timeout,
      conversationMessages: conversation,
      initialSession: lastSession,
      signal: abortController.signal,
      onEvent,
      policy,
      confirmGate,
    });
    try {
      const result = await kernel.runTurn(input);
      conversation = result.conversationMessages;
      lastSession = result.state;
      lastResultSuspended = result.suspended;
      if (!result.suspended && !result.cancelled) {
        await settlePlansAfterRun(false);
      }
      runStartLog('回合结束', `suspended=${result.suspended} cancelled=${result.cancelled}`);
    } catch (err: unknown) {
      if ((err as Error).message === 'Cancelled' || (err as Error).name === 'AbortError') {
        runStartLog('回合被取消', '');
        return;
      }
      setError((err as Error).message);
      setStreaming(false);
      setStatus('error');
    }
  }

  return {
    async run(userMessage: string): Promise<void> {
      runStartLog('run() 开始', `userMessage: "${userMessage.slice(0, 80)}${userMessage.length > 80 ? '...' : ''}"`);
      // 委派批准接力：用户文本确认（兼容旧链路）经确认门放行子会话操作
      onConfirmGateUserMessage(userMessage);

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
        agentId: agentIdFinal,
        agentName: name,
        agentIcon: icon,
      };
      if (!isDelegated) {
        addMessage(userMsg);
      }

      // 注意：用户消息由内核 runTurn 统一入对话；工厂只做 UI 展示与上下文注入，
      // 在这里 push 会造成对话中出现两条相同的 user 消息
      injectRecentCompletedSummary(storeReader, conversation, isMainAgent);
      injectActivePlanContext(storeReader, conversation);

      await executeTurn({ kind: 'user-message', text: userMessage });
    },

    async resume(command: ResumeCommand): Promise<void> {
      runStartLog('resume()', `command=${command.kind}`);
      await executeTurn(command);
    },

    isSuspended: () => lastResultSuspended,

    cancel(): void {
      abortController?.abort();
    },

    getMessages: () => [...conversation],
  };
}
