/**
 * Session 事件词汇表（Phase 2 内核）
 *
 * 设计公理：运行时绝不依赖模型/用户文本的"听话程度"。
 * - 所有状态都是 fold(events) 的产物，事件日志是对账的唯一事实源；
 * - 挂起等待（AwaitingInput）是一等公民，统一"危险操作确认 / 等用户手动操作 / 计划确认"，
 *   取代旧的 _pause 假工具结果 + 状态机正则猜谜；
 * - 恢复控制流只能走显式 ResumeCommand（UI 按钮 / 结构化指令），运行时禁止从
 *   自然语言猜测用户意图（isUserConfirming 之类的正则将逐步删除）；
 * - 事件只携带事实（过去时），不携带指令；副作用由 Runtime 在 emit 前完成。
 *
 * 命名约定：type 用点分过去式；id 由调用方生成（内核不做随机性操作，保证回放确定性）。
 */

/** 挂起等待的用户输入请求 */
export type InputRequest =
  /** 危险操作确认门：恢复 confirm 时内核按 callId+args 精确重执行，不依赖模型重发 */
  | { kind: 'danger-confirm'; callId: string; toolName: string; args: Record<string, unknown>; argsKey: string; message: string }
  /** 等待用户在平台内手动操作（如 DDL 建表）后才能继续 */
  | { kind: 'user-action'; reason: string }
  /** 等待用户确认执行计划（迁移自旧状态机 AWAITING_CONFIRM） */
  | { kind: 'plan-confirm'; planId: string; message?: string };

/** 恢复挂起回合的显式命令 */
export type ResumeCommand =
  | { kind: 'confirm' }
  | { kind: 'cancel' }
  | { kind: 'complete'; note?: string };

export interface ToolResultSnapshot {
  ok: boolean;
  message: string;
}

export type ToolCallStatus = 'running' | 'completed' | 'blocked';

export interface ToolCallSnapshot {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolCallStatus;
  result?: ToolResultSnapshot;
  /** status='blocked' 时的原因（参数解析失败 / 工具不存在 / 确认门拦截 / 用户取消） */
  blockReason?: string;
}

export type TurnInput =
  | { kind: 'user-message'; text: string }
  | { kind: 'resume'; command: ResumeCommand };

export type TurnOutcome = 'completed' | 'failed' | 'cancelled';

export interface TurnSnapshot {
  turnId: string;
  input: TurnInput;
  /** assistant 文本（llm.delta 折叠，llm.turn.finished 权威覆盖） */
  content: string;
  reasoning: string;
  toolCalls: ToolCallSnapshot[];
  startedAt: number;
  finishedAt?: number;
  outcome?: TurnOutcome;
  /** outcome='completed' 时的最终回复 / 'failed' 时的错误信息 */
  response?: string;
  error?: string;
}

export type SessionEvent =
  | { type: 'turn.started'; turnId: string; input: TurnInput; at: number }
  /** 每次实际发给 LLM 的 API 消息（调试日志/对账用；reducer 忽略） */
  | { type: 'llm.request'; turnId: string; messages: unknown }
  | { type: 'llm.delta'; turnId: string; text: string; reasoning?: boolean }
  | { type: 'llm.turn.finished'; turnId: string; content: string }
  | { type: 'tool.call.started'; turnId: string; callId: string; name: string; args: Record<string, unknown> }
  | { type: 'tool.call.finished'; turnId: string; callId: string; name: string; ok: boolean; message: string; data?: unknown }
  | { type: 'tool.call.blocked'; turnId: string; callId: string; name: string; reason: string }
  | { type: 'turn.suspended'; turnId: string; request: InputRequest }
  | { type: 'turn.completed'; turnId: string; response: string; at: number }
  | { type: 'turn.failed'; turnId: string; error: string; at: number }
  | { type: 'turn.cancelled'; turnId: string; at: number }
  | { type: 'session.reset' };

export function describeInputRequest(request: InputRequest): string {
  switch (request.kind) {
    case 'danger-confirm':
      return `等待确认危险操作「${request.toolName}」`;
    case 'user-action':
      return `等待用户手动操作：${request.reason}`;
    case 'plan-confirm':
      return request.message || `等待确认计划 ${request.planId}`;
  }
}
