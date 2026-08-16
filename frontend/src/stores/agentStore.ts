import { create } from 'zustand';
import type { AgentState, Message, Plan, Step, SessionStatus } from '@/types/agent';

const STORAGE_PREFIX = 'luban-agent-state';

function getStorageKey(appId: number): string {
  return `${STORAGE_PREFIX}-${appId}`;
}

interface PersistedState {
  messages: Message[];
  plans: Plan[];
  currentPlanId: string | null;
  focusPlanId: string | null;
  sessionId: string;
}

function loadFromStorage(appId: number): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(getStorageKey(appId));
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore parse error
  }
  return {};
}

function saveToStorage(appId: number, state: Partial<PersistedState>): void {
  try {
    localStorage.setItem(getStorageKey(appId), JSON.stringify(state));
  } catch {
    // ignore storage full
  }
}

interface AgentStore extends AgentState {
  appId: number | null;
  setAppId: (appId: number) => void;
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

const initialAgentState: AgentState = {
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

export const useAgentStore = create<AgentStore>()((set, get) => ({
  ...initialAgentState,
  appId: null,

  setAppId: (appId: number) => {
    const current = get();
    if (current.appId === appId) return;

    // 保存当前应用状态到 localStorage
    if (current.appId !== null) {
      saveToStorage(current.appId, {
        messages: current.messages,
        plans: current.plans,
        currentPlanId: current.currentPlanId,
        focusPlanId: current.focusPlanId,
        sessionId: current.sessionId,
      });
    }

    // 加载新应用状态
    const persisted = loadFromStorage(appId);
    set({
      appId,
      messages: persisted.messages || [],
      plans: persisted.plans || [],
      currentPlanId: persisted.currentPlanId ?? null,
      focusPlanId: persisted.focusPlanId ?? null,
      sessionId: persisted.sessionId || '',
      status: 'idle',
      isStreaming: false,
      executingStepId: null,
      error: null,
    });
  },

  generateSessionId: () =>
    set({ sessionId: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }),

  setStatus: (status) => set({ status }),
  setStreaming: (isStreaming) => set({ isStreaming }),

  addMessage: (message) =>
    set((state) => {
      const newMessages = [...state.messages, message];
      if (state.appId !== null) {
        saveToStorage(state.appId, {
          messages: newMessages,
          plans: state.plans,
          currentPlanId: state.currentPlanId,
          focusPlanId: state.focusPlanId,
          sessionId: state.sessionId,
        });
      }
      return { messages: newMessages };
    }),

  updateMessage: (id, updates) =>
    set((state) => {
      const newMessages = state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } : m,
      );
      return { messages: newMessages };
    }),

  removeMessage: (id) =>
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== id),
    })),

  addPlan: (plan) =>
    set((state) => {
      const others = state.plans.filter(
        (p) => p.agentId !== plan.agentId || p.id === plan.id,
      );
      const newPlans = [...others, plan];
      if (state.appId !== null) {
        saveToStorage(state.appId, {
          messages: state.messages,
          plans: newPlans,
          currentPlanId: plan.id,
          focusPlanId: plan.id,
          sessionId: state.sessionId,
        });
      }
      return {
        plans: newPlans,
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

  reset: () => {
    const current = get();
    if (current.appId !== null) {
      saveToStorage(current.appId, {
        messages: [],
        plans: [],
        currentPlanId: null,
        focusPlanId: null,
        sessionId: '',
      });
    }
    set({ ...initialAgentState, appId: current.appId });
  },
}));