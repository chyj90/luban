import { useCallback, useEffect, useRef } from 'react';
import { runQuery, runAppTool, runRuntimeQuery, runRuntimeTool } from '@/api';
import type { Query } from '@/types/query';

interface BridgeRequest {
  type: 'RUN_QUERY' | 'NAVIGATE_TO_PAGE' | 'NAVIGATE_TO_PAGE_BY_NAME' | 'CALL_API' | 'START_WORKFLOW';
  id: string;
  queryName?: string;
  params?: Record<string, unknown>;
  pageId?: number;
  pageName?: string;
  apiName?: string;
  definitionId?: number;
  formData?: string;
}

interface BridgeResponse {
  type: 'QUERY_RESULT' | 'NAVIGATE_RESULT' | 'API_RESULT' | 'WORKFLOW_RESULT';
  id: string;
  queryName?: string;
  result?: { columns: string[]; rows: Record<string, unknown>[]; totalCount: number };
  error?: string;
  success?: boolean;
  apiName?: string;
  apiResult?: unknown;
  instanceId?: number;
  instance?: unknown;
}

interface UserInfo {
  id: number;
  account: string;
  email: string;
}

interface PageInfo {
  id: number;
  name: string;
}

interface AppToolInfo {
  id: number;
  name: string;
}

