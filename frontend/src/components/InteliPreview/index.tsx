import { useEffect, useRef, useMemo, useCallback } from 'react';
import type { CodePageData } from '@/types/page';
import type { Query } from '@/types/query';
import { useQueryBridge } from '@/hooks/useQueryBridge';
import './InteliPreview.css';

interface InteliPreviewProps {
  codePage: CodePageData;
  queries: Query[];
  userInfo?: { id: number; name: string; email: string } | null;
  allPages?: Array<{ id: number; name: string }>;
  onNavigate?: (pageId: number) => void;
}

export function InteliPreview({ codePage, queries, userInfo, allPages, onNavigate }: InteliPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const shellReadyRef = useRef(false);
  const shellBuiltRef = useRef(false);
  const lastQueryNamesRef = useRef<string[]>([]);
  const codePageRef = useRef(codePage);
  codePageRef.current = codePage;
  const { buildShellScript, buildBridgeContent } = useQueryBridge(queries, userInfo, allPages, onNavigate);

  const queryNames = useMemo(() => queries.map((q) => q.name), [queries]);

  const sendUpdatePage = useCallback((cp: CodePageData) => {
    const iframe = iframeRef.current;
    if (!iframe || !shellReadyRef.current) return;
    iframe.contentWindow?.postMessage({
      type: 'UPDATE_PAGE',
      css: cp.css || '',
      html: cp.html || '',
      js: cp.js || '',
      libraries: cp.libraries || [],
      bridgeScript: buildBridgeContent(queryNames),
    }, '*');
  }, [queryNames, buildBridgeContent]);

  // Build shell — rebuild when queryNames changes (e.g., queries loaded after backend restart)
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const prevNames = lastQueryNamesRef.current;
    const namesChanged = prevNames.length !== queryNames.length ||
      prevNames.some((n, i) => n !== queryNames[i]);

    if (shellBuiltRef.current && !namesChanged) return;

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style id="__page_style__"></style>
  ${buildShellScript(queryNames)}
</head>
<body>
  <div id="__page_root__"></div>
</body>
</html>`;

    shellReadyRef.current = false;
    iframe.srcdoc = html;
    shellBuiltRef.current = true;
    lastQueryNamesRef.current = [...queryNames];
  }, [buildShellScript, queryNames]);

  // Listen for SHELL_READY from the iframe, send initial page on first ready
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'SHELL_READY' && e.source === iframeRef.current?.contentWindow) {
        const wasNotReady = !shellReadyRef.current;
        shellReadyRef.current = true;
        if (wasNotReady) {
          const cp = codePageRef.current;
          sendUpdatePage(cp);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Update page content when codePage changes
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !shellReadyRef.current) return;

    sendUpdatePage(codePage);
  }, [codePage, sendUpdatePage]);

  // Update bridge (query globals) when queries change
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !shellReadyRef.current) return;

    iframe.contentWindow?.postMessage({
      type: 'UPDATE_BRIDGE',
      script: buildBridgeContent(queryNames),
    }, '*');
  }, [queryNames, buildBridgeContent]);

  return (
    <div className="ip-frame-wrap">
      <iframe
        ref={iframeRef}
        title="preview"
        sandbox="allow-scripts allow-same-origin"
        className="ip-frame"
      />
    </div>
  );
}