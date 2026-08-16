import type { ToolDefinition, Message } from '@/types/agent';
import { createAgent } from './AgentFactory';
import type { AgentExecutor, AgentFactoryOptions } from './AgentFactory';
import { getAgentById, getAgentByName, getDefaultAgent, parseMentions, stripMentions } from '../registry/agentRegistry';
import type { AgentDefinition } from '../registry/agentRegistry';
import { createDelegateQueryTool } from '../tools/findQueryTool';

export type RouterSessionOptions = Pick<
  AgentFactoryOptions,
  'providerType' | 'model' | 'baseUrl' | 'currentPageId' | 'currentPageName' | 'allPages' | 'applicationId'
> & {
  onPagesChange?: () => void;
  onPageChange?: (pageId: number) => void;
  onQuerySelect?: (query: { id: number; name: string }) => void;
  onQueriesChange?: () => void;
  onWorkflowNavigate?: (view: import('@/types/agent').WorkflowNavigateView) => void;
};

export type RouterCallbacks = {
  addMessage: AgentFactoryOptions['addMessage'];
  updateMessage: AgentFactoryOptions['updateMessage'];
  removeMessage: AgentFactoryOptions['removeMessage'];
  addPlan: AgentFactoryOptions['addPlan'];
  updatePlan: AgentFactoryOptions['updatePlan'];
  updateStep: AgentFactoryOptions['updateStep'];
  setStatus: AgentFactoryOptions['setStatus'];
  setStreaming: AgentFactoryOptions['setStreaming'];
  setError: AgentFactoryOptions['setError'];
  dispatch: AgentFactoryOptions['dispatch'];
  onPagesChange?: () => void;
  onPageChange?: (pageId: number) => void;
  onQuerySelect?: (query: { id: number; name: string }) => void;
  onQueriesChange?: () => void;
  onWorkflowNavigate?: (view: import('@/types/agent').WorkflowNavigateView) => void;
};

export interface RouteRequest {
  userInput: string;
  sessionId: string;
  targetAgentId?: string;
}

export interface RouteResult {
  agentId: string;
  agentName: string;
  agentIcon: string;
  executor: AgentExecutor;
  processedInput: string;
}

export class ChatRouter {
  private sessionOptions: RouterSessionOptions;
  private callbacks: RouterCallbacks;
  private activeAgentId: string | null = null;
  private activeExecutor: AgentExecutor | null = null;
  private allExecutors: Set<AgentExecutor> = new Set();

  constructor(sessionOptions: RouterSessionOptions, callbacks: RouterCallbacks) {
    this.sessionOptions = sessionOptions;
    this.callbacks = callbacks;
  }

  getActiveAgentId(): string | null {
    return this.activeAgentId;
  }

  getActiveExecutor(): AgentExecutor | null {
    return this.activeExecutor;
  }

  updateSessionOptions(options: Partial<RouterSessionOptions>): void {
    Object.assign(this.sessionOptions, options);
  }

  async route(request: RouteRequest): Promise<RouteResult> {
    const { userInput, sessionId, targetAgentId } = request;

    let agentDef: AgentDefinition;
    let processedInput = userInput;

    if (targetAgentId) {
      const found = getAgentById(targetAgentId);
      if (!found) throw new Error(`未找到智能体: ${targetAgentId}`);
      agentDef = found;
    } else {
      const mentions = parseMentions(userInput);
      if (mentions.length > 0) {
        const mentioned = getAgentByName(mentions[0]);
        if (mentioned) {
          agentDef = mentioned;
          processedInput = stripMentions(userInput);
        } else {
          agentDef = getDefaultAgent();
        }
      } else {
        agentDef = getDefaultAgent();
      }
    }

    console.log(`[ChatRouter] ROUTE 路由 → ${agentDef.name}(${agentDef.id}) | 输入: "${userInput.slice(0, 100)}${userInput.length > 100 ? '...' : ''}"`);

    if (this.activeAgentId === agentDef.id && this.activeExecutor) {
      return {
        agentId: agentDef.id,
        agentName: agentDef.name,
        agentIcon: agentDef.icon,
        executor: this.activeExecutor,
        processedInput,
      };
    }

    const executor = await this.createExecutor(agentDef, sessionId);
    this.allExecutors.add(executor);
    this.activeAgentId = agentDef.id;
    this.activeExecutor = executor;

    return {
      agentId: agentDef.id,
      agentName: agentDef.name,
      agentIcon: agentDef.icon,
      executor,
      processedInput,
    };
  }

