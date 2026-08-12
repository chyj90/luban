import { useEffect, useRef, useMemo } from 'react';
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
  const codePageRef = useRef(codePage);
  codePageRef.current = codePage;
  const { buildShellScript, buildBridgeContent } = useQueryBridge(queries, userInfo, allPages, onNavigate);

  const queryNames = useMemo(() => queries.map((q) => q.name), [queries]);

  // Build shell once — all CDN libs are loaded lazily by the shell script
  useEffect(() => {
    if (shellBuiltRef.current) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

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
  }, [buildShellScript, queryNames]);

  // Listen for SHELL_READY from the iframe, send initial page on first ready
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'SHELL_READY' && e.source === iframeRef.current?.contentWindow) {
        const wasNotReady = !shellReadyRef.current;
        shellReadyRef.current = true;
        if (wasNotReady) {
          const cp = codePageRef.current;
          iframeRef.current?.contentWindow?.postMessage({
            type: 'UPDATE_PAGE',
            css: cp.css || '',
            html: cp.html || '',
            js: cp.js || '',
            libraries: cp.libraries || [],
          }, '*');
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

    iframe.contentWindow?.postMessage({
      type: 'UPDATE_PAGE',
      css: codePage.css || '',
      html: codePage.html || '',
      js: codePage.js || '',
      libraries: codePage.libraries || [],
    }, '*');
  }, [codePage]);

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
    <div className="preview-iframe-wrap">
      <iframe
        ref={iframeRef}
        title="preview"
        sandbox="allow-scripts allow-same-origin"
        className="preview-iframe"
      />
    </div>
  );
}