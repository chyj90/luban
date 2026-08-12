import { create } from 'zustand';
import type { Workspace } from '@/types/workspace';
import { listWorkspaces, createWorkspace } from '@/api';

interface WorkspaceState {
  workspaces: Workspace[];
  loading: boolean;
  error: string | null;
  fetchWorkspaces: () => Promise<void>;
  addWorkspace: (name: string) => Promise<Workspace>;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  loading: false,
  error: null,
  fetchWorkspaces: async () => {
    set({ loading: true, error: null });
    try {
      const res = await listWorkspaces();
      set({ workspaces: res.data });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ loading: false });
    }
  },
  addWorkspace: async (name) => {
    const res = await createWorkspace(name);
    set((state) => ({ workspaces: [...state.workspaces, res.data] }));
    return res.data;
  },
}));