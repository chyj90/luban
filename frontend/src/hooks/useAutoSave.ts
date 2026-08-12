import { useEffect, useRef, useCallback } from 'react';
import { updateCodePage } from '@/api';

export function useAutoSave(pageId: number | null, delay = 1000) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Record<string, string>>({});

  const debouncedSave = useCallback(
    (type: string, value: string) => {
      pendingRef.current[type] = value;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        if (!pageId) return;
        const pending = { ...pendingRef.current };
        pendingRef.current = {};
        try {
          await updateCodePage(pageId, pending);
        } catch {
          // restore pending on failure
          pendingRef.current = { ...pending, ...pendingRef.current };
        }
      }, delay);
    },
    [pageId, delay]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return debouncedSave;
}