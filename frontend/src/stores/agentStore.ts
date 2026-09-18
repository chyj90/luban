import { create } from 'zustand';
import type { AgentState, AttachmentMeta, Message, Plan, Step, SessionStatus } from '@/types/agent';
import { planConfirmMessage } from '@/agent/kernel/planPolicy';

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
  setPendingInput: (pending: { kind: string; message: string; planId?: string; toolName?: string; args?: Record<string, unknown> } | null) => void;
  setOrphanedPending: (message: string) => void;
  clearOrphanedPending: () => void;
  addPendingAttachment: (attachment: AttachmentMeta) => void;
  updatePendingAttachment: (fileId: string, updates: Partial<AttachmentMeta>) => void;
  removePendingAttachment: (fileId: string) => void;
  clearPendingAttachments: () => void;
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
  pendingInput: null,
  orphanedPending: null,
  pendingAttachments: [],
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
    const persistedPlans = persisted.plans || [];
    // pendingInput 只存内存不持久化：硬刷新后确认横幅会丢，但 draft 计划已持久化。
    // 从最后一个 draft 重建确认横幅，让"确认计划"按钮路径（显式 ResumeCommand）在
    // 新会话中仍然可用，而不是降级成文本猜意图——这正是 2026-09-17 请假案例的死锁根源
    const drafts = persistedPlans.filter((p) => p.status === 'draft');
    const lastDraft = drafts.length > 0 ? drafts[drafts.length - 1] : null;
    set({
      appId,
      messages: persisted.messages || [],
      plans: persistedPlans,
      currentPlanId: persisted.currentPlanId ?? null,
      focusPlanId: persisted.focusPlanId ?? null,
      sessionId: persisted.sessionId || '',
      status: 'idle',
      isStreaming: false,
      executingStepId: null,
      error: null,
      pendingInput: lastDraft
        ? { kind: 'plan-confirm', planId: lastDraft.id, message: planConfirmMessage(lastDraft) }
        : null,
      orphanedPending: null,
      // 切应用即作废未发送的附件（文件本体已在服务端，可重新选择）
      pendingAttachments: [],
    });
  },

  generateSessionId: () =>
    set({ sessionId: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }),

  setStatus: (status) => set({ status }),
  setStreaming: (isStreaming) => set({ isStreaming }),

  addMessage: (message) =>
    set((state) => {
      // createdAt 记录首次入列时间；聚合消息（plan）后续只刷新 timestamp
      const enriched = message.createdAt ? message : { ...message, createdAt: Date.now() };
      const newMessages = [...state.messages, enriched];
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
    set((state) => {
      const plans = state.plans.map((p) =>
        p.id === id ? { ...p, ...updates } : p,
      );
      // 计划状态变更必须落盘：确认/放弃若只改内存，硬刷新后会回退成 draft，
      // 重建的确认横幅会诱导用户对已确认的计划再次确认
      if (state.appId !== null) {
        saveToStorage(state.appId, {
          messages: state.messages,
          plans,
          currentPlanId: state.currentPlanId,
          focusPlanId: state.focusPlanId,
          sessionId: state.sessionId,
        });
      }
      return { plans };
    }),

  updateStep: (planId, stepId, updates) =>
    set((state) => ({
      plans: state.plans.map((p) =>
        p.id === planId
          ? {
              ...p,
              steps: p.steps.map((s) =>
                String(s.id) === String(stepId) ? { ...s, ...updates } : s,
              ),
            }
          : p,
      ),
    })),

  setFocusPlan: (planId) => set({ focusPlanId: planId }),

  confirmPlan: (planId) => {
    get().updatePlan(planId, { status: 'confirmed' });
    set({ status: 'idle' });
  },

  rejectPlan: (planId) => {
    get().updatePlan(planId, { status: 'rejected' });
    set({ status: 'idle' });
  },

  stopPlan: (planId) => {
    get().updatePlan(planId, { status: 'stopped' });
    set({ status: 'idle' });
  },

  setError: (error) => set({ error, status: error ? 'error' : 'idle' }),
  setPendingInput: (pendingInput) => set({ pendingInput }),

  setOrphanedPending: (message) => set({ orphanedPending: message }),
  clearOrphanedPending: () => set({ orphanedPending: null }),

  addPendingAttachment: (attachment) =>
    set((state) => ({ pendingAttachments: [...state.pendingAttachments, attachment] })),
  updatePendingAttachment: (fileId, updates) =>
    set((state) => ({
      pendingAttachments: state.pendingAttachments.map((a) =>
        a.fileId === fileId ? { ...a, ...updates } : a,
      ),
    })),
  removePendingAttachment: (fileId) =>
    set((state) => ({
      pendingAttachments: state.pendingAttachments.filter((a) => a.fileId !== fileId),
    })),
  clearPendingAttachments: () => set({ pendingAttachments: [] }),

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