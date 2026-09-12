export type ProviderType = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'custom';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'plan';

export type SessionStatus = 'idle' | 'planning' | 'executing' | 'streaming' | 'completed' | 'error' | 'cancelled' | 'suspended';

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  reasoningContent?: string;
  timestamp: number;
  /** 首次入列时间：聚合消息（如 plan）会被 updateMessage 刷新 timestamp，导出时间线以 createdAt 为准 */
  createdAt?: number;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  isStreaming?: boolean;
  agentId?: string;
  agentName?: string;
  agentIcon?: string;
  planId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'done' | 'error';
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolExecuteResult>;
  isDangerous?: boolean;
  requiresConfirmation?: boolean;
}

export type ToolCategory = 'page' | 'code' | 'datasource' | 'query' | 'observation' | 'deploy' | 'plan' | 'workflow' | 'delegate';

export interface WorkflowNavigateView {
  view: string;
  processId?: number;
  formMode?: boolean;
  formId?: number;
  appId?: number;
  instanceId?: number;
}

export interface ToolContext {
  applicationId: number;
  pageId: number;
  dispatch: (event: AgentEvent) => void;
  /** 内核执行标记：callId 为本次调用 ID；resume=true 表示这是确认门挂起后的内核重执行（delegate 类工具消费） */
  kernelCall?: { callId: string; resume?: boolean };
  onPagesChange?: () => void;
  onPageChange?: (pageId: number) => void;
  onQuerySelect?: (query: { id: number; name: string }) => void;
  onQueryRun?: (info: { queryId: number; queryName: string; params: Record<string, unknown>; result: { columns: string[]; rows: unknown[][]; totalCount: number; executionTime: number } }) => void;
  onQueriesChange?: () => void;
  onDatasourceChange?: () => void;
  onToolsChange?: (apiId?: number) => void;
  onWorkflowNavigate?: (view: WorkflowNavigateView) => void;
}

export interface ToolExecuteResult {
  success: boolean;
  message: string;
  data?: unknown;
  _pause?: boolean;
  _noRetry?: boolean;
}

export interface DelegateQueryArgs {
  requirement: string;
  target_page: string;
  query_name: string;
  filter_params?: string;
}

export interface DelegateQueryResult {
  success: boolean;
  message: string;
  details?: string;
  data?: unknown;
  /** DDL 被拦截后降级为手动 SQL，需要等待用户操作 */
  interventionRequired?: boolean;
  /** 干预原因 */
  interventionReason?: string;
  _noRetry?: boolean;
}

export interface ToolCallResult {
  toolCallId: string;
  toolName: string;
  result: ToolExecuteResult;
}

export interface PlanScore {
  total: number;
  dimensions: {
    moduleDetail: number;
    interactionComplexity: number;
    dataCoverage: number;
    fieldSpecificity: number;
  };
  deductions: Array<{ rule: string; points: number; reason: string }>;
}

export interface Plan {
  id: string;
  agentId: string;
  agentName: string;
  agentIcon: string;
  steps: Step[];
  createdAt: number;
  status: 'draft' | 'pending' | 'confirmed' | 'executing' | 'completed' | 'rejected' | 'stopped';
  parentPlanId?: string;
  parentStepId?: string;
  score?: PlanScore;
  analysisReport?: string;
}

export interface Step {
  id: string;
  description: string;
  status: StepStatus;
  toolName?: string;
  result?: string;
  order: number;
  subPlanId?: string;
}

export interface AgentEvent {
  type: AgentEventType;
  payload: unknown;
}

export type AgentEventType =
  | 'MESSAGE_START'
  | 'MESSAGE_CHUNK'
  | 'MESSAGE_COMPLETE'
  | 'TOOL_CALL_START'
  | 'TOOL_CALL_COMPLETE'
  | 'TOOL_CALL_ERROR'
  | 'PLAN_CREATED'
  | 'PLAN_CONFIRMED'
  | 'STEP_START'
  | 'STEP_COMPLETE'
  | 'STEP_ERROR'
  | 'SESSION_START'
  | 'SESSION_COMPLETE'
  | 'SESSION_ERROR'
  | 'SESSION_CANCELLED'
  | 'DELEGATE_QUERY_START'
  | 'DELEGATE_QUERY_END'
  | 'DELEGATE_QUERY_COMPLETE'
  | 'DELEGATE_WORKFLOW_START'
  | 'DELEGATE_WORKFLOW_END'
  | 'FIND_WORKFLOW_START'
  | 'FIND_WORKFLOW_COMPLETE'
  | 'TOKEN_USAGE'
  | 'DEBUG_CHAT_LOG'
  | 'ERROR';

export interface AgentState {
  sessionId: string;
  status: SessionStatus;
  messages: Message[];
  plans: Plan[];
  currentPlanId: string | null;
  focusPlanId: string | null;
  executingStepId: string | null;
  isStreaming: boolean;
  error: string | null;
  /** 内核挂起请求（Phase 2.4）：非空时 UI 显示确认/取消按钮，点击产生显式 ResumeCommand */
  pendingInput: { kind: string; message: string } | null;
}

export interface LLMConfig {
  provider: ProviderType;
  model: string;
  baseUrl: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
}

export interface StreamingMetadata {
  messageId: string;
  content: string;
  isComplete: boolean;
}

export interface AgentProgress {
  currentStep: number;
  totalSteps: number;
  message: string;
}