import type { Message, Plan } from '@/types/agent';

export interface IStoreReader {
  getPlans(): Plan[];
  getMessages(): Message[];
  getFocusPlanId(): string | null;
  confirmPlan(planId: string): void;
  setFocusPlan(planId: string | null): void;
  updatePlan(planId: string, updates: Partial<Plan>): void;
  /** 会话失效时残留的挂起事项描述（降级注入用；AgentFactory 在下一次 run 时消费并清除） */
  getOrphanedPending?(): string | null;
  clearOrphanedPending?(): void;
}