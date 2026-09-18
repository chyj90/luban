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
  approvePendingApproval,
} from './confirmationGuard';
import type { ChatRouter } from './chatRouter';
import type { IStoreReader } from './ports';
import { buildAttachmentInjection } from './attachmentInjection';
import { buildAnalysisPrompt, buildExecutionPrompt, type PromptBuildContext } from './promptBuilder';
import { createKernelRuntime, toolArgsKey } from '../kernel/runtime';
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
  setPendingInput?: (pending: { kind: string; message: string; planId?: string; toolName?: string; args?: Record<string, unknown> } | null) => void;
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
  /** 会话丢失后的按钮恢复：重建的 executor 无对话历史，先注入计划语境再走显式命令 */
  resumeOrphanPlan: (command: Extract<ResumeCommand, { kind: 'resume-orphan-plan' }>) => Promise<void>;
  /** 危险操作确认的孤儿恢复：executor 丢失后重建，携带原参数走"预批放行 + 模型原样重发"链路 */
  resumeOrphanDanger: (command: { toolName: string; args: Record<string, unknown>; action: 'confirm' | 'cancel' }) => Promise<void>;
  isSuspended: () => boolean;
  /** 最近一次完成的回合是否被用户中止。委派工具据此把中断的子会话
   *  映射为结构化取消结果，而不是把半成品记成"成功完成" */
  wasLastRunCancelled: () => boolean;
  cancel: () => void;
  /** 刷新应用状态快照（页面列表/当前页面），同步更新 system prompt——executor 跨回合复用时由 chatRouter 转发 */
  updateSessionOptions: (opts: {
    allPages?: Array<{ id: number; name: string }>;
    currentPageId?: number;
    currentPageName?: string;
  }) => void;
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
  // stopped 计划必须展示：用户中止后说"继续"时，模型需要知道有一个停在半路的计划，
  // 以及正确的恢复动作是 resume_plan（而不是把它当活跃计划闷头继续跑）
  const activePlans = storeReader.getPlans().filter(
    (p) => p.status === 'executing' || p.status === 'stopped',
  );
  if (activePlans.length === 0) return;

  const planSections = activePlans
    .map((plan) => {
      const steps = plan.steps
        .map((s) => {
          const icon = s.status === 'done' ? '[完成]' : s.status === 'running' ? '[执行中]' : s.status === 'error' ? '[失败]' : '[待定]';
          return `${icon} ${s.description}`;
        })
        .join('\n');
      const stoppedHint = plan.status === 'stopped'
        ? '\n⚠️ 该计划此前被用户手动停止。仅当用户明确要求继续该计划时，先调用 resume_plan 恢复执行；其他情况不要主动恢复，也不要擅自标记其中步骤。'
        : '';
      return `计划 ID: ${plan.id}\n状态: ${plan.status}\n步骤:\n${steps}${stoppedHint}`;
    })
    .join('\n\n');

  conversationMessages.push({
    id: crypto.randomUUID(),
    role: 'system',
    content: `当前活跃/已停止的计划：\n${planSections}`,
    timestamp: Date.now(),
  });
}

/**
 * 全新 executor（刷新/重挂载后 ChatRouter 重建）没有对话历史，模型面对"还是没有"这类
 * 指代式追问会彻底失忆。从 store 回放最近的用户指令，保住需求主线。
 * 仅在对话里还没有任何 user 消息时注入（老 executor 已有完整历史，注入纯属重复）。
 */
