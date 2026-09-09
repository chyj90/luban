import type { Message, Plan, Step, ToolDefinition } from '@/types/agent';
import { useAgentStore } from '@/stores/agentStore';
import { AGENT_CONFIG } from '../config';
import { buildInteliSystemPrompt } from '../prompts/systemPrompt';
import { formatUnfinishedPlansForPrompt } from './planContext';
import { runAgentLoop } from './agentLoop';
import { onUserMessage as onConfirmGateUserMessage } from './confirmationGuard';
import { getPlanPromptFragment } from '../registry/skills/promptFragments';
import type { ChatRouter } from './chatRouter';
import { createAgentStateMachine, AgentState, isUserConfirming, type AgentStateMachine } from './agentStateMachine';

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
  addPlan: (plan: Plan) => void;
  updatePlan: (planId: string, updates: Partial<Plan>) => void;
  updateStep: (planId: string, stepId: string, updates: Partial<Step>) => void;
  agentType?: 'main-agent' | 'data-assistant';
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
  cancel: () => void;
  getMessages: () => Message[];
};

function handleToolResultTransition(
  toolName: string,
  result: { success: boolean; data?: { planId?: string } },
  stateMachine: AgentStateMachine,
) {
  if (toolName === 'create_plan' && result.success) {
    const store = useAgentStore.getState();
    const draftPlan = store.plans.find((p) => p.status === 'draft');
    if (draftPlan) {
      stateMachine.transition(AgentState.AWAITING_CONFIRM, draftPlan.id);
      console.log(`[AgentFactory] create_plan 完成，发现 draft plan: ${draftPlan.id}，切换到 AWAITING_CONFIRM`);
    }
    return;
  }

  if (toolName === 'confirm_plan' && result.success) {
    stateMachine.transition(AgentState.EXECUTING, stateMachine.planId);
    return;
  }

  if (toolName === 'abandon_plan' && result.success) {
    stateMachine.transition(AgentState.IDLE, null);
    return;
  }

  if (toolName === 'validate_plan' && result.success) {
    stateMachine.transition(AgentState.IDLE, null);
    return;
  }
}

