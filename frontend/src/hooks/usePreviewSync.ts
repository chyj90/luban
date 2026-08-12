import { useCallback, useRef } from 'react';
import type { CodePageData } from '@/types/page';

export function usePreviewSync() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const updatePreview = useCallback((codePage: CodePageData) => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const libraries = codePage.libraries || [];
    const libScripts = libraries
      .map((url) => `<script src="${url}"></script>`)
      .join('\n');

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${codePage.css || ''}</style>
  ${libScripts}
</head>
<body>
  ${codePage.html || ''}
  <script>${codePage.js || ''}</script>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    iframe.src = url;

    return () => URL.revokeObjectURL(url);
  }, []);

  return { iframeRef, updatePreview };
}