export function useQueryBridge(
  queries: Query[],
  userInfo?: UserInfo | null,
  allPages?: PageInfo[],
  onNavigate?: (pageId: number) => void,
  applicationId?: number,
  appTools?: AppToolInfo[],
  currentPageId?: number,
) {
  const queriesRef = useRef<Query[]>(queries);
  queriesRef.current = queries;

  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const allPagesRef = useRef<PageInfo[]>(allPages || []);
  allPagesRef.current = allPages || [];

  const appToolsRef = useRef<AppToolInfo[]>(appTools || []);
  appToolsRef.current = appTools || [];

  const appIdRef = useRef<number | undefined>(applicationId);
  appIdRef.current = applicationId;

  const pageIdRef = useRef<number | undefined>(currentPageId);
  pageIdRef.current = currentPageId;

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
        const pageId = pageIdRef.current;
        const res = pageId
          ? await runRuntimeQuery(pageId, query.id, { params: msg.params })
          : await runQuery(query.id, { params: msg.params });
        const { columns, rows, totalCount } = res.data;
        const objectRows: Record<string, unknown>[] = rows.map((row: unknown[]) => {
          const obj: Record<string, unknown> = {};
          columns.forEach((col, i) => { obj[col] = row[i]; });
          return obj;
        });
        respond({
          type: 'QUERY_RESULT',
          id: msg.id,
          queryName: msg.queryName,
          result: { columns, rows: objectRows, totalCount },
        });
      } catch (err: unknown) {
        respond({
          type: 'QUERY_RESULT',
          id: msg.id,
          queryName: msg.queryName,
          error: (err as Error).message || '查询执行失败',
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
    } else if (msg.type === 'CALL_API') {
      const appId = appIdRef.current;
      const tool = appToolsRef.current.find((t) => t.name === msg.apiName);
      const pageId = pageIdRef.current;

      if (!appId && !pageId) {
        respond({ type: 'API_RESULT', id: msg.id, apiName: msg.apiName, error: '应用 ID 未配置' });
        return;
      }

      if (!tool) {
        respond({ type: 'API_RESULT', id: msg.id, apiName: msg.apiName, error: `API "${msg.apiName}" 不存在` });
        return;
      }

      try {
        const res = pageId
          ? await runRuntimeTool(pageId, tool.id, msg.params || {})
          : await runAppTool(appId!, tool.id, msg.params || {});
        respond({
          type: 'API_RESULT',
          id: msg.id,
          apiName: msg.apiName,
          apiResult: res.data,
        });
      } catch (e: unknown) {
        respond({
          type: 'API_RESULT',
          id: msg.id,
          apiName: msg.apiName,
          error: (e as Error).message,
        });
      }
    } else if (msg.type === 'START_WORKFLOW') {
      if (!msg.definitionId) {
        respond({ type: 'WORKFLOW_RESULT', id: msg.id, success: false, error: '缺少 definitionId 参数' });
        return;
      }
      try {
        const { instanceApi } = await import('@/api/workflow');
        const instance = await instanceApi.start({
          definitionId: msg.definitionId,
          formData: msg.formData || '{}',
        });
        respond({
          type: 'WORKFLOW_RESULT',
          id: msg.id,
          success: true,
          instanceId: instance.id,
          instance,
        });
      } catch (e: unknown) {
        respond({
          type: 'WORKFLOW_RESULT',
          id: msg.id,
          success: false,
          error: (e as Error).message,
        });
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
  // 字段名校验警告去重：跨刷新持久（每次 QUERY_RESULT 会重建 Proxy，局部去重每 10s 轮询会重复刷屏）
  var _fieldWarned = {};
  // ECharts 等第三方库会访问数据对象的内部属性（__ec_primitive__、nodeType 等），
  // 这些不是用户代码的字段拼写错误，不应报警
  var _fieldIgnored = /^(__|_ec_|ec_|toJSON$|nodeType$|nodeName$)/;

  window.__bridge_pending = _pending;
  window.__bridge_results = _results;

  var _origAddEventListener = document.addEventListener;
  var _origRemoveEventListener = document.removeEventListener;
  var _domReadyListeners = [];

  document.addEventListener = function(type, listener, options) {
    if (type === 'DOMContentLoaded') {
      _domReadyListeners.push({ listener: listener, options: options });
    }
    return _origAddEventListener.call(this, type, listener, options);
  };

  document.removeEventListener = function(type, listener, options) {
    if (type === 'DOMContentLoaded') {
      for (var i = _domReadyListeners.length - 1; i >= 0; i--) {
        if (_domReadyListeners[i].listener === listener) {
          _domReadyListeners.splice(i, 1);
        }
      }
    }
    return _origRemoveEventListener.call(this, type, listener, options);
  };

  window.__LUBAN_USER__ = ${userJson};

  window.__LUBAN__ = {
    navigateToPage: function(pageId, params) {
      if (params) {
        try { sessionStorage.setItem('__luban_params__', JSON.stringify(params)); } catch(e) {}
      }
      return new Promise(function(resolve, reject) {
        var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
        _pending[id] = { resolve: resolve, reject: reject };
        window.parent.postMessage({
          type: 'NAVIGATE_TO_PAGE', id: id, pageId: pageId
        }, '*');
      });
    },
    navigateToPageByName: function(pageName, params) {
      if (params) {
        try { sessionStorage.setItem('__luban_params__', JSON.stringify(params)); } catch(e) {}
      }
      return new Promise(function(resolve, reject) {
        var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
        _pending[id] = { resolve: resolve, reject: reject };
        window.parent.postMessage({
          type: 'NAVIGATE_TO_PAGE_BY_NAME', id: id, pageName: pageName
        }, '*');
      });
    },
    getPageParams: function() {
      try {
        var stored = sessionStorage.getItem('__luban_params__');
        sessionStorage.removeItem('__luban_params__');
        return stored ? JSON.parse(stored) : null;
      } catch(e) { return null; }
    },
    getAllPages: function() {
      return ${allPagesJson};
    },
    callApi: function(apiName, params) {
      return new Promise(function(resolve, reject) {
        var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
        _pending[id] = { resolve: resolve, reject: reject };
        window.parent.postMessage({
          type: 'CALL_API', id: id, apiName: apiName, params: params
        }, '*');
      });
    },
    startWorkflow: function(definitionId, formData) {
      return new Promise(function(resolve, reject) {
        var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
        _pending[id] = { resolve: resolve, reject: reject };
        window.parent.postMessage({
          type: 'START_WORKFLOW', id: id, definitionId: definitionId, formData: typeof formData === 'string' ? formData : JSON.stringify(formData || {})
        }, '*');
      });
    },
    // 页面卸载钩子：页面脚本用 setInterval/addEventListener 后必须在此注册清理函数，
    // 页面热更新（UPDATE_PAGE）和 iframe 卸载时平台会自动调用
    onPageUnload: function(fn) {
      (window.__luban_cleanup_fns__ = window.__luban_cleanup_fns__ || []).push(fn);
    }
  };

  function _runPageCleanup() {
    var fns = window.__luban_cleanup_fns__ || [];
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](); } catch (e) {}
    }
    window.__luban_cleanup_fns__ = [];
  }
  window.addEventListener('beforeunload', _runPageCleanup);

  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d) return;

    if (d.type === 'QUERY_RESULT') {
      if (d.result && d.result.rows && d.result.columns) {
        var cols = d.result.columns;
        d.result.rows = d.result.rows.map(function(row) {
          var obj;
          if (Array.isArray(row)) {
            obj = {};
            cols.forEach(function(col, i) {
              obj[col] = row[i];
            });
          } else {
            obj = row;
          }
          return new Proxy(obj, {
            get: function(target, prop) {
              if (typeof prop === 'string' && prop !== 'then' && !_fieldIgnored.test(prop) && !(prop in target)) {
                var warnKey = cols.join(',') + '|' + prop;
                if (!_fieldWarned[warnKey]) {
                  _fieldWarned[warnKey] = true;
                  console.error('[鲁班] 字段名错误：' + prop + ' 不存在，可用字段：' + cols.join(', '));
                }
              }
              return target[prop];
            }
          });
        });
      }
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
    if (d.type === 'API_RESULT') {
      var cb = _pending[d.id];
      if (cb) {
        if (d.error) { cb.reject(new Error(d.error)); }
        else { cb.resolve(d.apiResult); }
        delete _pending[d.id];
      }
    }
    if (d.type === 'WORKFLOW_RESULT') {
      var cb = _pending[d.id];
      if (cb) {
        if (d.error) { cb.reject(new Error(d.error)); }
        else { cb.resolve(d.instance || { success: true, instanceId: d.instanceId }); }
        delete _pending[d.id];
      }
    }

    if (d.type === 'UPDATE_CSS') {
      var styleEl = document.getElementById('__luban_ui__');
      if (styleEl && d.css) styleEl.textContent = d.css;
    }

    if (d.type === 'UPDATE_PAGE') {
      // shell 的 SHELL_READY 在 <head> 中发出，此时 body 内联的 __echarts__ 尚未执行；
      // 若立即注入外部库（如 china.js），CDN 命中缓存时可能在 echarts 全局就绪前执行
      // （报 "ECharts is not Loaded" 且地图注册失败）。统一延迟到 DOMContentLoaded，
      // 保证所有内联脚本已执行完毕。
      function startApplyPage() {
      var libs = d.libraries || [];
      var pending = libs.length;

      function applyPage() {
        // 页面热更新前先执行旧页面的清理函数（清定时器/解绑监听），避免泄漏和重复初始化
        _runPageCleanup();

        var bodyScripts = document.body.querySelectorAll('script');
        for (var i = 0; i < bodyScripts.length; i++) {
          if (bodyScripts[i].id !== '__luban_ui_js__' && bodyScripts[i].id !== '__echarts__') {
            bodyScripts[i].remove();
          }
        }

        for (var i = 0; i < _domReadyListeners.length; i++) {
          var item = _domReadyListeners[i];
          _origRemoveEventListener.call(document, 'DOMContentLoaded', item.listener, false);
        }
        _domReadyListeners = [];

        var bridgePending = window.__bridge_pending;
        for (var key in bridgePending) {
          if (bridgePending.hasOwnProperty(key)) {
            delete bridgePending[key];
          }
        }
        window.__bridge_results = {};

        if (d.bridgeScript) {
          var bridgeEl = document.createElement('script');
          bridgeEl.textContent = d.bridgeScript;
          document.head.appendChild(bridgeEl);
        }

        var styleEl = document.getElementById('__page_style__');
        if (styleEl) styleEl.textContent = d.css || '';

        var root = document.getElementById('__page_root__');
        if (root) root.innerHTML = d.html || '';

        if (d.js) {
          var script = document.createElement('script');
          script.setAttribute('data-luban-page', '1');
          script.textContent = 'try {\\n' + d.js + '\\n} catch(e) { console.error("[鲁班] 页面脚本错误:", e); }';
          document.body.appendChild(script);
        }

        if (document.readyState === 'complete' || document.readyState === 'interactive') {
          document.dispatchEvent(new Event('DOMContentLoaded'));
        }
      }

      function onLibLoaded() {
        pending--;
        if (pending <= 0) ensureChinaMap(applyPage);
      }

      // 平台内置中国地图：页面代码引用地图时，先从本域 /luban/china.json 懒加载并
      // registerMap 再渲染页面，页面代码无需（也不应）从 CDN 引入 china.js。
      // 注册失败不阻断渲染，页面自身的 getMap 兜底逻辑仍然生效。
      function ensureChinaMap(ready) {
        var pageCode = (d.html || '') + (d.js || '');
        if (!/china|registerMap|loadChinaMap/i.test(pageCode)) { ready(); return; }
        try {
          if (typeof echarts !== 'undefined' && echarts.getMap && echarts.getMap('china')) { ready(); return; }
          fetch('${(import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}luban/china.json').then(function(res) { return res.json(); }).then(function(geoJson) {
            try { if (typeof echarts !== 'undefined') echarts.registerMap('china', geoJson); } catch (e) {}
            ready();
          }).catch(function(err) {
            console.warn('[鲁班] 内置中国地图加载失败（/luban/china.json）:', err && err.message);
            ready();
          });
        } catch (e) { ready(); }
      }

      if (pending === 0) {
        ensureChinaMap(applyPage);
      } else {
        libs.forEach(function(url) {
          if (_loadedLibs[url]) {
            onLibLoaded();
          } else {
            _loadedLibs[url] = true;
            var _u = url.toLowerCase(); var isCss = _u.endsWith('.css') || _u.indexOf('.css?') !== -1;
            if (isCss) {
              var link = document.createElement('link');
              link.rel = 'stylesheet';
              link.href = url;
              link.onload = onLibLoaded;
              link.onerror = function() {
                console.error('[鲁班] CSS 库加载失败: ' + url);
                onLibLoaded();
              };
              document.head.appendChild(link);
            } else {
              var script = document.createElement('script');
              script.src = url;
              script.onload = onLibLoaded;
              script.onerror = function() {
                console.error('[鲁班] 库加载失败: ' + url);
                onLibLoaded();
              };
              document.head.appendChild(script);
            }
          }
        });
      }
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startApplyPage, { once: true });
      } else {
        startApplyPage();
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

  const buildBridgeContent = useCallback((queryNames: string[], _apiNames?: string[]) => {
    const userJson = userInfo ? JSON.stringify(userInfo) : 'null';
    const allPagesJson = JSON.stringify(allPages || []);

    return `window.__LUBAN_USER__ = ${userJson};
window.__LUBAN__ = {
  navigateToPage: function(pageId, params) {
    if (params) {
      try { sessionStorage.setItem('__luban_params__', JSON.stringify(params)); } catch(e) {}
    }
    return new Promise(function(resolve, reject) {
      var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      var pending = window.__bridge_pending || {};
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({
        type: 'NAVIGATE_TO_PAGE', id: id, pageId: pageId
      }, '*');
    });
  },
  navigateToPageByName: function(pageName, params) {
    if (params) {
      try { sessionStorage.setItem('__luban_params__', JSON.stringify(params)); } catch(e) {}
    }
    return new Promise(function(resolve, reject) {
      var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      var pending = window.__bridge_pending || {};
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({
        type: 'NAVIGATE_TO_PAGE_BY_NAME', id: id, pageName: pageName
      }, '*');
    });
  },
  getPageParams: function() {
    try {
      var stored = sessionStorage.getItem('__luban_params__');
      sessionStorage.removeItem('__luban_params__');
      return stored ? JSON.parse(stored) : null;
    } catch(e) { return null; }
  },
  getAllPages: function() {
    return ${allPagesJson};
  },
  callApi: function(apiName, params) {
    return new Promise(function(resolve, reject) {
      var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      var pending = window.__bridge_pending || {};
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({
        type: 'CALL_API', id: id, apiName: apiName, params: params
      }, '*');
    });
  },
  startWorkflow: function(definitionId, formData) {
    return new Promise(function(resolve, reject) {
      var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      var pending = window.__bridge_pending || {};
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({
        type: 'START_WORKFLOW', id: id, definitionId: definitionId, formData: typeof formData === 'string' ? formData : JSON.stringify(formData || {})
      }, '*');
    });
  },
  // 页面卸载钩子（与 shell 中的定义一致：清理函数列表挂在 window 上，__LUBAN__ 被本脚本覆盖不影响已注册的清理函数）
  onPageUnload: function(fn) {
    (window.__luban_cleanup_fns__ = window.__luban_cleanup_fns__ || []).push(fn);
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
});
window.__QUERIES__ = ${JSON.stringify(queryNames)};
window.DataQuery = {};
${JSON.stringify(queryNames)}.forEach(function(name) {
  var isWrite = name.match(/^(insert|update|delete|create|remove|add|save)/i);
  window.DataQuery[name] = function(params) {
    return window[name].run(params || {}).then(function(result) {
      var affected = result.totalCount || (result.rows ? result.rows.length : 0) || 0;
      if (isWrite) {
        return { affectedRows: affected, success: true, rows: result.rows || [], columns: result.columns || [] };
      }
      return { rows: result.rows || [], columns: result.columns || [], totalCount: result.totalCount || 0 };
    });
  };
});`;
  }, [userInfo, allPages]);

  return { buildShellScript, buildBridgeContent };
}