export async function createAgent(options: AgentFactoryOptions): Promise<AgentExecutor> {
  const {
    model,
    currentPageId, currentPageName, allPages,
    sessionId: _sessionId, dispatch,
    applicationId,
    addMessage, updateMessage, removeMessage, setStatus, setStreaming, setError,
    addPlan, updatePlan: _updatePlan, updateStep,
    overrideSystemPrompt, overrideTools, chatRouter: _chatRouter,
    agentId, agentName, agentIcon, isDelegated, initialMessages,
  } = options;

  let abortController: AbortController | null = null;
  const conversationMessages: Message[] = initialMessages ? [...initialMessages] : [];
  const tempName = agentName || '主智能体';
  console.log(`[AgentFactory:${tempName}] createAgent | initialMessages 参数: ${initialMessages?.length || 0} 条 | conversationMessages 初始化后: ${conversationMessages.length} 条 | roles: [${conversationMessages.map((m) => m.role).join(', ')}]`);

  const isMainAgent = options.agentType !== 'data-assistant';
  const systemPrompt = overrideSystemPrompt || buildInteliSystemPrompt(
    Number(applicationId), currentPageId, currentPageName, allPages, 'analysis',
  );
  const planContext = isMainAgent ? formatUnfinishedPlansForPrompt() : '';
  const skillPrompts = isMainAgent ? getPlanPromptFragment() : '';
  const finalSystemPrompt = [
    systemPrompt,
    skillPrompts,
    planContext,
  ].filter(Boolean).join('\n\n');

  const tools = overrideTools || [];

  const name = agentName || '主智能体';
  const icon = agentIcon || '';

  const stateMachine = isMainAgent ? createAgentStateMachine() : undefined;

  return {
    async run(userMessage: string): Promise<void> {
      abortController = new AbortController();
      const runStart = Date.now();

      console.log(`[AgentFactory:${name}] run() 开始 | userMessage: "${userMessage.slice(0, 80)}${userMessage.length > 80 ? '...' : ''}"`);

      // 危险操作确认门（R3）：用户消息可能是对待确认操作的确认/取消
      onConfirmGateUserMessage(userMessage);

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
        agentId: agentId || 'main-agent',
        agentName: name,
        agentIcon: icon,
      };
      if (!isDelegated) {
        addMessage(userMsg);
        console.log(`[AgentFactory:${name}] addMessage(user) | id=${userMsg.id.slice(0, 8)}`);
      }
      conversationMessages.push(userMsg);

      if (!conversationMessages.some((m) => m.role === 'system')) {
        conversationMessages.unshift({
          id: crypto.randomUUID(),
          role: 'system',
          content: finalSystemPrompt,
          timestamp: Date.now(),
        });
      }

      if (isMainAgent && stateMachine && stateMachine.state === AgentState.IDLE) {
        const store = useAgentStore.getState();
        const recentCompleted = store.plans
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
            console.log(`[AgentFactory:${name}] 注入上轮操作摘要，共 ${doneSteps.length} 个步骤结果`);
          }
        }
      }

      if (stateMachine && stateMachine.state === AgentState.AWAITING_CONFIRM) {
        if (isUserConfirming(userMessage)) {
          const store = useAgentStore.getState();
          const planId = stateMachine.planId;
          if (planId) {
            store.confirmPlan(planId);
            stateMachine.transition(AgentState.EXECUTING, planId);
            const executionSystemPrompt = buildInteliSystemPrompt(
              Number(applicationId), currentPageId, currentPageName, allPages, 'execution',
            );
            const planContextExec = formatUnfinishedPlansForPrompt();
            const skillPromptExec = getPlanPromptFragment();
            const confirmedPlan = store.plans.find((p) => p.id === planId);
            const analysisReportSection = confirmedPlan?.analysisReport
              ? `\n\n## 需求分析报告（执行上下文）\n\n以下是完整的需求分析报告，执行每个步骤时请参考此报告中的模块、布局、交互联动等细节：\n\n${confirmedPlan.analysisReport}`
              : '';
            const fullExecutionPrompt = [
              executionSystemPrompt,
              skillPromptExec,
              planContextExec,
            ].filter(Boolean).join('\n\n') + analysisReportSection;
            const systemMsg = conversationMessages.find((m) => m.role === 'system');
            if (systemMsg) {
              systemMsg.content = fullExecutionPrompt;
            }
            conversationMessages.push({
              id: crypto.randomUUID(),
              role: 'system',
              content: '计划已确认，已切换到执行阶段。请按步骤顺序执行，每完成一步调用 update_plan_item 标记状态，所有步骤完成后调用 validate_plan 验证。',
              timestamp: Date.now(),
            });
            console.log(`[AgentFactory:${name}] 自动确认计划 ${planId}，切换到 EXECUTING，替换 system prompt 为执行阶段`);
          }
        } else {
          stateMachine.transition(AgentState.IDLE, null);
          console.log(`[AgentFactory:${name}] 用户消息非确认，切换回 IDLE`);
        }
      }

      if (stateMachine && stateMachine.planId && stateMachine.state === AgentState.EXECUTING) {
        const store = useAgentStore.getState();
        const plan = store.plans.find((p) => p.id === stateMachine.planId);
        if (plan) {
          const steps = plan.steps.map((s) => {
            const statusIcon = s.status === 'done' ? '[完成]' : s.status === 'running' ? '[执行中]' : s.status === 'error' ? '[失败]' : '[待定]';
            return `${statusIcon} ${s.description}`;
          }).join('\n');
          conversationMessages.push({
            id: crypto.randomUUID(),
            role: 'system',
            content: `当前活跃计划 ID: ${plan.id}\n状态: ${plan.status}\n步骤:\n${steps}`,
            timestamp: Date.now(),
          });
          console.log(`[AgentFactory:${name}] 注入活跃计划 ${plan.id}，共 ${plan.steps.length} 个步骤`);
        }
      }

      setStatus('planning');
      setStreaming(true);

      let streamingContent = '';
      let streamingReasoning = '';
      let streamingMsgId = '';
      let lastStreamingUpdate = 0;
      const STREAMING_THROTTLE_MS = 50;

      try {
        const result = await runAgentLoop({
          model,
          systemPrompt: finalSystemPrompt,
          tools,
          maxIterations: AGENT_CONFIG.maxIterations,
          temperature: AGENT_CONFIG.temperature,
          timeout: AGENT_CONFIG.timeout,
          signal: abortController.signal,
          conversationMessages,
          stateMachine,
          onStatusChange: (status) => {
            setStatus(status);
          },
          onStreamingContent: (content, reasoning) => {
            if (reasoning) {
              streamingReasoning += content;
            } else {
              streamingContent += content;
            }
            const now = Date.now();
            if (now - lastStreamingUpdate < STREAMING_THROTTLE_MS && streamingMsgId) {
              return;
            }
            lastStreamingUpdate = now;
            if (!streamingMsgId) {
              streamingMsgId = crypto.randomUUID();
              addMessage({
                id: streamingMsgId,
                role: 'assistant',
                content: streamingContent,
                reasoningContent: streamingReasoning || undefined,
                timestamp: Date.now(),
                isStreaming: true,
                agentId: agentId || 'main-agent',
                agentName: name,
                agentIcon: icon,
              });
            } else {
              updateMessage(streamingMsgId, {
                content: streamingContent,
                reasoningContent: streamingReasoning || undefined,
                isStreaming: true,
              });
            }
          },
          onClearStreaming: () => {
            console.log(`[AgentFactory:${name}] onClearStreaming | msgId=${streamingMsgId ? streamingMsgId.slice(0, 8) : 'none'}`);
            if (streamingMsgId) {
              removeMessage(streamingMsgId);
            }
            streamingMsgId = '';
            streamingContent = '';
            streamingReasoning = '';
            setStreaming(false);
          },
          onAddMessage: (msg) => {
            console.log(`[AgentFactory:${name}] onAddMessage | role=${msg.role} | content="${(msg.content || '').slice(0, 60)}"`);
            const enrichedMsg = {
              ...msg,
              agentId: agentId || 'main-agent',
              agentName: name,
              agentIcon: icon,
            };
            addMessage(enrichedMsg);
          },
          onPlanCreate: (plan) => {
            addPlan(plan);
          },
          onPlanConfirm: (_planId, _action) => {
            return true;
          },
          onStepUpdate: (planId, stepId, status, result) => {
            updateStep(planId, stepId, { status: status as unknown, result });
          },
          onToolCall: (toolName, input, messageId, toolCallId) => {
            console.log(`[${name}] tool call: ${toolName}`, JSON.stringify(input, null, 2));
            const store = useAgentStore.getState();
            const msg = store.messages.find((m) => m.id === messageId);
            if (msg?.toolCalls) {
              const updatedToolCalls = msg.toolCalls.map((tc) =>
                tc.id === toolCallId
                  ? { ...tc, status: 'running' as const }
                  : tc,
              );
              updateMessage(messageId, { toolCalls: updatedToolCalls });
            }
          },
          onToolResult: (toolName, result, messageId, toolCallId) => {
            const status = result.success ? 'SUCCESS' : 'FAIL';
            console.log(`[${name}] tool result: ${status} ${toolName}`);
            const store = useAgentStore.getState();
            const msg = store.messages.find((m) => m.id === messageId);
            if (msg?.toolCalls) {
              const updatedToolCalls = msg.toolCalls.map((tc) =>
                tc.id === toolCallId
                  ? { ...tc, status: result.success ? 'done' as const : 'error' as const, result: result.message }
                  : tc,
              );
              updateMessage(messageId, { toolCalls: updatedToolCalls });
            }
          },
          onError: (error) => {
            setError(error);
            setStreaming(false);
          },
          onTokenUsage: (input, output) => {
            dispatch({
              type: 'TOKEN_USAGE',
              payload: { phase: 'agent', inputTokens: input, outputTokens: output, totalTokens: input + output },
            });
          },
          onApiMessages: (messages) => {
            dispatch({
              type: 'DEBUG_CHAT_LOG',
              payload: messages,
            });
          },
          onAfterToolResult: (toolName, result, sm) => {
            handleToolResultTransition(toolName, result, sm);
          },
          onShouldComplete: () => {
            if (!isMainAgent) {
              return { shouldContinue: false };
            }
            const store = useAgentStore.getState();
            const activePlans = store.plans.filter(
              (p) => p.status === 'confirmed' || p.status === 'executing' || p.status === 'stopped',
            );
            for (const plan of activePlans) {
              const pendingSteps = plan.steps.filter((s) => s.status === 'pending');
              const runningSteps = plan.steps.filter((s) => s.status === 'running');
              if (pendingSteps.length > 0 || runningSteps.length > 0) {
                const pendingList = pendingSteps.map((s) => `  - [待完成] ${s.description}`).join('\n');
                const runningList = runningSteps.map((s) => `  - [执行中] ${s.description}`).join('\n');
                const allIncomplete = [pendingList, runningList].filter(Boolean).join('\n');
                console.log(`[AgentFactory:${name}] 拦截退出：计划 "${plan.agentName}" 仍有 ${pendingSteps.length} 个待完成步骤、${runningSteps.length} 个执行中步骤`);
                return {
                  shouldContinue: true,
                  message: `[系统提醒] 以下计划步骤还未执行完毕：\n\n${allIncomplete}\n\n请继续执行这些未完成的步骤，每完成一步调用 update_plan_item 标记（completed 需通过系统核验，result 中应包含真实资源 ID，如"表单ID: 21"）。若某步骤确实无法完成（工具持续失败、缺少前置条件），请如实说明原因并将该步骤标记为 error 后继续其余步骤——禁止将未实际完成的步骤标记为 completed。`,
                };
              }
            }
            return { shouldContinue: false };
          },
        });

        setStatus('completed');
        setStreaming(false);

        conversationMessages.length = 0;
        conversationMessages.push(...result.conversationMessages);

        if (isMainAgent) {
          const store = useAgentStore.getState();
          const activePlans = store.plans.filter(
            (p) => p.status === 'confirmed' || p.status === 'executing' || p.status === 'stopped',
          );
          for (const plan of activePlans) {
            const pendingSteps = plan.steps.filter((s) => s.status === 'pending');
            const runningSteps = plan.steps.filter((s) => s.status === 'running');
            if (pendingSteps.length > 0 || runningSteps.length > 0) {
              console.warn(`[AgentFactory:${name}] 循环结束但计划未完成："${plan.agentName}" 仍有 ${pendingSteps.length} 个待完成、${runningSteps.length} 个执行中，标记为 stopped`);
              store.updatePlan(plan.id, { status: 'stopped' });
              addMessage({
                id: crypto.randomUUID(),
                role: 'system',
                content: `⚠️ 任务异常结束：计划 "${plan.agentName}" 仍有 ${pendingSteps.length + runningSteps.length} 个步骤未完成。`,
                timestamp: Date.now(),
                agentId: agentId || 'main-agent',
                agentName: name,
                agentIcon: icon,
              });
            } else {
              store.updatePlan(plan.id, { status: 'completed' });
            }
          }
        }

        console.log(`[AgentFactory:${name}] run() 完成 | ${Date.now() - runStart}ms`);
      } catch (err: unknown) {
        if (err.message === 'Cancelled' || err.name === 'AbortError') {
          console.log(`[AgentFactory:${name}] run() 被取消 | ${Date.now() - runStart}ms`);
          return;
        }
        console.log(`[AgentFactory:${name}] run() 错误 | ${err.message}`);
        setError(err.message);
        setStreaming(false);
        setStatus('error');
      }
    },

    cancel(): void {
      abortController?.abort();
    },

    getMessages: () => [...conversationMessages],
  };
}