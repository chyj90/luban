import { useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { usePageStore } from '@/stores/pageStore';
import { useAgentStore } from '@/stores/agentStore';
import { listPages } from '@/api';

export function useAppEditor() {
  const { appId } = useParams<{ appId: string }>();
  const { currentPage, loading, fetchPage, updatePage } = usePageStore();
  const agentStore = useAgentStore();

  useEffect(() => {
    if (appId) {
      listPages(Number(appId)).then((res) => {
        const pages = res.data;
        if (pages.length > 0) {
          const defaultPage = pages.find((p) => p.isDefault) || pages[0];
          fetchPage(defaultPage.id);
        }
      });
    }
  }, [appId, fetchPage]);

  const handleCodeChange = useCallback(
    (type: 'html' | 'css' | 'js', value: string) => {
      if (!currentPage) return;
      updatePage(currentPage.id, { [type]: value });
    },
    [currentPage, updatePage]
  );

  return {
    appId: appId ? Number(appId) : null,
    currentPage,
    loading,
    agentStore,
    handleCodeChange,
  };
}