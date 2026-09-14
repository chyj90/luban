import type { ToolDefinition, Message } from '@/types/agent';
import { createAgent } from './AgentFactory';
import type { AgentExecutor, AgentFactoryOptions } from './AgentFactory';
import { getAgentById, getAgentByName, getDefaultAgent, parseMentions, stripMentions, resolveAgentTools } from '../registry/agentRegistry';
import type { AgentDefinition } from '../registry/agentRegistry';
import { getAgentMemory } from '../registry/agentMemory';
import { useAgentStore } from '@/stores/agentStore';
import type { IStoreReader } from './ports';

export type QueryRunInfo = {
  queryId: number;
  queryName: string;
  params: Record<string, unknown>;
  result: {
    columns: string[];
    rows: unknown[][];
    totalCount: number;
    executionTime: number;
  };
};

export type RouterSessionOptions = Pick<
  AgentFactoryOptions,
  'model' | 'currentPageId' | 'currentPageName' | 'allPages' | 'applicationId'
> & {
  onPagesChange?: () => void;
  onPageChange?: (pageId: number) => void;
  onQuerySelect?: (query: { id: number; name: string }) => void;
  onQueryRun?: (info: QueryRunInfo) => void;
  onQueriesChange?: () => void;
  onDatasourceChange?: () => void;
  onToolsChange?: (apiId?: number) => void;
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
  setPendingInput?: AgentFactoryOptions['setPendingInput'];
  dispatch: AgentFactoryOptions['dispatch'];
  onPagesChange?: () => void;
  onPageChange?: (pageId: number) => void;
  onQuerySelect?: (query: { id: number; name: string }) => void;
  onQueryRun?: (info: QueryRunInfo) => void;
  onQueriesChange?: () => void;
  onDatasourceChange?: () => void;
  onToolsChange?: (apiId?: number) => void;
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

// —— 跨面板重挂载的 router 注册表 ——
// AgentPanel 会因路由跳转（如侧边栏“设置”跳 /people/roles）或条件渲染整体卸载重挂，
// 组件 ref 随之销毁；而进行中的会话 executor 是纯异步闭包、仍在运行，会话消息/计划
// 写在全局 store 里，界面看起来“没断”。若新面板实例拿不到 executor，挂起恢复按钮
// 就会退化为“会话已失效”。registry 按 applicationId 保存存活的 ChatRouter 供接管。
const routerRegistry = new Map<string, ChatRouter>();

export function getLiveRouter(applicationId: string | number): ChatRouter | null {
  return routerRegistry.get(String(applicationId)) ?? null;
}

export function registerRouter(applicationId: string | number, router: ChatRouter): void {
  routerRegistry.set(String(applicationId), router);
}

/** 取消并移除指定应用的存活 router（真正的应用切换/清空会话时调用） */
export function discardRouter(applicationId: string | number): void {
  const key = String(applicationId);
  routerRegistry.get(key)?.cancel();
  routerRegistry.delete(key);
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

  /** 面板重挂载接管存活 router 时换绑最新实例的 callbacks（配合 createExecutor 的间接层生效） */
  updateCallbacks(callbacks: RouterCallbacks): void {
    this.callbacks = callbacks;
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

    const rawMemory = agentDef.id !== 'main-agent'
          ? getAgentMemory(Number(this.sessionOptions.applicationId), agentDef.id)
          : undefined;
    const executor = await this.createExecutor(agentDef, sessionId, {
        initialMessages: rawMemory?.filter((m) => m.role !== 'system'),
      });
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
      isDelegated?: boolean;
      initialMessages?: Message[];
    },
  ): Promise<AgentExecutor> {
    // 回调经由 this 间接读取而不是直接快照：executor 创建后面板可能重挂载
    // （updateCallbacks/updateSessionOptions 换绑），工具触发时必须路由到最新
    // 面板实例的闭包，旧实例的 setState 在卸载后是无效调用
    const liveUiCallbacks = () => this.callbacks;
    const liveSessionOptions = () => this.sessionOptions;
    const toolContext = {
      applicationId: Number(this.sessionOptions.applicationId),
      pageId: this.sessionOptions.currentPageId,
      dispatch: (event: { type: string; payload: unknown }) => liveUiCallbacks().dispatch(event),
      onPagesChange: () => (liveUiCallbacks().onPagesChange || liveSessionOptions().onPagesChange)?.(),
      onPageChange: (pageId: number) => (liveUiCallbacks().onPageChange || liveSessionOptions().onPageChange)?.(pageId),
      onQuerySelect: (query: { id: number; name: string }) => (liveUiCallbacks().onQuerySelect || liveSessionOptions().onQuerySelect)?.(query),
      onQueryRun: (info: QueryRunInfo) => (liveUiCallbacks().onQueryRun || liveSessionOptions().onQueryRun)?.(info),
      onQueriesChange: () => (liveUiCallbacks().onQueriesChange || liveSessionOptions().onQueriesChange)?.(),
      onDatasourceChange: () => (liveUiCallbacks().onDatasourceChange || liveSessionOptions().onDatasourceChange)?.(),
      onToolsChange: (apiId?: number) => (liveUiCallbacks().onToolsChange || liveSessionOptions().onToolsChange)?.(apiId),
      onWorkflowNavigate: (view: import('@/types/agent').WorkflowNavigateView) => (liveUiCallbacks().onWorkflowNavigate || liveSessionOptions().onWorkflowNavigate)?.(view),
    };

    const tools = overrides?.tools || resolveAgentTools(agentDef, toolContext, this);
    const systemPrompt = overrides?.systemPrompt || agentDef.buildSystemPrompt({
      applicationId: Number(this.sessionOptions.applicationId),
      pageId: this.sessionOptions.currentPageId,
      pageName: this.sessionOptions.currentPageName,
      allPages: this.sessionOptions.allPages,
      ...(overrides?.agentContext as Record<string, unknown> || {}),
    });

    const storeReader: IStoreReader = {
      getPlans: () => useAgentStore.getState().plans,
      getMessages: () => useAgentStore.getState().messages,
      getFocusPlanId: () => useAgentStore.getState().focusPlanId,
      confirmPlan: (planId) => useAgentStore.getState().confirmPlan(planId),
      setFocusPlan: (planId) => useAgentStore.getState().setFocusPlan(planId),
      updatePlan: (planId, updates) => useAgentStore.getState().updatePlan(planId, updates),
      getOrphanedPending: () => useAgentStore.getState().orphanedPending,
      clearOrphanedPending: () => useAgentStore.getState().clearOrphanedPending(),
    };

    return createAgent({
      ...this.sessionOptions,
      sessionId,
      dispatch: (event: { type: string; payload: unknown }) => this.callbacks.dispatch(event),
      addMessage: this.callbacks.addMessage,
      updateMessage: this.callbacks.updateMessage,
      removeMessage: this.callbacks.removeMessage,
      addPlan: this.callbacks.addPlan,
      updatePlan: this.callbacks.updatePlan,
      updateStep: this.callbacks.updateStep,
      setStatus: this.callbacks.setStatus,
      setStreaming: this.callbacks.setStreaming,
      setError: this.callbacks.setError,
      setPendingInput: this.callbacks.setPendingInput,
      storeReader,
      agentType: agentDef.id === 'main-agent' ? 'main-agent' : 'data-assistant',
      overrideSystemPrompt: systemPrompt,
      overrideTools: tools,
      chatRouter: this,
      agentId: agentDef.id,
      agentName: agentDef.name,
      agentIcon: agentDef.icon,
      isDelegated: overrides?.isDelegated || false,
      initialMessages: overrides?.initialMessages,
    });
  }
}