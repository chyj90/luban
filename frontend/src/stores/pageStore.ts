import { create } from 'zustand';
import type { CodePage } from '@/types/page';
import { getCodePage, updateCodePage } from '@/api';

interface PageState {
  currentPage: CodePage | null;
  loading: boolean;
  error: string | null;
  fetchPage: (pageId: number) => Promise<void>;
  updatePage: (pageId: number, data: { html?: string; css?: string; js?: string }) => Promise<void>;
}

export const usePageStore = create<PageState>((set) => ({
  currentPage: null,
  loading: false,
  error: null,
  fetchPage: async (pageId) => {
    set({ loading: true, error: null });
    try {
      const res = await getCodePage(pageId);
      set({ currentPage: res.data });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ loading: false });
    }
  },
  updatePage: async (pageId, data) => {
    const res = await updateCodePage(pageId, data);
    set({ currentPage: res.data });
  },
}));