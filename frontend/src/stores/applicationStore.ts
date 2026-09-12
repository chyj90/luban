import { create } from 'zustand';
import type { Application } from '@/types/application';
import { listApplications, createApplication, deleteApplication } from '@/api';

interface ApplicationState {
  applications: Application[];
  loading: boolean;
  error: string | null;
  fetchApplications: () => Promise<void>;
  addApplication: (name: string) => Promise<Application>;
  removeApplication: (id: number) => Promise<void>;
}

export const useApplicationStore = create<ApplicationState>((set) => ({
  applications: [],
  loading: false,
  error: null,
  fetchApplications: async () => {
    set({ loading: true, error: null });
    try {
      const res = await listApplications();
      set({ applications: res.data });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ loading: false });
    }
  },
  addApplication: async (name) => {
    const res = await createApplication({ name });
    set((state) => ({ applications: [...state.applications, res.data] }));
    return res.data;
  },
  removeApplication: async (id) => {
    await deleteApplication(id);
    set((state) => ({ applications: state.applications.filter((app) => app.id !== id) }));
  },
}));