import { useEffect, useRef, useMemo, useCallback, useState, type CSSProperties } from 'react';
import type { CodePageData } from '@/types/page';
import type { Query } from '@/types/query';
import { useQueryBridge, type UserInfo } from '@/hooks/useQueryBridge';
import { LUBAN_UI_CSS, LUBAN_UI_JS, ECHARTS_SOURCE, ECHARTS_GL_SOURCE, LEAFLET_SOURCE } from '@/luban-ui';
import './InteliPreview.css';

interface InteliPreviewProps {
  codePage: CodePageData;
  queries: Query[];
  userInfo?: UserInfo | null;
  allPages?: Array<{ id: number; name: string }>;
  onNavigate?: (pageId: number) => void;
  applicationId?: number;
  appTools?: Array<{ id: number; name: string }>;
  /**
   * 预览视口宽度（设计画布宽度）。传入时 iframe 以该宽度渲染再等比缩放适配面板，
   * 保证媒体查询断点（如 1200px）下开发预览与运行时结构一致（所见即所得）；
   * 不传则按面板实际宽度渲染（历史行为）。
   */
  designWidth?: number;
}

export function InteliPreview({ codePage, queries, userInfo, allPages, onNavigate, applicationId, appTools, designWidth }: InteliPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const shellReadyRef = useRef(false);
  const shellBuiltRef = useRef(false);
  const lastQueryNamesRef = useRef<string[]>([]);
  const pageMsgSeqRef = useRef(0);
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
      // applyPage 在 iframe 内是异步执行（外部库/地图/DOMContentLoaded 都会延迟），
      // 连续切页时靠 seq 让 iframe 丢弃迟到的过期应用，避免旧页面覆盖新页面
      seq: ++pageMsgSeqRef.current,
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
  <script id="__leaflet_src__" type="text/plain">${LEAFLET_SOURCE}</script>
  <script id="__echarts_gl__">${ECHARTS_GL_SOURCE}</script>
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

  // 设计画布预览：面板宽度 ≠ 运行时视口宽度时，媒体查询会让开发/使用两种视图结构不一致
  // （如 1200px 断点一侧上下堆叠、一侧左右分栏）。以固定画布宽渲染再 scale 适配面板即可对齐。
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapSize, setWrapSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !designWidth) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setWrapSize({ width: rect.width, height: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [designWidth]);

  const scale = designWidth && wrapSize.width > 0 ? wrapSize.width / designWidth : 1;
  const scalerStyle: CSSProperties | undefined = designWidth
    ? {
        width: designWidth,
        height: wrapSize.height > 0 ? wrapSize.height / scale : '100%',
        transform: `scale(${scale})`,
      }
    : undefined;

  return (
    <div className="ip-frame-wrap" ref={wrapRef}>
      <div className="ip-frame-scaler" style={scalerStyle}>
        <iframe
          ref={iframeRef}
          title="preview"
          sandbox="allow-scripts allow-same-origin allow-modals"
          className="ip-frame"
        />
      </div>
    </div>
  );
}