  async routeTo(
    agentId: string,
    task: string,
    sessionId: string,
    overrides?: {
      systemPrompt?: string;
      tools?: ToolDefinition[];
      agentContext?: Record<string, unknown>;
      isDelegated?: boolean;
      initialMessages?: Message[];
    },
  ): Promise<AgentExecutor> {
    const agentDef = getAgentById(agentId);
    if (!agentDef) throw new Error(`未找到智能体: ${agentId}`);

    console.log(`[ChatRouter] DELEGATE 委派 → ${agentDef.name}(${agentId}) | 任务: "${task.slice(0, 100)}${task.length > 100 ? '...' : ''}"${overrides?.tools ? ` | 覆盖工具: [${overrides.tools.map((t) => t.name).join(', ')}]` : ''}`);

    const previousAgentId = this.activeAgentId;
    const previousExecutor = this.activeExecutor;

    console.log(`[ChatRouter] DELEGATE 创建 executor 前 | activeAgentId=${this.activeAgentId} | 即将创建 ${agentId}`);
    const executor = await this.createExecutor(agentDef, sessionId, overrides);
    this.allExecutors.add(executor);
    console.log(`[ChatRouter] DELEGATE executor 已创建 | 开始执行 run`);
    this.activeAgentId = agentDef.id;
    this.activeExecutor = executor;

    try {
      const runStart = Date.now();
      await executor.run(task);
      console.log(`[ChatRouter] DELEGATE 委派完成 → ${agentDef.name}(${agentId}) | run ${Date.now() - runStart}ms`);
      return executor;
    } finally {
      this.allExecutors.delete(executor);
      console.log(`[ChatRouter] DELEGATE 恢复 activeAgent | ${agentDef.id} → ${previousAgentId}`);
      this.activeAgentId = previousAgentId;
      this.activeExecutor = previousExecutor;
    }
  }

  cancel(): void {
    this.allExecutors.forEach((executor) => executor.cancel());
    this.allExecutors.clear();
  }

  private async createExecutor(
    agentDef: AgentDefinition,
    sessionId: string,
    overrides?: {
      systemPrompt?: string;
      tools?: ToolDefinition[];
      agentContext?: Record<string, unknown>;
      initialMessages?: Message[];
    },
  ): Promise<AgentExecutor> {
    const toolContext = {
      applicationId: Number(this.sessionOptions.applicationId),
      pageId: this.sessionOptions.currentPageId,
      dispatch: this.callbacks.dispatch,
      onPagesChange: this.callbacks.onPagesChange || this.sessionOptions.onPagesChange,
      onPageChange: this.callbacks.onPageChange || this.sessionOptions.onPageChange,
      onQuerySelect: this.callbacks.onQuerySelect || this.sessionOptions.onQuerySelect,
      onQueriesChange: this.callbacks.onQueriesChange || this.sessionOptions.onQueriesChange,
      onWorkflowNavigate: this.callbacks.onWorkflowNavigate || this.sessionOptions.onWorkflowNavigate,
    };

    const tools = overrides?.tools || agentDef.buildTools(toolContext);
    const finalTools = agentDef.id === 'main-agent'
      ? [...tools, createDelegateQueryTool(toolContext, this)]
      : tools;
    const systemPrompt = overrides?.systemPrompt || agentDef.buildSystemPrompt({
      applicationId: Number(this.sessionOptions.applicationId),
      pageId: this.sessionOptions.currentPageId,
      pageName: this.sessionOptions.currentPageName,
      allPages: this.sessionOptions.allPages,
      ...(overrides?.agentContext as Record<string, unknown> || {}),
    });

    return createAgent({
      ...this.sessionOptions,
      sessionId,
      dispatch: this.callbacks.dispatch,
      addMessage: this.callbacks.addMessage,
      updateMessage: this.callbacks.updateMessage,
      removeMessage: this.callbacks.removeMessage,
      addPlan: this.callbacks.addPlan,
      updatePlan: this.callbacks.updatePlan,
      updateStep: this.callbacks.updateStep,
      setStatus: this.callbacks.setStatus,
      setStreaming: this.callbacks.setStreaming,
      setError: this.callbacks.setError,
      agentType: agentDef.id === 'main-agent' ? 'main-agent' : 'data-assistant',
      overrideSystemPrompt: systemPrompt,
      overrideTools: finalTools,
      chatRouter: this,
      agentId: agentDef.id,
      agentName: agentDef.name,
      agentIcon: agentDef.icon,
      isDelegated: overrides?.isDelegated || false,
      initialMessages: overrides?.initialMessages,
    });
  }
}