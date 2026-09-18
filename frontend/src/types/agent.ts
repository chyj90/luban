export type ProviderType = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'custom';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'plan';

/** Agent 附件（Word/TXT/Excel）元信息，与后端 AgentFileService.toResponse 对齐 */
export interface AttachmentMeta {
  /** 后端 agent_file.file_key，API/Skill 读取均用它 */
  fileId: string;
  name: string;
  ext: string;
  fileType: 'word' | 'text' | 'excel';
  size: number;
  parseStatus: 'pending' | 'success' | 'failed';
  parseError?: string;
  /** 上传进度 0-100（仅上传中展示） */
  progress?: number;
  /** 提取文本长度（判断内联注入阈值用） */
  contentChars?: number;
  truncated?: boolean;
  /** 一句话概要（excel: 工作表/维度；word: 字数/表格数） */
  summary?: string;
  /** 结构化元信息（excel: sheets/headers/previewRows） */
  meta?: Record<string, unknown>;
  /** ≤ 阈值时后端随上传响应返回的提取文本，发送时直接内联进对话 */
  previewText?: string | null;
}

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
  /** 流式期提示：模型正在生成工具调用参数（正文已输出完、流未结束的静默期） */
  streamingHint?: string;
  agentId?: string;
  agentName?: string;
  agentIcon?: string;
  planId?: string;
  /** 本条消息携带的附件（仅 UI 渲染附件卡；LLM 侧以注入块进 content） */
  attachments?: AttachmentMeta[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  /** blocked：被确认门拦截等待用户确认（非失败），确认重执行后回到 running；cancelled：用户已取消，终态 */
  status: 'pending' | 'running' | 'done' | 'error' | 'blocked' | 'cancelled';
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
  /** 内核执行标记：callId 为本次调用 ID；resume=true 表示这是确认门挂起后的内核重执行（delegate 类工具消费）。
   *  turnContent 为本轮 LLM 回复正文，submit_analysis 用它缺省 analysisReport，避免模型在参数里重复生成报告全文 */
  kernelCall?: { callId: string; resume?: boolean };
  turnContent?: string;
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

export interface DelegateQueryFilterItem {
  query_name: string;
  filter_params?: string;
}

export interface DelegateQueryArgs {
  requirement: string;
  target_page: string;
  query_name: string;
  filter_params?: string;
  /** 一次委派多个查询时的结构化声明（每个查询各自的筛选参数），优先于 filter_params */
  queries?: DelegateQueryFilterItem[];
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
  | 'DELEGATE_ORCHESTRATION_START'
  | 'DELEGATE_ORCHESTRATION_END'
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
  /** 内核挂起请求（Phase 2.4）：非空时 UI 显示确认/取消按钮，点击产生显式 ResumeCommand。
   *  plan-confirm 携带 planId，会话失效后按钮恢复（resume-orphan-plan）依赖它定位计划；
   *  danger-confirm 携带 toolName/args，孤儿恢复（resumeOrphanDanger）依赖原参数原样重发 */
  pendingInput: { kind: string; message: string; planId?: string; toolName?: string; args?: Record<string, unknown> } | null;
  /** 会话失效时残留的挂起事项（不持久化）：AgentFactory 在下一次 run 时注入并清除 */
  orphanedPending: string | null;
  /** 待发送附件（不持久化）：AgentPanel 上传后入列，AgentFactory 在下一次 run 时注入并清除 */
  pendingAttachments: AttachmentMeta[];
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