import type { ToolDefinition } from '@/types/agent';

export enum AgentState {
  IDLE = 'idle',
  ANALYZING = 'analyzing',
  AWAITING_CONFIRM = 'awaiting_confirm',
  EXECUTING = 'executing',
}

export interface AgentStateMachine {
  readonly state: AgentState;
  readonly planId: string | null;
  transition(newState: AgentState, planId?: string | null): void;
  filterTools(tools: ToolDefinition[]): ToolDefinition[];
  getPromptPhase(): 'analysis' | 'execution';
  reset(): void;
}

const TOOLS_AWAITING_CONFIRM = new Set(['confirm_plan', 'abandon_plan']);

const ANALYSIS_ONLY_TOOLS = new Set([
  'list_pages', 'list_queries', 'get_query',
  'submit_analysis', 'update_plan', 'update_plan_item',
  'confirm_plan', 'abandon_plan', 'validate_plan',
  'list_unfinished_plans', 'set_focus_plan', 'adjust_plan',
]);

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
      if (_state === AgentState.ANALYZING) {
        const filtered = tools.filter((t) => ANALYSIS_ONLY_TOOLS.has(t.name));
        console.log(`[StateMachine] 状态=${_state}，工具过滤: ${tools.length} → ${filtered.length} (分析阶段)`);
        return filtered;
      }
      return tools;
    },
    getPromptPhase(): 'analysis' | 'execution' {
      if (_state === AgentState.ANALYZING || _state === AgentState.IDLE) {
        return 'analysis';
      }
      return 'execution';
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