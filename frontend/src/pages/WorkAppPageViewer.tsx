import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useLoadingStore } from '@/stores/loadingStore';
import { getCodePage } from '@/api/page';
import { listQueries } from '@/api/query';
import { listAppTools, listApplicationTools } from '@/api/tool';
import { getApplication } from '@/api/application';
import type { CodePageData } from '@/types/page';
import type { Query } from '@/types/query';
import { useQueryBridge } from '@/hooks/useQueryBridge';
import './AppEntry/AppUserPage.css';

export function WorkAppPageViewer() {
  const { appId, pageId } = useParams<{ appId: string; pageId: string }>();
  const { user } = useAuthStore();
  const setGlobalLoading = useLoadingStore((s) => s.setLoading);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const shellReadyRef = useRef(false);
  const codePageRef = useRef<CodePageData | null>(null);

  const [queries, setQueries] = useState<Query[]>([]);
  const [loading, setLoading] = useState(true);
  const [appName, setAppName] = useState('');
  const [appTools, setAppTools] = useState<Array<{ id: number; name: string }>>([]);

  const userInfo = user ? { id: user.id, account: user.account || '', email: user.email || '' } : null;
  const pid = pageId ? Number(pageId) : null;
  const aid = appId ? Number(appId) : null;
  const { buildShellScript, buildBridgeContent } = useQueryBridge(
    queries, userInfo, [{ id: pid || 0, name: appName }], () => {}, aid, appTools,
  );

  const queryNames = queries.map(q => q.name);

  useEffect(() => {
    setGlobalLoading(loading);
  }, [loading, setGlobalLoading]);

  useEffect(() => {
    if (!aid || !pid) return;
    setLoading(true);
    Promise.allSettled([
      getApplication(aid),
      listQueries(aid),
      listAppTools(aid),
      listApplicationTools(aid),
    ]).then((results) => {
      const [appResult, queriesResult, toolsResult, keyToolsResult] = results;
      if (appResult.status === 'fulfilled') {
        setAppName(appResult.value.data.name);
      }
      if (queriesResult.status === 'fulfilled') {
        setQueries(queriesResult.value.data);
      }
      if (toolsResult.status === 'fulfilled' || keyToolsResult.status === 'fulfilled') {
        const selfTools = toolsResult.status === 'fulfilled'
          ? ((toolsResult.value.data as Record<string, unknown>[]) || []).map((t) => ({ id: t.id as number, name: (t.displayName || t.name || '') as string }))
          : [];
        const keyTools = keyToolsResult.status === 'fulfilled'
          ? ((keyToolsResult.value.data as Record<string, unknown>[]) || []).map((t) => ({ id: t.id as number, name: (t.displayName || t.name || '') as string }))
          : [];
        const merged = [...selfTools, ...keyTools.filter(kt => !selfTools.some(st => st.id === kt.id))];
        setAppTools(merged);
      }
      setLoading(false);
    });
  }, [aid, pid]);

  const sendPageToIframe = useCallback((cp: CodePageData) => {
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

  useEffect(() => {
    if (!pid) return;
    getCodePage(Number(pid)).then(res => {
      codePageRef.current = res.data.codePage;
      if (shellReadyRef.current) {
        sendPageToIframe(res.data.codePage);
      }
    });
  }, [pid, sendPageToIframe]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style id="__page_style__"></style>
  ${buildShellScript(queryNames)}
</head>
<body>
  <div id="__app_root__"></div>
  <script>
    let __page_ready__ = false;
    window.addEventListener('message', function(e) {
      if (e.data.type === 'UPDATE_PAGE') {
        var style = document.getElementById('__page_style__');
        if (style) style.textContent = e.data.css || '';
        var root = document.getElementById('__app_root__');
        if (root) root.innerHTML = e.data.html || '';
        if (e.data.libraries) {
          e.data.libraries.forEach(function(lib) {
            if (lib) {
              var script = document.createElement('script');
              script.src = lib;
              document.head.appendChild(script);
            }
          });
        }
        if (e.data.bridgeScript) {
          var bridgeScript = document.createElement('script');
          bridgeScript.textContent = e.data.bridgeScript;
          document.head.appendChild(bridgeScript);
        }
        if (e.data.js) {
          try {
            var fn = new Function(e.data.js);
            fn();
            __page_ready__ = true;
          } catch(err) {
            console.error('Page script error:', err);
          }
        }
      }
    });
    window.parent.postMessage({ type: 'SHELL_READY' }, '*');
  </script>
</body>
</html>`;

    iframe.srcdoc = html;

    const handler = (e: MessageEvent) => {
      if (e.data.type === 'SHELL_READY') {
        shellReadyRef.current = true;
        if (codePageRef.current) {
          sendPageToIframe(codePageRef.current);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [queryNames, buildShellScript, sendPageToIframe]);

  if (loading) return null;

  return (
    <div className="appuser" style={{ padding: 0 }}>
      <div className="appuser-page">
        {pid ? (
          <iframe
            ref={iframeRef}
            title="应用页面"
            className="appuser-iframe"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        ) : (
          <div className="appuser-empty">
            <p>请选择一个页面</p>
          </div>
        )}
      </div>
    </div>
  );
}