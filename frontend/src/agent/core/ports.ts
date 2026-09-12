import type { Message, Plan } from '@/types/agent';

export interface IStoreReader {
  getPlans(): Plan[];
  getMessages(): Message[];
  getFocusPlanId(): string | null;
  confirmPlan(planId: string): void;
  setFocusPlan(planId: string | null): void;
  updatePlan(planId: string, updates: Partial<Plan>): void;
}