import { useCallback, useEffect, useRef } from 'react';
import { runQuery } from '@/api';
import type { Query } from '@/types/query';

interface BridgeRequest {
  type: 'RUN_QUERY' | 'NAVIGATE_TO_PAGE' | 'NAVIGATE_TO_PAGE_BY_NAME';
  id: string;
  queryName?: string;
  params?: Record<string, unknown>;
  pageId?: number;
  pageName?: string;
}

interface BridgeResponse {
  type: 'QUERY_RESULT' | 'NAVIGATE_RESULT';
  id: string;
  queryName?: string;
  result?: { columns: string[]; rows: unknown[][]; totalCount: number };
  error?: string;
  success?: boolean;
}

interface UserInfo {
  id: number;
  name: string;
  email: string;
}

interface PageInfo {
  id: number;
  name: string;
}

export function useQueryBridge(
  queries: Query[],
  userInfo?: UserInfo | null,
  allPages?: PageInfo[],
  onNavigate?: (pageId: number) => void,
) {
  const queriesRef = useRef<Query[]>(queries);
  queriesRef.current = queries;

  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const allPagesRef = useRef<PageInfo[]>(allPages || []);
  allPagesRef.current = allPages || [];

  const handleMessage = useCallback(async (event: MessageEvent) => {
    const msg = event.data as BridgeRequest;
    if (!msg) return;

    const respond = (response: BridgeResponse) => {
      (event.source as Window).postMessage(response, '*');
    };

    if (msg.type === 'RUN_QUERY') {
      const query = queriesRef.current.find((q) => q.name === msg.queryName);

      if (!query) {
        respond({
          type: 'QUERY_RESULT',
          id: msg.id,
          queryName: msg.queryName,
          error: `查询 "${msg.queryName}" 不存在`,
        });
        return;
      }

      try {
        const res = await runQuery(query.id, { params: msg.params });
        respond({
          type: 'QUERY_RESULT',
          id: msg.id,
          queryName: msg.queryName,
          result: res.data,
        });
      } catch (e) {
        respond({
          type: 'QUERY_RESULT',
          id: msg.id,
          queryName: msg.queryName,
          error: (e as Error).message,
        });
      }
    } else if (msg.type === 'NAVIGATE_TO_PAGE') {
      if (msg.pageId && onNavigateRef.current) {
        onNavigateRef.current(msg.pageId);
        respond({ type: 'NAVIGATE_RESULT', id: msg.id, success: true });
      } else {
        respond({ type: 'NAVIGATE_RESULT', id: msg.id, success: false, error: 'pageId 无效' });
      }
    } else if (msg.type === 'NAVIGATE_TO_PAGE_BY_NAME') {
      const page = allPagesRef.current.find((p) => p.name === msg.pageName);
      if (page && onNavigateRef.current) {
        onNavigateRef.current(page.id);
        respond({ type: 'NAVIGATE_RESULT', id: msg.id, success: true });
      } else {
        respond({ type: 'NAVIGATE_RESULT', id: msg.id, success: false, error: `未找到页面 "${msg.pageName}"` });
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  const buildShellScript = useCallback((queryNames: string[]) => {
    const userJson = userInfo ? JSON.stringify(userInfo) : 'null';
    const allPagesJson = JSON.stringify(allPages || []);

    return `<script>
(function() {
  var _pending = {};
  var _results = {};
  var _loadedLibs = {};

  window.__bridge_pending = _pending;
  window.__bridge_results = _results;

  window.__LUBAN_USER__ = ${userJson};

  window.__LUBAN__ = {
    navigateToPage: function(pageId) {
      return new Promise(function(resolve, reject) {
        var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
        _pending[id] = { resolve: resolve, reject: reject };
        window.parent.postMessage({
          type: 'NAVIGATE_TO_PAGE', id: id, pageId: pageId
        }, '*');
      });
    },
    navigateToPageByName: function(pageName) {
      return new Promise(function(resolve, reject) {
        var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
        _pending[id] = { resolve: resolve, reject: reject };
        window.parent.postMessage({
          type: 'NAVIGATE_TO_PAGE_BY_NAME', id: id, pageName: pageName
        }, '*');
      });
    },
    getAllPages: function() {
      return ${allPagesJson};
    }
  };

  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d) return;

    if (d.type === 'QUERY_RESULT') {
      if (d.result) _results[d.queryName] = d.result;
      var cb = _pending[d.id];
      if (cb) {
        if (d.error) { cb.reject(new Error(d.error)); }
        else { cb.resolve(d.result); }
        delete _pending[d.id];
      }
    }
    if (d.type === 'NAVIGATE_RESULT') {
      var cb = _pending[d.id];
      if (cb) {
        if (d.success) { cb.resolve(true); }
        else { cb.reject(new Error(d.error)); }
        delete _pending[d.id];
      }
    }

    if (d.type === 'UPDATE_PAGE') {
      var libs = d.libraries || [];
      var pending = libs.length;

      function applyPage() {
        var styleEl = document.getElementById('__page_style__');
        if (styleEl) styleEl.textContent = d.css || '';

        var root = document.getElementById('__page_root__');
        if (root) root.innerHTML = d.html || '';

        if (d.js) {
          var script = document.createElement('script');
          script.textContent = d.js;
          document.body.appendChild(script);
          if (document.readyState === 'complete' || document.readyState === 'interactive') {
            document.dispatchEvent(new Event('DOMContentLoaded'));
          }
        }
      }

      function onLibLoaded() {
        pending--;
        if (pending <= 0) applyPage();
      }

      if (pending === 0) {
        applyPage();
      } else {
        libs.forEach(function(url) {
          if (_loadedLibs[url]) {
            onLibLoaded();
          } else {
            _loadedLibs[url] = true;
            var script = document.createElement('script');
            script.src = url;
            script.onload = onLibLoaded;
            script.onerror = onLibLoaded;
            document.head.appendChild(script);
          }
        });
      }
    }

    if (d.type === 'UPDATE_BRIDGE') {
      if (d.script) {
        var script = document.createElement('script');
        script.textContent = d.script;
        document.head.appendChild(script);
      }
    }
  });

  ${JSON.stringify(queryNames)}.forEach(function(name) {
    Object.defineProperty(window, name, {
      value: {
        run: function(params) {
          return new Promise(function(resolve, reject) {
            var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
            _pending[id] = { resolve: resolve, reject: reject };
            window.parent.postMessage({
              type: 'RUN_QUERY', id: id, queryName: name, params: params
            }, '*');
          });
        },
        get data() { return _results[name] || null; }
      },
      writable: true,
      configurable: true
    });
  });

  window.parent.postMessage({ type: 'SHELL_READY' }, '*');
})();
</script>`;
  }, [userInfo, allPages]);

  const buildBridgeContent = useCallback((queryNames: string[]) => {
    const userJson = userInfo ? JSON.stringify(userInfo) : 'null';
    const allPagesJson = JSON.stringify(allPages || []);

    return `window.__LUBAN_USER__ = ${userJson};
window.__LUBAN__ = {
  navigateToPage: function(pageId) {
    return new Promise(function(resolve, reject) {
      var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      var pending = window.__bridge_pending || {};
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({
        type: 'NAVIGATE_TO_PAGE', id: id, pageId: pageId
      }, '*');
    });
  },
  navigateToPageByName: function(pageName) {
    return new Promise(function(resolve, reject) {
      var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      var pending = window.__bridge_pending || {};
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({
        type: 'NAVIGATE_TO_PAGE_BY_NAME', id: id, pageName: pageName
      }, '*');
    });
  },
  getAllPages: function() {
    return ${allPagesJson};
  }
};
${JSON.stringify(queryNames)}.forEach(function(name) {
  Object.defineProperty(window, name, {
    value: {
      run: function(params) {
        return new Promise(function(resolve, reject) {
          var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
          var pending = window.__bridge_pending || {};
          pending[id] = { resolve: resolve, reject: reject };
          window.parent.postMessage({
            type: 'RUN_QUERY', id: id, queryName: name, params: params
          }, '*');
        });
      },
      get data() { return (window.__bridge_results || {})[name] || null; }
    },
    writable: true,
    configurable: true
  });
});`;
  }, [userInfo, allPages]);

  return { buildShellScript, buildBridgeContent };
}