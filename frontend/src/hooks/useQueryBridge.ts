import { useCallback, useEffect, useRef } from 'react';
import { runQuery, runAppTool, runRuntimeQuery, runRuntimeTool } from '@/api';
import { getPlatformUsers, getPlatformDepartments } from '@/api/platform';
import { BUILTIN_QUERY_NAMES, isBuiltinQueryName } from '@/lib/builtinQueries';
import type { Query } from '@/types/query';

interface BridgeRequest {
  type: 'RUN_QUERY' | 'NAVIGATE_TO_PAGE' | 'NAVIGATE_TO_PAGE_BY_NAME' | 'CALL_API' | 'START_WORKFLOW'
    | 'OPEN_WORKFLOW_FORM' | 'START_WORKFLOW_WITH_FORM';
  id: string;
  queryName?: string;
  params?: Record<string, unknown>;
  pageId?: number;
  pageName?: string;
  apiName?: string;
  definitionId?: number;
  formData?: string;
  /** OPEN_WORKFLOW_FORM / START_WORKFLOW_WITH_FORM：流程表单 ID（缺省时按流程绑定关系解析） */
  formId?: number;
  /** START_WORKFLOW_WITH_FORM：提交后先执行该 INSERT 查询落库，insertId 写入 formData.id */
  insertQueryName?: string;
  insertQueryId?: number;
}

interface BridgeResponse {
  type: 'QUERY_RESULT' | 'NAVIGATE_RESULT' | 'API_RESULT' | 'WORKFLOW_RESULT' | 'WORKFLOW_FORM_RESULT';
  id: string;
  queryName?: string;
  result?: { columns: string[]; rows: Record<string, unknown>[]; totalCount: number; insertId?: number | null };
  error?: string;
  success?: boolean;
  apiName?: string;
  apiResult?: unknown;
  instanceId?: number;
  instance?: unknown;
  /** START_WORKFLOW_WITH_FORM：INSERT 落库返回的业务记录 id（已写入 formData.id） */
  insertId?: number | null;
  /** 用户关闭了表单弹窗（页面侧 Promise 以 cancelled 错误拒绝，区别于真实失败） */
  cancelled?: boolean;
  /** 非致命链路缺口提示（如触发器引用 form.data.id 但未提供 INSERT 注入点） */
  warning?: string;
  /** WORKFLOW_FORM_RESULT：平台表单弹窗收集的数据 */
  formData?: Record<string, unknown>;
}

export interface UserInfo {
  id: number;
  account: string;
  email: string;
  /** 登录用户姓名（页面展示"当前用户"用） */
  name?: string;
  /** 工号：业务表通过 employee_no 与登录账号绑定的桥梁（"我的数据"需求依赖） */
  employeeNo?: string;
  mobile?: string;
  /** 登录用户主部门名（平台组织资产，页面身份展示用） */
  department?: string | null;
}

interface PageInfo {
  id: number;
  name: string;
}

interface AppToolInfo {
  id: number;
  name: string;
}

/** 桥接调用记账条目（链路自检的页面冒烟层用；普通预览不传 journalRef 即零开销） */
export interface BridgeJournalEntry {
  kind: 'query' | 'workflow' | 'api';
  /** 查询名 / API 名 / 流程定义 ID */
  name: string;
  params?: unknown;
  ok: boolean;
  insertId?: number | null;
  instanceId?: number;
  error?: string;
  at: number;
}

