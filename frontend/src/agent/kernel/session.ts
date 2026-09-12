/**
 * Session 状态与 reducer（Phase 2 内核）
 *
 * state = fold(events)。reducer 是纯函数：
 * - 不产生副作用、不生成随机 id、不读外部状态（可确定性重放）；
 * - 对非法事件序列宽容但可见：忽略并 console.warn，返回原引用（不复制）；
 * - 不可变更新：每个生效事件返回新 SessionState。
 *
 * Session 生命周期只有三态：idle（无活动回合）/ running（回合进行中）/
 * suspended（回合挂起等输入）。回合的成败记录在 TurnSnapshot.outcome 上，
 * 不占用会话状态——会话随时可以开始下一个回合。
 */
import type {
  SessionEvent, ToolCallSnapshot, TurnSnapshot,
} from './events';
import type { InputRequest, TurnOutcome } from './events';

export interface SessionState {
  status: 'idle' | 'running' | 'suspended';
  turns: TurnSnapshot[];
  /** 仅 status='suspended' 时非空 */
  pendingInput: InputRequest | null;
  activeTurnId: string | null;
  /** 最后一回合的失败信息（idle 后仍保留，供 UI 展示） */
  lastError: string | null;
  /** 已生效事件计数（被忽略的事件不计入），对账用 */
  eventCount: number;
}

export function createSessionState(): SessionState {
  return { status: 'idle', turns: [], pendingInput: null, activeTurnId: null, lastError: null, eventCount: 0 };
}

function warnIgnored(event: SessionEvent, reason: string): void {
  console.warn(`[Session] 忽略非法事件 ${event.type}：${reason}`);
}

function updateTurn(
  state: SessionState,
  turnId: string,
  mutate: (turn: TurnSnapshot) => TurnSnapshot,
): SessionState {
  const index = state.turns.findIndex((t) => t.turnId === turnId);
  if (index === -1) {
    console.warn(`[Session] 忽略事件：回合 ${turnId} 不存在`);
    return state;
  }
  const turns = state.turns.slice();
  turns[index] = mutate(turns[index]);
  return { ...state, turns };
}

function updateToolCall(
  turn: TurnSnapshot,
  callId: string,
  mutate: (call: ToolCallSnapshot) => ToolCallSnapshot,
): TurnSnapshot {
  const index = turn.toolCalls.findIndex((c) => c.callId === callId);
  if (index === -1) return turn;
  const toolCalls = turn.toolCalls.slice();
  toolCalls[index] = mutate(toolCalls[index]);
  return { ...turn, toolCalls };
}

export function applyEvent(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'session.reset':
      return createSessionState();

    case 'turn.started': {
      // idle：普通新回合；suspended：恢复挂起回合（resume 命令）。
      // 两种情况都清空 pendingInput——若恢复后仍在等待，Runtime 会重新挂起（账本可见）。
      if (state.status === 'running') {
        warnIgnored(event, '当前回合仍在进行，不允许开新回合');
        return state;
      }
      const turn: TurnSnapshot = {
        turnId: event.turnId,
        input: event.input,
        content: '',
        reasoning: '',
        toolCalls: [],
        startedAt: event.at,
      };
      return {
        ...state,
        status: 'running',
        turns: [...state.turns, turn],
        activeTurnId: event.turnId,
        pendingInput: null,
        eventCount: state.eventCount + 1,
      };
    }

    case 'llm.delta': {
      if (state.activeTurnId !== event.turnId) {
        warnIgnored(event, `回合 ${event.turnId} 非活动回合`);
        return state;
      }
      return updateTurn(state, event.turnId, (turn) => ({
        ...turn,
        content: event.reasoning ? turn.content : turn.content + event.text,
        reasoning: event.reasoning ? turn.reasoning + event.text : turn.reasoning,
      }));
    }

    case 'llm.turn.finished': {
      if (state.activeTurnId !== event.turnId) return state;
      return updateTurn(state, event.turnId, (turn) => ({ ...turn, content: event.content }));
    }

    case 'tool.call.started': {
      if (state.activeTurnId !== event.turnId) {
        warnIgnored(event, `回合 ${event.turnId} 非活动回合`);
        return state;
      }
      return updateTurn(state, event.turnId, (turn) => {
        const existing = turn.toolCalls.find((c) => c.callId === event.callId);
        if (existing) {
          // 挂起恢复后对同一 callId 重新执行：blocked → running
          return updateToolCall(turn, event.callId, (c) => ({ ...c, status: 'running', blockReason: undefined }));
        }
        return {
          ...turn,
          toolCalls: [...turn.toolCalls, {
            callId: event.callId,
            name: event.name,
            args: event.args,
            status: 'running' as const,
          }],
        };
      });
    }

    case 'tool.call.finished': {
      if (state.activeTurnId !== event.turnId) return state;
      return updateTurn(state, event.turnId, (turn) => updateToolCall(turn, event.callId, (c) => ({
        ...c,
        status: 'completed',
        result: { ok: event.ok, message: event.message },
      })));
    }

    case 'tool.call.blocked': {
      if (state.activeTurnId !== event.turnId) return state;
      return updateTurn(state, event.turnId, (turn) => updateToolCall(turn, event.callId, (c) => ({
        ...c,
        status: 'blocked',
        blockReason: event.reason,
      })));
    }

    case 'turn.suspended': {
      if (state.activeTurnId !== event.turnId || state.status !== 'running') {
        warnIgnored(event, '只能在 running 回合上挂起');
        return state;
      }
      return { ...state, status: 'suspended', pendingInput: event.request, eventCount: state.eventCount + 1 };
    }

    case 'turn.completed':
    case 'turn.failed':
    case 'turn.cancelled': {
      if (state.activeTurnId !== event.turnId) {
        warnIgnored(event, `回合 ${event.turnId} 非活动回合`);
        return state;
      }
      const outcome: TurnOutcome =
        event.type === 'turn.completed' ? 'completed' : event.type === 'turn.failed' ? 'failed' : 'cancelled';
      const next = updateTurn(state, event.turnId, (turn) => ({
        ...turn,
        finishedAt: event.at,
        outcome,
        response: event.type === 'turn.completed' ? event.response : turn.response,
        error: event.type === 'turn.failed' ? event.error : turn.error,
      }));
      return {
        ...next,
        status: 'idle',
        activeTurnId: null,
        pendingInput: null,
        lastError: event.type === 'turn.failed' ? event.error : next.lastError,
        eventCount: state.eventCount + 1,
      };
    }

    default:
      return state;
  }
}

/** 折叠完整事件日志（重放 = 逐条 applyEvent，保证与增量一致） */
export function foldEvents(events: SessionEvent[]): SessionState {
  let state = createSessionState();
  for (const event of events) {
    state = applyEvent(state, event);
  }
  return state;
}

export function isSuspended(state: SessionState): boolean {
  return state.status === 'suspended' && state.pendingInput !== null;
}

export function activeTurn(state: SessionState): TurnSnapshot | undefined {
  return state.turns.find((t) => t.turnId === state.activeTurnId);
}

export function lastTurn(state: SessionState): TurnSnapshot | undefined {
  return state.turns[state.turns.length - 1];
}
