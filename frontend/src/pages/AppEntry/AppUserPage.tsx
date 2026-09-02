import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useLoadingStore } from '@/stores/loadingStore';
import { listPages } from '@/api/page';
import { getCodePage } from '@/api/page';
import { listQueries } from '@/api/query';
import { listApplicationTools } from '@/api/tool';
import type { Application } from '@/types/application';
import type { Page, CodePageData } from '@/types/page';
import type { Query } from '@/types/query';
import { useQueryBridge } from '@/hooks/useQueryBridge';
import './AppUserPage.css';

interface AppUserPageProps {
  app: Application;
}

export function AppUserPage({ app }: AppUserPageProps) {
  const { user } = useAuthStore();
  const setGlobalLoading = useLoadingStore((s) => s.setLoading);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const shellReadyRef = useRef(false);
  const codePageRef = useRef<CodePageData | null>(null);
  const sendPageToIframeRef = useRef<((cp: CodePageData) => void) | null>(null);

  const [pages, setPages] = useState<Page[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPageId, setCurrentPageId] = useState<number | null>(null);
  const [queries, setQueries] = useState<Query[]>([]);
  const [loading, setLoading] = useState(true);
  const [appTools, setAppTools] = useState<Array<{ id: number; name: string }>>([]);

  const userInfo = useMemo(() => {
    return user ? { id: user.id, account: user.account || '', email: user.email || '' } : null;
  }, [user?.id, user?.account, user?.email]);
  const pageList = useMemo(() => pages.map(p => ({ id: p.id, name: p.name })), [pages]);
  const { buildShellScript, buildBridgeContent } = useQueryBridge(queries, userInfo, pageList, handlePageNavigate, app.id, appTools, currentPageId);

  function handlePageNavigate(pageId: number) {
    const target = pages.find(p => p.id === pageId);
    if (target && target.accessible === false) {
      const firstAccessible = pages.find(p => p.accessible !== false);
      if (firstAccessible) {
        setCurrentPageId(firstAccessible.id);
      }
      return;
    }
    setCurrentPageId(pageId);
  }

  const queryNames = useMemo(() => queries.map(q => q.name), [queries]);

  useEffect(() => {
    if (!app.id) return;

    Promise.allSettled([
      listPages(app.id),
      listQueries(app.id),
      listApplicationTools(app.id),
    ]).then((results) => {
      const [pagesResult, queriesResult, toolsResult] = results;

      if (pagesResult.status === 'fulfilled') {
        const allPages = pagesResult.value.data as Page[];
        setTotalPages(allPages.length);
        const accessiblePages = allPages.filter(p => p.accessible !== false);
        setPages(accessiblePages);
        if (accessiblePages.length > 0) {
          const defaultPage = accessiblePages.find((p: Page) => p.isDefault) || accessiblePages[0];
          setCurrentPageId(defaultPage.id);
        }
      }
      if (queriesResult.status === 'fulfilled') {
        setQueries(queriesResult.value.data);
      }
      if (toolsResult.status === 'fulfilled') {
        const tools = ((toolsResult.value.data as Record<string, unknown>[]) || [])
          .map((t) => ({ id: t.id as number, name: (t.displayName || t.toolName || '') as string }));
        setAppTools(tools);
      }
      setLoading(false);
    });
  }, [app.id]);

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
  sendPageToIframeRef.current = sendPageToIframe;

  // Load code page content when currentPageId changes
  useEffect(() => {
    if (!currentPageId) return;
    getCodePage(currentPageId).then(res => {
      codePageRef.current = res.data.codePage;
      if (shellReadyRef.current) {
        sendPageToIframe(res.data.codePage);
      }
    });
  }, [currentPageId, sendPageToIframe]);

  // Build shell iframe
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
          sendPageToIframeRef.current?.(codePageRef.current);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [queryNames, buildShellScript]);

  useEffect(() => {
    setGlobalLoading(loading);
  }, [loading, setGlobalLoading]);

  if (loading) return null;

  return (
    <div className="appuser">
      {/* 页面标签 */}
      <div className="appuser-tabs">
        <div className="appuser-tabs-left">
          {pages.map(page => (
            <div
              key={page.id}
              className={`appuser-tab ${currentPageId === page.id ? 'active' : ''}`}
              onClick={() => setCurrentPageId(page.id)}
            >
              {page.name}
            </div>
          ))}
        </div>
      </div>

      {/* 页面内容区 */}
      <div className="appuser-page">
        {currentPageId ? (
          <iframe
            ref={iframeRef}
            title="应用页面"
            className="appuser-iframe"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        ) : (
          <div className="appuser-empty">
            {pages.length === 0 ? (
                totalPages === 0 ? (
                  <p>该应用暂无页面，请联系管理员配置</p>
                ) : (
                  <p>您暂无访问此应用的权限，请联系管理员</p>
                )
              ) : (
              <p>请选择一个页面</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}