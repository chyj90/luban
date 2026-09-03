import type { ToolDefinition } from '@/types/agent';

export enum AgentState {
  IDLE = 'idle',
  AWAITING_CONFIRM = 'awaiting_confirm',
  EXECUTING = 'executing',
}

export interface AgentStateMachine {
  readonly state: AgentState;
  readonly planId: string | null;
  transition(newState: AgentState, planId?: string | null): void;
  filterTools(tools: ToolDefinition[]): ToolDefinition[];
  reset(): void;
}

const TOOLS_AWAITING_CONFIRM = new Set(['confirm_plan', 'abandon_plan']);

export function createAgentStateMachine(): AgentStateMachine {
  let _state: AgentState = AgentState.IDLE;
  let _planId: string | null = null;

  return {
    get state() {
      return _state;
    },
    get planId() {
      return _planId;
    },
    transition(newState: AgentState, planId?: string | null) {
      if (_state === newState && planId === undefined) return;
      console.log(`[StateMachine] ${_state} → ${newState}${planId !== undefined ? ` plan=${planId}` : ''}`);
      _state = newState;
      if (planId !== undefined) _planId = planId;
    },
    filterTools(tools: ToolDefinition[]): ToolDefinition[] {
      if (_state === AgentState.AWAITING_CONFIRM) {
        const filtered = tools.filter((t) => TOOLS_AWAITING_CONFIRM.has(t.name));
        console.log(`[StateMachine] 状态=${_state}，工具过滤: ${tools.length} → ${filtered.length} (仅允许: ${[...TOOLS_AWAITING_CONFIRM].join(', ')})`);
        return filtered;
      }
      return tools;
    },
    reset() {
      _state = AgentState.IDLE;
      _planId = null;
    },
  };
}

const CONFIRM_PATTERNS = [
  /^确认$/,
  /^开始$/,
  /^没问题$/,
  /^可以$/,
  /^执行$/,
  /^继续$/,
  /^好的$/,
  /^行$/,
  /^ok$/i,
  /^yes$/i,
  /^确认执行$/,
  /^开始执行$/,
  /^没问题了$/,
  /^可以的$/,
  /^好$/,
  /^嗯$/,
  /^对$/,
];

export function isUserConfirming(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length > 10) return false;
  return CONFIRM_PATTERNS.some((p) => p.test(trimmed));
}