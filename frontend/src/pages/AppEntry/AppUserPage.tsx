import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useLoadingStore } from '@/stores/loadingStore';
import { listPages } from '@/api/page';
import { getCodePage } from '@/api/page';
import { listQueries } from '@/api/query';
import { workflowApi } from '@/api/workflow';
import { isImpersonating } from '@/utils/impersonation';
import { DevToolbar } from '@/components/DevToolbar';
import type { Application } from '@/types/application';
import type { Page, CodePageData } from '@/types/page';
import type { Query } from '@/types/query';
import type { WorkflowDefinition } from '@/types/workflow';
import { useQueryBridge } from '@/hooks/useQueryBridge';
import MyWorkflow from '@/pages/workflow/MyWorkflow';
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

  const [pages, setPages] = useState<Page[]>([]);
  const [currentPageId, setCurrentPageId] = useState<number | null>(null);
  const [queries, setQueries] = useState<Query[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [showWorkflow, setShowWorkflow] = useState(isImpersonating());
  const [loading, setLoading] = useState(true);

  const userInfo = user ? { id: user.id, name: user.name || '', email: user.email || '' } : null;
  const pageList = pages.map(p => ({ id: p.id, name: p.name }));
  const { buildShellScript, buildBridgeContent } = useQueryBridge(queries, userInfo, pageList, handlePageNavigate);

  function handlePageNavigate(pageId: number) {
    setCurrentPageId(pageId);
  }

  const queryNames = queries.map(q => q.name);

  useEffect(() => {
    if (!app.id) return;

    Promise.allSettled([
      listPages(app.id),
      listQueries(app.id),
      workflowApi.listDefinitions({ applicationId: app.id, status: isImpersonating() ? 'DRAFT' : 'PUBLISHED' }),
    ]).then((results) => {
      const [pagesResult, queriesResult, wfResult] = results;

      if (pagesResult.status === 'fulfilled') {
        setPages(pagesResult.value.data);
        if (pagesResult.value.data.length > 0) {
          const defaultPage = pagesResult.value.data.find((p: Page) => p.isDefault) || pagesResult.value.data[0];
          setCurrentPageId(defaultPage.id);
        }
      }
      if (queriesResult.status === 'fulfilled') {
        setQueries(queriesResult.value.data);
      }
      if (wfResult.status === 'fulfilled') {
        setWorkflows(wfResult.value);
      }
      setLoading(false);
    });
  }, [app.id]);

  // Load code page content when currentPageId changes
  useEffect(() => {
    if (!currentPageId) return;
    getCodePage(currentPageId).then(res => {
      codePageRef.current = res.data.codePage;
      if (shellReadyRef.current) {
        sendPageToIframe(res.data.codePage);
      }
    });
  }, [currentPageId]);

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
          sendPageToIframe(codePageRef.current);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [queryNames, buildShellScript, sendPageToIframe]);

  useEffect(() => {
    setGlobalLoading(loading);
  }, [loading, setGlobalLoading]);

  if (loading) return null;

  return (
    <div className="appuser">
      {isImpersonating() && <DevToolbar appId={app.id} />}
      {/* 页面标签 + 我的工作 */}
      <div className="appuser-tabs">
        <div className="appuser-tabs-left">
          <div
            className={`appuser-tab ${showWorkflow ? 'active' : ''}`}
            onClick={() => { setShowWorkflow(true); setCurrentPageId(null); }}
          >
            我的工作
          </div>
          {pages.map(page => (
            <div
              key={page.id}
              className={`appuser-tab ${!showWorkflow && currentPageId === page.id ? 'active' : ''}`}
              onClick={() => { setCurrentPageId(page.id); setShowWorkflow(false); }}
            >
              {page.name}
            </div>
          ))}
        </div>
      </div>

      {/* 页面内容区 */}
      <div className="appuser-page">
        {showWorkflow ? (
          <MyWorkflow embedded workflows={workflows} appId={app.id} />
        ) : currentPageId ? (
          <iframe
            ref={iframeRef}
            title="应用页面"
            className="appuser-iframe"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <div className="appuser-empty">
            {pages.length === 0 ? (
              <p>该应用暂无页面</p>
            ) : (
              <p>请选择一个页面</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}