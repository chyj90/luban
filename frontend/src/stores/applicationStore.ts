import { create } from 'zustand';
import type { Application } from '@/types/application';
import { listApplications, createApplication, deleteApplication } from '@/api';

interface ApplicationState {
  applications: Application[];
  loading: boolean;
  error: string | null;
  fetchApplications: (workspaceId: number) => Promise<void>;
  addApplication: (workspaceId: number, name: string) => Promise<Application>;
  removeApplication: (id: number) => Promise<void>;
}

export const useApplicationStore = create<ApplicationState>((set) => ({
  applications: [],
  loading: false,
  error: null,
  fetchApplications: async (workspaceId) => {
    set({ loading: true, error: null });
    try {
      const res = await listApplications(workspaceId);
      set({ applications: res.data });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ loading: false });
    }
  },
  addApplication: async (workspaceId, name) => {
    const res = await createApplication({ workspaceId, name });
    set((state) => ({ applications: [...state.applications, res.data] }));
    return res.data;
  },
  removeApplication: async (id) => {
    await deleteApplication(id);
    set((state) => ({ applications: state.applications.filter((app) => app.id !== id) }));
  },
}));