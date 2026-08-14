import type { Message, Plan, Step, ToolDefinition } from '@/types/agent';
import { useAgentStore } from '@/stores/agentStore';
import { AGENT_CONFIG } from '../config';
import { buildInteliSystemPrompt } from '../prompts/systemPrompt';
import { createInteliTools } from '../tools';
import { formatUnfinishedPlansForPrompt } from './planContext';
import { runAgentLoop } from './agentLoop';
import { planSkill } from '../skills';
import type { ChatRouter } from './chatRouter';

export interface AgentFactoryOptions {
  providerType: string;
  model: string;
  baseUrl: string;
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
}

export type AgentExecutor = {
  run: (userMessage: string) => Promise<void>;
  cancel: () => void;
};

export async function createAgent(options: AgentFactoryOptions): Promise<AgentExecutor> {
  const {
    providerType, model, baseUrl,
    currentPageId, currentPageName, allPages,
    sessionId, dispatch,
    applicationId,
    addMessage, updateMessage, removeMessage, setStatus, setStreaming, setError,
    addPlan, updatePlan, updateStep,
    overrideSystemPrompt, overrideTools, chatRouter,
    agentId, agentName, agentIcon, isDelegated,
  } = options;

  let abortController: AbortController | null = null;
  const conversationMessages: Message[] = [];

  const isMainAgent = options.agentType !== 'data-assistant';
  const systemPrompt = overrideSystemPrompt || buildInteliSystemPrompt(
    Number(applicationId), currentPageId, currentPageName, allPages,
  );
  const planContext = isMainAgent ? formatUnfinishedPlansForPrompt() : '';
  const skillPrompts = isMainAgent ? planSkill.getPromptFragment() : '';
  const finalSystemPrompt = [
    systemPrompt,
    skillPrompts,
    planContext,
  ].filter(Boolean).join('\n\n');

  const toolContext = {
    applicationId: Number(applicationId),
    pageId: currentPageId,
    dispatch,
  };
  const tools = overrideTools || createInteliTools(toolContext, chatRouter);

  const name = agentName || '主智能体';
  const icon = agentIcon || '';

  async function resolveApiKey(providerType: string): Promise<string> {
    const { vaultManager } = await import('./vaultManager');
    const apiKey = await vaultManager.getApiKey(providerType as any);
    if (!apiKey) {
      throw new Error(`未配置 ${providerType} 的 API Key，请在设置中配置`);
    }
    return apiKey;
  }

  return {
    async run(userMessage: string): Promise<void> {
      abortController = new AbortController();
      const runStart = Date.now();

      console.log(`[AgentFactory:${name}] run() 开始 | userMessage: "${userMessage.slice(0, 80)}${userMessage.length > 80 ? '...' : ''}"`);

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

      setStatus('planning');
      setStreaming(true);

      let streamingContent = '';
      let streamingReasoning = '';
      let streamingMsgId = '';
      let lastStreamingUpdate = 0;
      const STREAMING_THROTTLE_MS = 50;

      try {
        const apiKey = await resolveApiKey(providerType);

        const result = await runAgentLoop({
          baseUrl,
          apiKey,
          model,
          systemPrompt: finalSystemPrompt,
          tools,
          maxIterations: AGENT_CONFIG.maxIterations,
          temperature: AGENT_CONFIG.temperature,
          timeout: AGENT_CONFIG.timeout,
          signal: abortController.signal,
          conversationMessages,
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
          onPlanConfirm: (planId, action) => {
            return true;
          },
          onStepUpdate: (planId, stepId, status, result) => {
            updateStep(planId, stepId, { status: status as any, result });
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
          throwOnStuck: !!isDelegated,
        });

        setStatus('completed');
        setStreaming(false);

        conversationMessages.length = 0;
        conversationMessages.push(...result.conversationMessages);
        console.log(`[AgentFactory:${name}] run() 完成 | ${Date.now() - runStart}ms`);
      } catch (err: any) {
        if (err.message === 'Cancelled' || err.name === 'AbortError') {
          console.log(`[AgentFactory:${name}] run() 被取消 | ${Date.now() - runStart}ms`);
          return;
        }
        if (err.message?.startsWith('__STUCK__')) {
          console.log(`[AgentFactory:${name}] run() 卡住，向上传播 | ${err.message}`);
          throw err;
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
  };
}