function injectRecentUserMessages(
  storeReader: IStoreReader,
  conversationMessages: Message[],
  isMainAgent: boolean,
) {
  if (!isMainAgent) return;
  if (conversationMessages.some((m) => m.role === 'user')) return;

  const recentUserMessages = storeReader
    .getMessages()
    .filter((m) => m.role === 'user' && m.content)
    .slice(-5);
  if (recentUserMessages.length === 0) return;

  const lines = recentUserMessages.map(
    (m) => `- ${(m.content as string).slice(0, 200).replace(/\s+/g, ' ').trim()}`,
  );
  conversationMessages.push({
    id: crypto.randomUUID(),
    role: 'system',
    content: `## 本应用此前的用户指令记录（按时间序，供理解背景）\n${lines.join('\n')}\n以上是历史脉络；用户最新一条消息在对话末尾，回复时以它为准。`,
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

  // callId → 参数指纹：委派链路的确认重执行会新建 executor/callId，历史"待确认"标签
  // 无法靠 callId 原地复活，只能按 name+参数指纹 关联翻转
  const callArgsKeyById = new Map<string, string>();

  /** 把同名同参的历史 blocked 标签翻转为已完成（委派链路确认后子会话用新 callId 重跑，
   *  旧的拦截记录按参数指纹关联翻转，用户确认后同一条"待确认"显示为已执行）。
   *  仅处理 blocked——error 是真实失败历史，不篡改 */
  const settleStaleBlockedCalls = (toolName: string, argsKey: string, result: string) => {
    const affected = storeReader.getMessages().filter((m) =>
      m.agentId === agentIdFinal
      && m.toolCalls?.some((tc) => tc.status === 'blocked' && tc.name === toolName && toolArgsKey(tc.arguments || {}) === argsKey),
    );
    for (const msg of affected) {
      updateMessage(msg.id, {
        toolCalls: msg.toolCalls!.map((tc) =>
          tc.status === 'blocked' && tc.name === toolName && toolArgsKey(tc.arguments || {}) === argsKey
            ? { ...tc, status: 'done' as const, result }
            : tc,
        ),
      });
    }
  };

  const onEvent = (event: SessionEvent) => {
    switch (event.type) {
      case 'llm.request': {
        dispatch({ type: 'DEBUG_CHAT_LOG', payload: event.messages });
        break;
      }

      case 'llm.delta': {
        // reasoning 与 content 强制分流：思考文本只进 reasoningContent，
        // 混入正文会既展示给用户又污染对话历史（模型读着自己的摇摆继续摇摆）
        if (event.reasoning) {
          streamingReasoning += event.text;
        } else {
          streamingContent += event.text;
        }
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

      case 'llm.tool_call.pending': {
        // 正文流结束、工具参数还在生成的静默期（大 JSON 工具如 submit_analysis 可达数十秒）：
        // 在流式消息上挂提示避免误以为卡死。turn.finished 时流式占位消息整体移除，提示随之消失
        if (streamingId) {
          updateMessage(streamingId, { streamingHint: `正在生成 ${event.name} 的提交数据…` });
        }
        break;
      }

      case 'tool.call.started': {
        flushAssistantBatch();
        callArgsKeyById.set(event.callId, toolArgsKey(event.args));
        // 确认门挂起恢复后，内核会对同一 callId 二次 started（blocked → running 精确重执行）：
        // 必须原地复活已有标签，追加会产生"失败 + 执行中"两个重复标签
        if (batchToolCalls?.some((tc) => tc.id === event.callId)) {
          updateBatchToolCall(event.callId, { status: 'running', arguments: event.args, result: undefined });
        } else {
          batchToolCalls = [...(batchToolCalls || []), {
            id: event.callId,
            name: event.name,
            arguments: event.args,
            status: 'running' as const,
          }];
          updateMessage(assistantMsgId, { toolCalls: batchToolCalls });
        }
        break;
      }

      case 'tool.call.finished': {
        updateBatchToolCall(event.callId, {
          status: event.ok ? 'done' : 'error',
          result: event.message,
        });
        // 同参数的历史"待确认"标签随本次成功一并翻转（委派链路确认重执行走新 callId）
        if (event.ok) {
          const argsKey = callArgsKeyById.get(event.callId);
          if (argsKey) settleStaleBlockedCalls(event.name, argsKey, event.message);
        }
        break;
      }

      case 'tool.call.blocked': {
        flushAssistantBatch();
        // 确认门拦截是"等待用户确认"而非失败：用 blocked 态展示，确认后原标签回到执行中；
        // 用户点取消则落到 cancelled 终态
        const status = event.cancelled
          ? ('cancelled' as const)
          : event.waitConfirmation ? ('blocked' as const) : ('error' as const);
        if (!batchToolCalls?.some((tc) => tc.id === event.callId)) {
          batchToolCalls = [...(batchToolCalls || []), {
            id: event.callId,
            name: event.name,
            arguments: {},
            status,
            result: event.reason,
          }];
          updateMessage(assistantMsgId, { toolCalls: batchToolCalls });
        } else {
          updateBatchToolCall(event.callId, { status, result: event.reason });
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
        // 委派子智能体的回合终态不代表主 run 结束：delegate_query 仍在父内核里阻塞。
        // 子回合结束时覆盖全局 status，会让"停止"按钮闪回"发送"，直到父会话下一个
        // delta 才恢复（子→主交接空档）；终态一律由主会话自己的事件落账
        if (!isDelegated) setStatus('completed');
        setPendingInput?.(null);
        break;
      }

      case 'turn.suspended': {
        clearStreamingPlaceholder();
        lastResultSuspended = true;
        setStatus('suspended');
        setPendingInput?.({
          kind: event.request.kind,
          // plan-confirm 必须携带 planId：横幅在会话失效后按按钮恢复时（resume-orphan-plan）
          // 靠它定位持久化的计划，丢失即只能降级为文本猜意图
          ...(event.request.kind === 'plan-confirm' ? { planId: event.request.planId } : {}),
          // danger-confirm 携带工具与原参数：executor 丢失后按按钮恢复（resumeOrphanDanger）
          // 需要原参数让模型原样重发，缺了就只能退化成"会话已失效"
          ...(event.request.kind === 'danger-confirm'
            ? { toolName: event.request.toolName, args: event.request.args }
            : {}),
          // user-action 的 reason 本身已是完整句子（如"需要在数据源管理面板手动执行 DDL…"），
          // 直接使用；describeInputRequest 的"等待用户手动操作："前缀只保留给模型侧转述，
          // 避免横幅出现"等待用户手动操作：需要用户手动操作…"的双重冗余
          message: event.request.kind === 'user-action'
            ? event.request.reason
            : describeInputRequest(event.request),
        });
        break;
      }

      case 'turn.rejected': {
        // 内核拒绝（并发回合/未挂起时收到恢复命令）：必须把 executeTurn 预先置起的
        // planning/streaming 状态复位，否则 UI 永远卡在"AI 正在思考"且无任何解释
        clearStreamingPlaceholder();
        setStreaming(false);
        if (event.sessionStatus !== 'suspended') {
          setPendingInput?.(null);
        }
        setError(`操作未生效：${event.reason}`);
        break;
      }

      case 'turn.failed': {
        clearStreamingPlaceholder();
        // 委派子智能体的失败由 delegate_query 捕获并回传主智能体处理，错误横幅与
        // 终态由主会话事件驱动——子会话直接写全局会把主 run 的按钮状态打断
        if (!isDelegated) {
          setError(event.error);
          setStatus('error');
        }
        setPendingInput?.(null);
        break;
      }

      case 'turn.cancelled': {
        clearStreamingPlaceholder();
        // 用户停止会同时取消所有 executor（含父子），主会话事件负责落终态
        if (!isDelegated) setStatus('cancelled');
        setPendingInput?.(null);
        break;
      }

      default:
        break;
    }
  };

  // 对话与会话状态留在工厂跨回合持有；内核按回合创建（独立的 AbortSignal / 迭代预算），
  // 结束后取回对话与折叠状态——挂起恢复依赖状态迁移，不能随实例丢弃
  // 真实系统提示词必须在工厂创建时占住对话首位：上轮操作摘要/活跃计划等上下文注入同为
  // system 角色，若让它们先入列，内核会因"已存在 system 消息"跳过提示词注入，模型只看到
  // 摘要而没有身份/行为准则/工具规范（导出 API 日志曾出现 system 仅剩"上轮操作摘要"）
  let conversation: Message[] = [
    { id: 'sys-prompt', role: 'system', content: finalSystemPrompt, timestamp: Date.now() },
    ...(initialMessages ? initialMessages.filter((m) => m.role !== 'system') : []),
  ];
  let lastSession: SessionState = createSessionState();
  let abortController: AbortController | null = null;
  let lastRunCancelled = false;

  const runStartLog = (action: string, detail: string) =>
    console.log(`[AgentFactory:${name}] ${action} | ${detail}`);

  async function settlePlansAfterRun(suspended: boolean): Promise<void> {
    if (!isMainAgent) return;
    // stopped 是用户主动停止的计划：不再参与收尾（此前每回合都会被重复标记
    // stopped 并追加"任务异常结束"警告），恢复走 resume_plan
    const activePlans = storeReader.getPlans().filter(
      (p) => p.status === 'confirmed' || p.status === 'executing',
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

  /**
   * 用户中止回合后的计划收口：活跃计划统一置 stopped（UI 停止按钮只覆盖聚焦计划，
   * 工厂兜底保证口径一致）。running 步骤保持原状——中止时刻产出未知，
   * 恢复走 resume_plan，由其提示模型先核实再继续。
   */
  function markActivePlansStopped(): void {
    if (!isMainAgent) return;
    for (const plan of storeReader.getPlans().filter((p) => p.status === 'confirmed' || p.status === 'executing')) {
      storeReader.updatePlan(plan.id, { status: 'stopped' });
    }
  }

  /**
   * 中止锚点：对话里写入中止时刻的事实记录（哪些调用在进行、结果如何）。
   * 挂起有 describePendingForModel 重锚定，中止此前没有任何现场记录——下一回合
   * 模型只能靠可能失真的工具结果重建认知，"继续"极易被误解。
   */
  function pushCancellationAnchor(state: SessionState): void {
    const lastTurn = state.turns[state.turns.length - 1];
    const callLines = (lastTurn?.toolCalls || []).map((call) => {
      const argsSummary = JSON.stringify(call.args).slice(0, 120);
      const statusText = call.status === 'completed'
        ? (call.result?.ok ? '工具已返回结果' : '工具已返回结果（报告失败）')
        : call.status === 'blocked'
          ? `被拦截：${call.blockReason || '未知原因'}`
          : '被中止打断，结果未知';
      return `- ${call.name}（参数：${argsSummary}）：${statusText}`;
    });
    const stoppedPlan = storeReader.getPlans().find((p) => p.status === 'stopped');
    const lines = [
      '【回合被用户中止】上一回合被用户手动停止，以下是中止时刻的事实记录：',
      ...(callLines.length > 0 ? callLines : ['- 本回合尚无已记录的工具调用（中止发生在模型输出阶段）']),
      ...(stoppedPlan ? [`- 计划「${stoppedPlan.agentName}」（ID: ${stoppedPlan.id}）已置为 stopped`] : []),
      '用户下一条消息可能是"继续"，也可能是新指示。若要继续：先核实上述操作的实际情况（必要时用 list/查询类工具重新确认平台资源），不要默认中止前的委派已成功完成；确认现状后再从中断处继续。',
    ];
    conversation.push({ id: crypto.randomUUID(), role: 'system', content: lines.join('\n'), timestamp: Date.now() });
  }

  /**
   * 刷新 system prompt 里的「当前应用状态」段（页面列表/当前页面）。
   * system prompt 在工厂创建时用当时的 allPages 快照构建且冻结在对话首位，
   * executor 跨回合复用时页面可能已被删除/重建——不刷新会导致 prompt 列出
   * 已不存在的页面，模型据此调用 get_code_page 只会 404。
   */
  function refreshAppStateInPrompt(): void {
    const sysMsg = conversation.find((m) => m.role === 'system');
    if (!sysMsg) return;
    const start = sysMsg.content.indexOf('## 当前应用状态');
    if (start === -1) return;
    const rest = sysMsg.content.slice(start);
    const nextSection = rest.indexOf('\n## ', 1);
    const end = nextSection === -1 ? sysMsg.content.length : start + nextSection;
    const pageList = (promptCtx.allPages || [])
      .map((p) => `- ${p.name} (id: ${p.id})${p.id === promptCtx.currentPageId ? ' ← 当前页面' : ''}`)
      .join('\n');
    const newState = `## 当前应用状态
- 应用 ID: ${promptCtx.applicationId}
- 当前页面: ${promptCtx.currentPageName} (id: ${promptCtx.currentPageId})
- 所有页面:
${pageList}`;
    sysMsg.content = sysMsg.content.slice(0, start) + newState + sysMsg.content.slice(end);
  }

  function updateSessionOptions(opts: {
    allPages?: Array<{ id: number; name: string }>;
    currentPageId?: number;
    currentPageName?: string;
  }): void {
    if (opts.allPages) promptCtx.allPages = opts.allPages;
    if (opts.currentPageId != null) promptCtx.currentPageId = opts.currentPageId;
    if (opts.currentPageName) promptCtx.currentPageName = opts.currentPageName;
    refreshAppStateInPrompt();
  }

  async function executeTurn(input: Parameters<ReturnType<typeof createKernelRuntime>['runTurn']>[number]): Promise<void> {
    setStatus('planning');
    setStreaming(true);
    abortController = new AbortController();
    lastRunCancelled = false;
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
      if (result.rejected) {
        // 被内核拒绝：会话状态没有任何变化，不取回结果、不做计划收尾
        runStartLog('回合被拒绝', '');
        return;
      }
      conversation = result.conversationMessages;
      lastSession = result.state;
      lastResultSuspended = result.suspended;
      lastRunCancelled = result.cancelled;
      if (result.cancelled) {
        markActivePlansStopped();
        pushCancellationAnchor(result.state);
      }
      if (!result.suspended && !result.cancelled) {
        await settlePlansAfterRun(false);
      }
      runStartLog('回合结束', `suspended=${result.suspended} cancelled=${result.cancelled}`);
    } catch (err: unknown) {
      if ((err as Error).message === 'Cancelled' || (err as Error).name === 'AbortError') {
        runStartLog('回合被取消', '');
        return;
      }
      // 委派子会话的异常由 delegate 工具捕获并回传主智能体（同 turn.failed 分支的口径）
      if (!isDelegated) {
        setError((err as Error).message);
        setStreaming(false);
        setStatus('error');
      }
    }
  }

  return {
    async run(userMessage: string): Promise<void> {
      runStartLog('run() 开始', `userMessage: "${userMessage.slice(0, 80)}${userMessage.length > 80 ? '...' : ''}"`);
      // 委派批准接力：用户文本确认（兼容旧链路）经确认门放行子会话操作
      onConfirmGateUserMessage(userMessage);

      // 待发送附件本轮消费：UI 消息挂附件卡（content 保持干净），LLM 对话注入注入块。
      // 立即清除，避免委派/后续轮次重复注入；会话失效重放（injectRecentUserMessages）
      // 只回放干净正文，文件深读靠 file_* 技能兜底
      const pendingAttachments = storeReader.getPendingAttachments?.() ?? [];
      if (pendingAttachments.length > 0) {
        storeReader.clearPendingAttachments?.();
      }
      const attachmentBlock = buildAttachmentInjection(pendingAttachments);
      const llmText = attachmentBlock ? `${attachmentBlock}\n\n${userMessage}` : userMessage;

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
        agentId: agentIdFinal,
        agentName: name,
        agentIcon: icon,
        attachments: pendingAttachments.length > 0 ? [...pendingAttachments] : undefined,
      };
      if (!isDelegated) {
        addMessage(userMsg);
      }

      // 注意：用户消息由内核 runTurn 统一入对话；工厂只做 UI 展示与上下文注入，
      // 在这里 push 会造成对话中出现两条相同的 user 消息
      injectRecentCompletedSummary(storeReader, conversation, isMainAgent);
      injectActivePlanContext(storeReader, conversation);

      // 会话失效降级：挂起事项曾因 executor 丢失无法按按钮恢复，把上下文带给模型，
      // 让"继续/已完成"这类恢复指令有锚点，而不是靠模型重新猜整场对话
      const orphanedPending = storeReader.getOrphanedPending?.();
      if (orphanedPending) {
        conversation.push({
          id: crypto.randomUUID(),
          role: 'system',
          content: `【未恢复的挂起事项】${orphanedPending}\n该事项此前点击恢复按钮时会话已失效，未被处理。请结合用户本轮消息处理：若用户表示已完成，继续后续步骤；若用户给出新指示，按新指示执行；若挂起事项是等待确认的计划，仅在用户明确回复确认类指令（如"确认执行"）后才调用 confirm_plan，不要把"已完成"当作计划确认。`,
          timestamp: Date.now(),
        });
        storeReader.clearOrphanedPending?.();
      }

      // 全新 executor 没有对话历史：回放最近的用户指令，避免需求主线丢失
      injectRecentUserMessages(storeReader, conversation, isMainAgent);

      await executeTurn({ kind: 'user-message', text: llmText });
    },

    async resume(command: ResumeCommand): Promise<void> {
      runStartLog('resume()', `command=${command.kind}`);
      await executeTurn(command);
    },

    async resumeOrphanPlan(command): Promise<void> {
      runStartLog('resumeOrphanPlan()', `planId=${command.planId} action=${command.action}`);
      // 重建的 executor 没有对话历史：与 run() 相同的语境注入，保住需求主线。
      // 此时计划还是 draft，injectActivePlanContext 注入不到它——执行上下文由
      // policy.onResume 的 buildExecutionPrompt（含计划步骤与分析报告）补齐
      injectRecentCompletedSummary(storeReader, conversation, isMainAgent);
      injectRecentUserMessages(storeReader, conversation, isMainAgent);
      await executeTurn(command);
    },

    async resumeOrphanDanger(command): Promise<void> {
      runStartLog('resumeOrphanDanger()', `tool=${command.toolName} action=${command.action}`);
      injectRecentUserMessages(storeReader, conversation, isMainAgent);
      if (command.action === 'confirm') {
        // 预批放行一次：确认门单例仍持有被拦截操作的 toolName+argsKey（consumeApproval
        // 在挂起时已登记），模型按原参数重发即可直接执行。若单例已清空（硬刷新/超 10 分钟），
        // 重发会再次挂起出横幅——此时 executor 已存活，用户再点一次确认即可，不会死锁
        approvePendingApproval();
        conversation.push({
          id: crypto.randomUUID(),
          role: 'system',
          content: `【恢复被中断的确认】用户点击了确认按钮，确认执行此前被确认门拦截的危险操作「${command.toolName}」。\n` +
            `请立即用与下面完全相同的参数重新调用 ${command.toolName}（参数一字不改，禁止自行改写或重新生成代码），拿到结果后继续原任务。\n` +
            `参数原文：\n${JSON.stringify(command.args)}`,
          timestamp: Date.now(),
        });
      } else {
        conversation.push({
          id: crypto.randomUUID(),
          role: 'system',
          content: `【恢复被中断的取消】用户取消了此前被拦截的危险操作「${command.toolName}」，该操作未执行。` +
            `不要再调用该工具；简要说明当前状态并等待用户进一步指示。`,
          timestamp: Date.now(),
        });
      }
      await executeTurn({ kind: 'user-message', text: command.action === 'confirm' ? '确认' : '取消' });
    },

    isSuspended: () => lastResultSuspended,

    wasLastRunCancelled: () => lastRunCancelled,

    cancel(): void {
      abortController?.abort();
    },

    updateSessionOptions,

    getMessages: () => [...conversation],
  };
}
