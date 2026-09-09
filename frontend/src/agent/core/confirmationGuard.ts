/**
 * 危险操作确认门（需求 R3）
 *
 * 作用：requiresConfirmation 标记的技能（delete_page / delete_query / delete_api / cancel_workflow 等）
 * 在真正执行前必须获得用户确认，防止模型单方面执行破坏性操作。
 *
 * 单槽设计：同一时刻只有一个待确认操作。流程：
 * 1. agentLoop 执行前调用 consumeApproval(toolName, args)：
 *    - 已有匹配的确认记录 → 放行一次并清空；
 *    - 否则登记待确认，返回 blocked / mismatch，工具本次不执行；
 * 2. 用户下一条消息经 AgentFactory 调用 onUserMessage：
 *    - 命中确认语义 → 将待确认操作置为 approved；
 *    - 命中取消语义 → 清空待确认；
 * 3. 模型重新调用相同工具（工具名 + 参数一致）→ 放行执行。
 *
 * 确认记录带 TTL，避免长期残留；参数不一致（argsKey 不匹配）时视为未确认。
 */
import { isUserConfirming } from './agentStateMachine';

const APPROVAL_TTL_MS = 10 * 60 * 1000;

const CANCEL_PATTERNS = [/^取消$/, /^不删/, /^算了/, /^不要/, /取消/];

interface PendingOp {
  toolName: string;
  argsKey: string;
  approved: boolean;
  createdAt: number;
}

let pending: PendingOp | null = null;

export type ApprovalGate = 'approved' | 'blocked' | 'mismatch';

function argsKey(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, Object.keys(args).sort());
  } catch {
    return JSON.stringify(args);
  }
}

function clearExpired(): void {
  if (pending && Date.now() - pending.createdAt > APPROVAL_TTL_MS) {
    pending = null;
  }
}

/** agentLoop 执行前调用：approved=放行执行；blocked=登记待确认；mismatch=已有确认但参数不一致 */
export function consumeApproval(toolName: string, args: Record<string, unknown>): ApprovalGate {
  clearExpired();
  if (pending && pending.approved) {
    if (pending.toolName === toolName && pending.argsKey === argsKey(args)) {
      pending = null;
      return 'approved';
    }
    // 用户确认的是另一个操作/另一组参数，旧记录作废，按新操作重新登记
    pending = { toolName, argsKey: argsKey(args), approved: false, createdAt: Date.now() };
    return 'mismatch';
  }
  pending = { toolName, argsKey: argsKey(args), approved: false, createdAt: Date.now() };
  return 'blocked';
}

/** AgentFactory 收到用户消息时调用：识别确认/取消语义，更新待确认状态 */
export function onUserMessage(message: string): void {
  if (!pending) return;
  clearExpired();
  if (!pending) return;

  if (CANCEL_PATTERNS.some((p) => p.test(message.trim()))) {
    console.log(`[ConfirmationGuard] 用户取消操作 ${pending.toolName}`);
    pending = null;
    return;
  }
  if (isUserConfirming(message) || message.includes('确认')) {
    pending.approved = true;
    console.log(`[ConfirmationGuard] 用户确认操作 ${pending.toolName}，放行一次`);
  }
}

export function hasPending(): boolean {
  clearExpired();
  return pending !== null;
}

export function getPendingToolName(): string | null {
  clearExpired();
  return pending?.toolName ?? null;
}

/** 仅测试/自检用：重置状态 */
export function resetConfirmationGuard(): void {
  pending = null;
}
