import { create } from 'zustand';
import type { AgentState, Message, Plan, Step, SessionStatus } from '@/types/agent';
import { persist } from 'zustand/middleware';

interface AgentStore extends AgentState {
  setStatus: (status: SessionStatus) => void;
  setStreaming: (isStreaming: boolean) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  removeMessage: (id: string) => void;
  addPlan: (plan: Plan) => void;
  updatePlan: (id: string, updates: Partial<Plan>) => void;
  updateStep: (planId: string, stepId: string, updates: Partial<Step>) => void;
  setFocusPlan: (planId: string | null) => void;
  confirmPlan: (planId: string) => void;
  rejectPlan: (planId: string) => void;
  stopPlan: (planId: string) => void;
  setError: (error: string | null) => void;
  reset: () => void;
  generateSessionId: () => void;
}

const initialState: AgentState = {
  sessionId: '',
  status: 'idle',
  messages: [],
  plans: [],
  currentPlanId: null,
  focusPlanId: null,
  executingStepId: null,
  isStreaming: false,
  error: null,
};

export const useAgentStore = create<AgentStore>()(
  persist(
    (set) => ({
      ...initialState,
      generateSessionId: () =>
        set({ sessionId: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }),
      setStatus: (status) => set({ status }),
      setStreaming: (isStreaming) => set({ isStreaming }),
      addMessage: (message) =>
        set((state) => ({ messages: [...state.messages, message] })),
      updateMessage: (id, updates) =>
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === id ? { ...m, ...updates } : m,
          ),
        })),
      removeMessage: (id) =>
        set((state) => ({
          messages: state.messages.filter((m) => m.id !== id),
        })),
      addPlan: (plan) =>
        set((state) => {
          const others = state.plans.filter(
            (p) => p.agentId !== plan.agentId || p.id === plan.id,
          );
          return {
            plans: [...others, plan],
            currentPlanId: plan.id,
            focusPlanId: plan.id,
          };
        }),
      updatePlan: (id, updates) =>
        set((state) => ({
          plans: state.plans.map((p) =>
            p.id === id ? { ...p, ...updates } : p,
          ),
        })),
      updateStep: (planId, stepId, updates) =>
        set((state) => ({
          plans: state.plans.map((p) =>
            p.id === planId
              ? {
                  ...p,
                  steps: p.steps.map((s) =>
                    s.id === stepId ? { ...s, ...updates } : s,
                  ),
                }
              : p,
          ),
        })),
      setFocusPlan: (planId) => set({ focusPlanId: planId }),
      confirmPlan: (planId) =>
        set((state) => ({
          plans: state.plans.map((p) =>
            p.id === planId ? { ...p, status: 'confirmed' } : p,
          ),
          status: 'idle',
        })),
      rejectPlan: (planId) =>
        set((state) => ({
          plans: state.plans.map((p) =>
            p.id === planId ? { ...p, status: 'rejected' } : p,
          ),
          status: 'idle',
        })),
      stopPlan: (planId) =>
        set((state) => ({
          plans: state.plans.map((p) =>
            p.id === planId ? { ...p, status: 'stopped' } : p,
          ),
          status: 'idle',
        })),
      setError: (error) => set({ error, status: error ? 'error' : 'idle' }),
      reset: () => set(initialState),
    }),
    {
      name: 'luban-agent-state',
      partialize: (state) => ({
        messages: state.messages,
        plans: state.plans,
        currentPlanId: state.currentPlanId,
        focusPlanId: state.focusPlanId,
        sessionId: state.sessionId,
      }),
    },
  ),
);