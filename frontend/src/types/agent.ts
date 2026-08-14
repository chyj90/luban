export type ProviderType = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'custom';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'plan';

export type SessionStatus = 'idle' | 'planning' | 'executing' | 'streaming' | 'completed' | 'error' | 'cancelled';

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  reasoningContent?: string;
  timestamp: number;
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

export type ToolCategory = 'page' | 'code' | 'datasource' | 'query' | 'observation' | 'deploy' | 'plan';

export interface ToolContext {
  applicationId: number;
  pageId: number;
  dispatch: (event: AgentEvent) => void;
  onPagesChange?: () => void;
  onPageChange?: (pageId: number) => void;
  onQuerySelect?: (query: { id: number; name: string }) => void;
  onQueriesChange?: () => void;
}

export interface ToolExecuteResult {
  success: boolean;
  message: string;
  data?: unknown;
  _pause?: boolean;
  _noRetry?: boolean;
}

export interface ToolCallResult {
  toolCallId: string;
  toolName: string;
  result: ToolExecuteResult;
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
  | 'FIND_QUERY_START'
  | 'FIND_QUERY_COMPLETE'
  | 'TOKEN_USAGE'
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