export function useQueryBridge(
  queries: Query[],
  userInfo?: UserInfo | null,
  allPages?: PageInfo[],
  onNavigate?: (pageId: number) => void,
  applicationId?: number,
  appTools?: AppToolInfo[],
  currentPageId?: number,
  /** 预览身份切换：设计预览里以指定平台用户执行查询（this.auth 服务端按该用户解析） */
  previewAsUserId?: number,
  /** 桥接调用记账（链路自检页面冒烟层）：传入时每次查询/发起流程/调用 API 都记录一条 */
  journalRef?: { current: BridgeJournalEntry[] | null },
) {
  const queriesRef = useRef<Query[]>(queries);
  queriesRef.current = queries;

  const journalRefRef = useRef<{ current: BridgeJournalEntry[] | null } | undefined>(journalRef);
  journalRefRef.current = journalRef;

  const pushJournal = (entry: Omit<BridgeJournalEntry, 'at'>) => {
    const j = journalRefRef.current?.current;
    if (j) j.push({ ...entry, at: Date.now() });
  };

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

  const previewAsUserIdRef = useRef<number | undefined>(previewAsUserId);
  previewAsUserIdRef.current = previewAsUserId;

  const handleMessage = useCallback(async (event: MessageEvent) => {
    const msg = event.data as BridgeRequest;
    if (!msg) return;

    const respond = (response: BridgeResponse) => {
      (event.source as Window).postMessage(response, '*');
    };
    // 记账响应：先正常回包，再写入冒烟记账（journalRef 未传时零开销）
    const respondJ = (response: BridgeResponse) => {
      respond(response);
      if (response.type === 'QUERY_RESULT') {
        pushJournal({
          kind: 'query', name: response.queryName || '', ok: !response.error,
          insertId: response.result?.insertId ?? null, error: response.error,
        });
      } else if (response.type === 'WORKFLOW_RESULT') {
        pushJournal({
          kind: 'workflow', name: String(msg.definitionId || ''), ok: !!response.success,
          instanceId: response.instanceId, error: response.error,
        });
      }
    };

    if (msg.type === 'RUN_QUERY') {
      // 平台内置查询：身份与组织资产运行时直查平台，业务表只存 user_id 绑定键，
      // 不冗余姓名/部门——单一事实源，平台侧变更自动生效。内置名单见 lib/builtinQueries
      if (isBuiltinQueryName(msg.queryName || '')) {
        try {
          const res = msg.queryName === 'PlatformUsers'
            ? await getPlatformUsers((msg.params || {}) as Record<string, unknown>)
            : await getPlatformDepartments();
          const rows = (res.data.rows || []) as unknown as Record<string, unknown>[];
          respondJ({
            type: 'QUERY_RESULT',
            id: msg.id,
            queryName: msg.queryName,
            result: {
              columns: rows.length ? Object.keys(rows[0]) : [],
              rows,
              totalCount: res.data.total ?? rows.length,
              insertId: null,
            },
          });
        } catch (err: unknown) {
          respondJ({
            type: 'QUERY_RESULT',
            id: msg.id,
            queryName: msg.queryName,
            error: (err as Error).message || '平台资产查询失败',
          });
        }
        return;
      }

      const query = queriesRef.current.find((q) => q.name === msg.queryName);

      if (!query) {
        respondJ({
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
          : await runQuery(query.id, { params: msg.params }, previewAsUserIdRef.current);
        const { columns, rows, totalCount, insertId } = res.data;
        const objectRows: Record<string, unknown>[] = rows.map((row: unknown[]) => {
          const obj: Record<string, unknown> = {};
          columns.forEach((col, i) => { obj[col] = row[i]; });
          return obj;
        });
        respondJ({
          type: 'QUERY_RESULT',
          id: msg.id,
          queryName: msg.queryName,
          // insertId：INSERT 查询的自增主键，写查询场景透传给页面（startWorkflow formData 需要）
          result: { columns, rows: objectRows, totalCount, insertId: insertId != null ? insertId : null },
        });
      } catch (err: unknown) {
        respondJ({
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
        respondJ({ type: 'WORKFLOW_RESULT', id: msg.id, success: false, error: '缺少 definitionId 参数' });
        return;
      }
      try {
        const { instanceApi } = await import('@/api/workflow');
        // 身份预览时以预览用户为发起人（仅应用所有者可用，后端校验+审计）——
        // 审批人按其组织关系真实解析，人工验收免切账号
        const instance = await instanceApi.start({
          definitionId: msg.definitionId,
          formData: msg.formData || '{}',
        }, previewAsUserIdRef.current);
        respondJ({
          type: 'WORKFLOW_RESULT',
          id: msg.id,
          success: true,
          instanceId: instance.id,
          instance,
        });
      } catch (e: unknown) {
        respondJ({
          type: 'WORKFLOW_RESULT',
          id: msg.id,
          success: false,
          error: (e as Error).message,
        });
      }
    } else if (msg.type === 'OPEN_WORKFLOW_FORM' || msg.type === 'START_WORKFLOW_WITH_FORM') {
      void runWorkflowFormFlow(msg, respond, respondJ);
    }
  }, []);

  /**
   * 平台表单弹窗发起链路（OPEN_WORKFLOW_FORM / START_WORKFLOW_WITH_FORM）：
   * 表单 UI 由父窗口的真实 FormRenderer 渲染（表单设计器的运行时渲染器，含 excel 上传
   * 解析、detail_table 等全部控件），页面零表单代码——字段/必填随表单设计自动生效。
   * START_WORKFLOW_WITH_FORM 在提交后按需执行 INSERT 落库（insertId 写入 formData.id），
   * 再发起流程——触发器 form.data.id 回写由此获得业务记录定位键。
   */
  const runWorkflowFormFlow = useCallback(async (
    msg: BridgeRequest,
    respond: (r: BridgeResponse) => void,
    respondJ: (r: BridgeResponse) => void,
  ) => {
    const isStart = msg.type === 'START_WORKFLOW_WITH_FORM';
    try {
      const { formApi, bindingApi, workflowApi, instanceApi } = await import('@/api/workflow');
      const { openWorkflowFormModal } = await import('@/components/WorkflowFormModal');

      // 解析表单：显式 formId 优先；否则按流程定义的绑定关系取（DRAFT id 兜底其发布版）
      let formId = msg.formId;
      if (!formId && msg.definitionId) {
        let bindings = await bindingApi.list({ workflowId: msg.definitionId });
        if (!bindings || bindings.length === 0) {
          try {
            const def = await workflowApi.getDefinition(msg.definitionId);
            if (def.publishedVersionId && def.publishedVersionId !== msg.definitionId) {
              bindings = await bindingApi.list({ workflowId: def.publishedVersionId });
            }
          } catch { /* 定义拉取失败按无绑定处理 */ }
        }
        formId = (bindings || [])[0]?.formId;
      }
      if (!formId) {
        const error = '未找到流程绑定的表单（未传 formId 且流程无绑定关系）';
        respond(isStart
          ? { type: 'WORKFLOW_RESULT', id: msg.id, success: false, error }
          : { type: 'WORKFLOW_FORM_RESULT', id: msg.id, error });
        return;
      }
      const form = await formApi.get(formId);

      const submitted = await new Promise<{ cancelled: true } | { cancelled: false; formData: Record<string, unknown> }>((resolve) => {
        openWorkflowFormModal({ formId, formName: form.name, onDone: resolve });
      });
      if (submitted.cancelled) {
        respond(isStart
          ? { type: 'WORKFLOW_RESULT', id: msg.id, success: false, cancelled: true, error: '用户取消提交' }
          : { type: 'WORKFLOW_FORM_RESULT', id: msg.id, cancelled: true });
        return;
      }
      let formData: Record<string, unknown> = submitted.formData;

      if (!isStart) {
        respondJ({ type: 'WORKFLOW_FORM_RESULT', id: msg.id, formData });
        return;
      }

      // INSERT 落库（业务记录注入点）：身份语义与 RUN_QUERY 一致（运行时按 pageId，预览按预览用户）
      let insertId: number | null = null;
      let warning: string | undefined;
      const insertQuery = msg.insertQueryId
        ? { id: msg.insertQueryId, name: msg.insertQueryName || `查询 ${msg.insertQueryId}` }
        : msg.insertQueryName
          ? queriesRef.current.find((q) => q.name === msg.insertQueryName) || null
          : null;
      if (insertQuery) {
        const pageId = pageIdRef.current;
        const res = pageId
          ? await runRuntimeQuery(pageId, insertQuery.id, { params: formData })
          : await runQuery(insertQuery.id, { params: formData }, previewAsUserIdRef.current);
        insertId = res.data.insertId ?? null;
        if (insertId != null) formData = { ...formData, id: insertId };
      } else {
        // 脑裂守卫：触发器按 form.data.id 定位业务记录，缺注入点时审批回写命中 0 行
        try {
          const def = await workflowApi.getDefinition(msg.definitionId!);
          const nodesStr = typeof def.nodes === 'string' ? def.nodes : JSON.stringify(def.nodes || []);
          if (/form\.data\.id\b/.test(nodesStr)) {
            warning = '流程触发器引用 form.data.id，但未提供 insertQueryName/insertQueryId——审批回写将命中 0 行（断链）';
          }
        } catch { /* 定义拉取失败忽略 */ }
      }

      const instance = await instanceApi.start(
        { definitionId: msg.definitionId!, formData: JSON.stringify(formData) },
        previewAsUserIdRef.current,
      );
      respondJ({
        type: 'WORKFLOW_RESULT', id: msg.id, success: true,
        instanceId: instance.id, instance, insertId, warning,
      });
    } catch (e: unknown) {
      const error = (e as Error).message || '流程表单提交失败';
      respondJ(isStart
        ? { type: 'WORKFLOW_RESULT', id: msg.id, success: false, error }
        : { type: 'WORKFLOW_FORM_RESULT', id: msg.id, error });
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
  // UPDATE_PAGE 应用顺序守卫：applyPage 异步完成（外部库/地图/DOMContentLoaded 都会延迟），
  // 连续切页时迟到的过期消息不得把已切换的新页面再覆盖回旧页面
  var _lastPageSeq = 0;
  var _pageSeqSent = 0;
  // 字段名校验警告去重：跨刷新持久（每次 QUERY_RESULT 会重建 Proxy，局部去重每 10s 轮询会重复刷屏）
  var _fieldWarned = {};
  // ECharts 等第三方库会访问数据对象的内部属性（__ec_primitive__、nodeType 等），
  // 这些不是用户代码的字段拼写错误，不应报警
  var _fieldIgnored = /^(__|_ec_|ec_|toJSON$|nodeType$|nodeName$)/;

  window.__bridge_pending = _pending;
  window.__bridge_results = _results;

  // Esc 转发：页面内的键盘事件不会传到设计器父窗口（iframe 聚焦），全屏预览的
  // "Esc 退出"必须由这里转发，否则用户在全屏预览里点过页面后就无法退出了
  window.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      try { window.parent.postMessage({ type: 'PREVIEW_ESCAPE' }, '*'); } catch (err) {}
    }
  });

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
    // 平台表单弹窗：表单 UI 由父窗口按流程表单真实渲染（含 excel 上传/detail_table 等全部
    // 控件），页面零表单代码。resolve(表单数据) / reject（取消时 err.cancelled === true）
    openWorkflowForm: function(formId) {
      return new Promise(function(resolve, reject) {
        var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
        _pending[id] = { resolve: resolve, reject: reject };
        window.parent.postMessage({ type: 'OPEN_WORKFLOW_FORM', id: id, formId: formId }, '*');
      });
    },
    // 表单弹窗发起流程一条链：平台渲染绑定表单 → 提交后（可选）INSERT 落库 → 以 insertId 发起流程。
    // options: { formId?, insertQueryName?, insertQueryId? }；formId 缺省自动解析流程默认绑定表单
    startWorkflowWithForm: function(definitionId, options) {
      options = options || {};
      return new Promise(function(resolve, reject) {
        var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
        _pending[id] = { resolve: resolve, reject: reject };
        window.parent.postMessage({
          type: 'START_WORKFLOW_WITH_FORM', id: id, definitionId: definitionId,
          formId: options.formId, insertQueryName: options.insertQueryName, insertQueryId: options.insertQueryId
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
                  console.error('[知行] 字段名错误：' + prop + ' 不存在，可用字段：' + cols.join(', '));
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
        if (d.error) {
          var we = new Error(d.error);
          if (d.cancelled) we.cancelled = true;
          cb.reject(we);
        } else {
          if (d.warning) console.warn('[知行] ' + d.warning);
          if (d.instance) { d.instance.insertId = d.insertId; cb.resolve(d.instance); }
          else { cb.resolve({ success: true, instanceId: d.instanceId, insertId: d.insertId }); }
        }
        delete _pending[d.id];
      }
    }
    if (d.type === 'WORKFLOW_FORM_RESULT') {
      var cbf = _pending[d.id];
      if (cbf) {
        if (d.error) { cbf.reject(new Error(d.error)); }
        else if (d.cancelled) { var ce = new Error('已取消'); ce.cancelled = true; cbf.reject(ce); }
        else { cbf.resolve(d.formData || {}); }
        delete _pending[d.id];
      }
    }

    if (d.type === 'UPDATE_CSS') {
      var styleEl = document.getElementById('__luban_ui__');
      if (styleEl && d.css) styleEl.textContent = d.css;
    }

    if (d.type === 'UPDATE_PAGE') {
      // 过期消息直接作废（每条消息只携带一种 type，return 不影响其他分支）
      var pageSeq = typeof d.seq === 'number' ? d.seq : ++_pageSeqSent;
      if (pageSeq < _lastPageSeq) return;
      _lastPageSeq = pageSeq;
      // shell 的 SHELL_READY 在 <head> 中发出，此时 body 内联的 __echarts__ 尚未执行；
      // 若立即注入外部库（如 china.js），CDN 命中缓存时可能在 echarts 全局就绪前执行
      // （报 "ECharts is not Loaded" 且地图注册失败）。统一延迟到 DOMContentLoaded，
      // 保证所有内联脚本已执行完毕。
      function startApplyPage() {
      var libs = d.libraries || [];
      var pending = libs.length;

      function applyPage() {
        // 已被更新的页面消息取代：本次应用作废，避免旧页面覆盖新页面
        if (pageSeq !== _lastPageSeq) return;
        // 页面热更新前先执行旧页面的清理函数（清定时器/解绑监听），避免泄漏和重复初始化
        _runPageCleanup();

        // 主题/配色是页面级状态：同一个 iframe 承载多个页面，切页/热更新时必须重置为默认浅色，
        // 由页面脚本自行 setTheme/setVisualStyle 覆盖——否则深色大屏的 data-theme 会泄漏到后续所有页面
        try {
          if (window.LubanUI) window.LubanUI._currentTheme = null;
          if (window.LubanUI) window.LubanUI._activeStyle = null;
          document.documentElement.removeAttribute('data-theme');
        } catch (e) {}

        var bodyScripts = document.body.querySelectorAll('script');
        var keepIds = ['__luban_ui_js__', '__echarts__', '__echarts_gl__', '__leaflet_src__'];
        for (var i = 0; i < bodyScripts.length; i++) {
          if (keepIds.indexOf(bodyScripts[i].id) === -1) {
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

        // GIS 按需激活：页面引用 LubanUI.gis/leaflet 时，从 shell 惰性标签取出 Leaflet 源码
        // 同步执行（内联 script 插入即执行，无竞态）——未使用的页面零加载成本
        if (/LubanUI\.gis|leaflet/i.test((d.html || '') + (d.js || '')) && typeof window.L === 'undefined') {
          var lazyEl = document.getElementById('__leaflet_src__');
          if (lazyEl && lazyEl.textContent) {
            var lazyScript = document.createElement('script');
            lazyScript.textContent = lazyEl.textContent;
            document.body.appendChild(lazyScript);
          }
        }

        if (d.js) {
          var script = document.createElement('script');
          script.setAttribute('data-luban-page', '1');
          script.textContent = 'try {\\n' + d.js + '\\n} catch(e) { console.error("[知行] 页面脚本错误:", e); }';
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
            console.warn('[知行] 内置中国地图加载失败（/luban/china.json）:', err && err.message);
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
                console.error('[知行] CSS 库加载失败: ' + url);
                onLibLoaded();
              };
              document.head.appendChild(link);
            } else {
              var script = document.createElement('script');
              script.src = url;
              script.onload = onLibLoaded;
              script.onerror = function() {
                console.error('[知行] 库加载失败: ' + url);
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

  // 平台内置查询（身份/组织资产运行时直查平台）与页面绑定查询一起注册；
  // 页面绑定了同名查询时以页面查询为准（不重复注册）
  var _names = ${JSON.stringify(queryNames)};
  ${JSON.stringify(BUILTIN_QUERY_NAMES)}.forEach(function(b) {
    if (_names.indexOf(b) === -1) _names.push(b);
  });
  _names.forEach(function(name) {
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
  // 平台表单弹窗（与 shell 中的定义一致）：表单 UI 由父窗口真实渲染，页面零表单代码
  openWorkflowForm: function(formId) {
    return new Promise(function(resolve, reject) {
      var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      var pending = window.__bridge_pending || {};
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({ type: 'OPEN_WORKFLOW_FORM', id: id, formId: formId }, '*');
    });
  },
  // 表单弹窗发起流程一条链：渲染绑定表单 → 提交后（可选）INSERT 落库 → 以 insertId 发起流程
  startWorkflowWithForm: function(definitionId, options) {
    options = options || {};
    return new Promise(function(resolve, reject) {
      var id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      var pending = window.__bridge_pending || {};
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({
        type: 'START_WORKFLOW_WITH_FORM', id: id, definitionId: definitionId,
        formId: options.formId, insertQueryName: options.insertQueryName, insertQueryId: options.insertQueryId
      }, '*');
    });
  },
  // 页面卸载钩子（与 shell 中的定义一致：清理函数列表挂在 window 上，__LUBAN__ 被本脚本覆盖不影响已注册的清理函数）
  onPageUnload: function(fn) {
    (window.__luban_cleanup_fns__ = window.__luban_cleanup_fns__ || []).push(fn);
  }
};
// 平台内置查询与页面绑定查询一起注册（页面绑定同名查询时以页面为准）
var _names = ${JSON.stringify(queryNames)};
${JSON.stringify(BUILTIN_QUERY_NAMES)}.forEach(function(b) {
  if (_names.indexOf(b) === -1) _names.push(b);
});
_names.forEach(function(name) {
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
window.__QUERIES__ = _names;
window.DataQuery = {};
_names.forEach(function(name) {
  window.DataQuery[name] = function(params) {
    return window[name].run(params || {}).then(function(result) {
      var affected = result.totalCount || (result.rows ? result.rows.length : 0) || 0;
      // 写查询判定：查询名前缀，或后端返回携带 insertId（仅 INSERT 会带）——
      // 名字不带写前缀的写查询也能拿到正确的结果形状
      var isWrite = /^(insert|update|delete|create|remove|add|save)/i.test(name) ||
        (result && result.insertId != null);
      if (isWrite) {
        // insertId：INSERT 查询返回的自增主键。审批回写场景页面必须把它放进
        // startWorkflow 的 formData，触发器才能定位业务记录（缺它即断链）
        return { affectedRows: affected, success: true, insertId: result.insertId != null ? result.insertId : null, rows: result.rows || [], columns: result.columns || [] };
      }
      return { rows: result.rows || [], columns: result.columns || [], totalCount: result.totalCount || 0 };
    });
  };
});
// 大小写兜底：查询名区分大小写，调错时调用值为 undefined 只会弹 toast——
// 在注册表上挂 Proxy 打出正确名称，把"页面无数据"的隐蔽错误变成显式提示
window.DataQuery = new Proxy(window.DataQuery, {
  get: function(target, prop) {
    if (typeof prop === 'string' && !(prop in target) && prop !== 'then') {
      var keys = Object.keys(target);
      var lower = prop.toLowerCase();
      var hit = keys.find(function(k) { return k.toLowerCase() === lower; });
      console.error('[知行] DataQuery.' + prop + ' 不存在' +
        (hit ? '（查询名区分大小写，应为 DataQuery.' + hit + '）' : '') +
        (keys.length ? '。本页面可用查询：' + keys.join(', ') : '。本页面未绑定任何查询（queryIds 为空）'));
    }
    return target[prop];
  }
});`;
  }, [userInfo, allPages]);

  return { buildShellScript, buildBridgeContent };
}