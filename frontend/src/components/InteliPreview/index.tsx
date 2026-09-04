import { useEffect, useRef, useMemo, useCallback } from 'react';
import type { CodePageData } from '@/types/page';
import type { Query } from '@/types/query';
import { useQueryBridge } from '@/hooks/useQueryBridge';
import { LUBAN_UI_CSS, LUBAN_UI_JS, ECHARTS_SOURCE } from '@/luban-ui';
import './InteliPreview.css';

interface InteliPreviewProps {
  codePage: CodePageData;
  queries: Query[];
  userInfo?: { id: number; account: string; email: string } | null;
  allPages?: Array<{ id: number; name: string }>;
  onNavigate?: (pageId: number) => void;
  applicationId?: number;
  appTools?: Array<{ id: number; name: string }>;
}

export function InteliPreview({ codePage, queries, userInfo, allPages, onNavigate, applicationId, appTools }: InteliPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const shellReadyRef = useRef(false);
  const shellBuiltRef = useRef(false);
  const lastQueryNamesRef = useRef<string[]>([]);
  const codePageRef = useRef(codePage);
  codePageRef.current = codePage;
  const { buildShellScript, buildBridgeContent } = useQueryBridge(queries, userInfo, allPages, onNavigate, applicationId, appTools);

  const queryNames = useMemo(() => queries.map((q) => q.name), [queries]);
  const queryNamesRef = useRef(queryNames);
  queryNamesRef.current = queryNames;

  const sendUpdatePage = useCallback((cp: CodePageData) => {
    const iframe = iframeRef.current;
    if (!iframe || !shellReadyRef.current || !cp) return;
    iframe.contentWindow?.postMessage({
      type: 'UPDATE_PAGE',
      css: cp.css || '',
      html: cp.html || '',
      js: cp.js || '',
      libraries: cp.libraries || [],
      bridgeScript: buildBridgeContent(queryNamesRef.current),
    }, '*');
  }, [buildBridgeContent]);

  const sendUpdatePageRef = useRef(sendUpdatePage);
  sendUpdatePageRef.current = sendUpdatePage;

  // Build shell — rebuild when queryNames changes
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
  <style id="__luban_ui__">${LUBAN_UI_CSS}</style>
  ${buildShellScript(queryNames)}
</head>
<body>
  <div id="__page_root__"></div>
  <script id="__luban_ui_js__">${LUBAN_UI_JS}</script>
  <script id="__echarts__">${ECHARTS_SOURCE}</script>
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
          sendUpdatePageRef.current(codePageRef.current);
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

    sendUpdatePageRef.current(codePage);
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

  // Push LubanUI CSS/JS into the iframe when shell is ready
  // (ensures the iframe always has the latest CSS/JS, even without shell rebuild)
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !shellReadyRef.current) return;

    iframe.contentWindow?.postMessage({
      type: 'UPDATE_CSS',
      css: LUBAN_UI_CSS,
    }, '*');
  }, [LUBAN_UI_CSS]);

  return (
    <div className="ip-frame-wrap">
      <iframe
        ref={iframeRef}
        title="preview"
        sandbox="allow-scripts allow-same-origin allow-modals"
        className="ip-frame"
      />
    </div>
  );
}