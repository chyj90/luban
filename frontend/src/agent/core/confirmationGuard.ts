/** 短确认指令匹配（从旧 agentStateMachine 收编，仅剩委派批准接力一个消费方） */
const CONFIRM_PATTERNS = [
  /^确认$/, /^开始$/, /^没问题$/, /^可以$/, /^执行$/, /^继续$/,
  /^好的$/, /^行$/, /^ok$/i, /^yes$/i, /^确认执行$/, /^开始执行$/,
  /^没问题了$/, /^可以的$/, /^好$/, /^嗯$/, /^对$/,
];

export function isUserConfirming(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length > 10) return false;
  return CONFIRM_PATTERNS.some((p) => p.test(trimmed));
}

const APPROVAL_TTL_MS = 10 * 60 * 1000;

/**
 * 取消指令必须和确认指令一样受长度门约束（≤10 字符），且尽量锚定句首：
 * 此前 /取消/、/不要/ 等未锚定正则会让"不要忘了加字段"这类长句误取消挂起操作。
 */
const CANCEL_PATTERNS = [/^取消/, /^算了/, /^不要$/, /^不删/, /^别删/];

function isUserCancelling(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length > 10) return false;
  return CANCEL_PATTERNS.some((p) => p.test(trimmed));
}

interface PendingOp {
  toolName: string;
  argsKey: string;
  approved: boolean;
  createdAt: number;
}

export type ApprovalGate = 'approved' | 'blocked' | 'mismatch';

function argsKey(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, Object.keys(args).sort());
  } catch {
    return JSON.stringify(args);
  }
}

export class ConfirmationGuard {
  private pending: PendingOp | null = null;

  private clearExpired(): void {
    if (this.pending && Date.now() - this.pending.createdAt > APPROVAL_TTL_MS) {
      this.pending = null;
    }
  }

  consumeApproval(toolName: string, args: Record<string, unknown>): ApprovalGate {
    this.clearExpired();
    if (this.pending && this.pending.approved) {
      if (this.pending.toolName === toolName && this.pending.argsKey === argsKey(args)) {
        this.pending = null;
        return 'approved';
      }
      this.pending = { toolName, argsKey: argsKey(args), approved: false, createdAt: Date.now() };
      return 'mismatch';
    }
    this.pending = { toolName, argsKey: argsKey(args), approved: false, createdAt: Date.now() };
    return 'blocked';
  }

  onUserMessage(message: string): void {
    if (!this.pending) return;
    this.clearExpired();
    if (!this.pending) return;

    if (isUserCancelling(message)) {
      console.log(`[ConfirmationGuard] 用户取消操作 ${this.pending.toolName}`);
      this.pending = null;
      return;
    }
    // 只认短确认指令（isUserConfirming 有长度门）。
    // 此前的 message.includes('确认') 兜底会让"我确认一下需求：你是要删页面A吗"
    // 这类长句误放行挂起的危险操作，已删除
    if (isUserConfirming(message)) {
      this.pending.approved = true;
      console.log(`[ConfirmationGuard] 用户确认操作 ${this.pending.toolName}，放行一次`);
    }
  }

  /**
   * 批准当前挂起操作（委派链路专用）：delegate 工具在"内核确认重执行"时调用，
   * 为子会话即将重试的危险操作放行。仅在有挂起时生效。
   */
  approvePending(): boolean {
    this.clearExpired();
    if (this.pending && !this.pending.approved) {
      this.pending.approved = true;
      console.log(`[ConfirmationGuard] 内核确认重执行，批准 ${this.pending.toolName}`);
      return true;
    }
    return false;
  }

  hasPending(): boolean {
    this.clearExpired();
    return this.pending !== null;
  }

  getPendingToolName(): string | null {
    this.clearExpired();
    return this.pending?.toolName ?? null;
  }

  reset(): void {
    this.pending = null;
  }
}

/**
 * 全局共享单例（刻意为之，勿改成 per-agent 实例）：
 * 子智能体的暂停确认依赖"用户消息到达主智能体 run() → onUserMessage 放行 →
 * 子智能体随后 consumeApproval"这条跨执行器链路。拆成实例会切断该链路，
 * 需等 Phase 2 重构为 Session 内一等公民的 AwaitingInput 后才能移除。
 */
const defaultGuard = new ConfirmationGuard();

export function consumeApproval(toolName: string, args: Record<string, unknown>): ApprovalGate {
  return defaultGuard.consumeApproval(toolName, args);
}

export function onUserMessage(message: string): void {
  defaultGuard.onUserMessage(message);
}

export function hasPending(): boolean {
  return defaultGuard.hasPending();
}

export function getPendingToolName(): string | null {
  return defaultGuard.getPendingToolName();
}

export function resetConfirmationGuard(): void {
  defaultGuard.reset();
}

/** 批准当前挂起操作（委派链路批准接力，见 approvePending） */
export function approvePendingApproval(): boolean {
  return defaultGuard.approvePending();
}