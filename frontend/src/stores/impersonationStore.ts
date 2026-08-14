import { create } from 'zustand';

interface ImpersonationState {
  version: number;
  bump: () => void;
}

export const useImpersonationStore = create<ImpersonationState>()((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));