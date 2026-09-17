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

// 并发切页的竞态守卫：页面列表刷新与切到新建页面会几乎同时各发一次 getCodePage，
// 响应到达顺序不确定，过期响应不得覆盖更新的切页请求
let fetchSeq = 0;

export const usePageStore = create<PageState>((set) => ({
  currentPage: null,
  loading: false,
  error: null,
  fetchPage: async (pageId) => {
    const seq = ++fetchSeq;
    set({ loading: true, error: null });
    try {
      const res = await getCodePage(pageId);
      if (seq !== fetchSeq) return;
      set({ currentPage: res.data });
    } catch (e) {
      if (seq !== fetchSeq) return;
      set({ currentPage: null, error: (e as Error).message });
    } finally {
      if (seq === fetchSeq) set({ loading: false });
    }
  },
  updatePage: async (pageId, data) => {
    const res = await updateCodePage(pageId, data);
    set({ currentPage: res.data });
  },
}));