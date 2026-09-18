import { useEffect, useRef, useMemo, useCallback, useState, type CSSProperties, type MutableRefObject } from 'react';
import type { CodePageData } from '@/types/page';
import type { Query } from '@/types/query';
import { useQueryBridge, type UserInfo, type BridgeJournalEntry } from '@/hooks/useQueryBridge';
import { getPlatformUsers } from '@/api/platform';
import { taskApi } from '@/api/workflow';
import type { WorkflowTask } from '@/types/workflow';
import Select from '@/components/Select';
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
  /** 桥接调用记账（链路自检页面冒烟层用；普通预览不传即零开销） */
  journalRef?: MutableRefObject<BridgeJournalEntry[] | null>;
  /** 预览 iframe 内按下 Esc 时回调（iframe 聚焦时键盘事件不会到达父窗口，需由此转发） */
  onEscape?: () => void;
}

export function InteliPreview({ codePage, queries, userInfo, allPages, onNavigate, applicationId, appTools, designWidth, journalRef, onEscape }: InteliPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const shellReadyRef = useRef(false);
  const shellBuiltRef = useRef(false);
  const lastQueryNamesRef = useRef<string[]>([]);
  const pageMsgSeqRef = useRef(0);
  const codePageRef = useRef(codePage);
  codePageRef.current = codePage;

  // 预览身份切换（preview-as）：以指定平台用户身份渲染页面与执行查询，
  // 验证"我的数据"类查询在不同账号下返回不同结果集（root 与员工看到同一份数据即此处应暴露的问题）
  const [previewUser, setPreviewUser] = useState<UserInfo | null>(null);
  const [previewOptions, setPreviewOptions] = useState<Array<{ id: number; label: string; name: string; account: string }>>([]);
  const effectiveUser: UserInfo | null = previewUser ?? userInfo ?? null;
  const identityKey = effectiveUser ? `u${effectiveUser.id}` : 'anon';
  const identityKeyRef = useRef(identityKey);

  const loadPreviewOptions = useCallback(async () => {
    if (previewOptions.length > 0) return;
    try {
      const res = await getPlatformUsers({ page: 1, pageSize: 50 });
      setPreviewOptions((res.data.rows || []).map((u) => ({
        id: u.id,
        label: `${u.name || u.account}（${u.account}）`,
        name: u.name || u.account,
        account: u.account,
      })));
    } catch {
      // 平台用户不可用时身份切换退化为本人预览
    }
  }, [previewOptions.length]);

  const { buildShellScript, buildBridgeContent } = useQueryBridge(
    queries, effectiveUser, allPages, onNavigate, applicationId, appTools,
    undefined, previewUser ? previewUser.id : undefined,
    journalRef,
  );

  // 身份预览待办面板：显示当前预览身份（未切换时为登录人本人）在本应用内的待办审批，
  // 发起/审批全程免切账号（后端 preview-as 仅应用所有者可用 + 审计）
  const [tasksOpen, setTasksOpen] = useState(false);
  const [pendingTasks, setPendingTasks] = useState<WorkflowTask[] | null>(null);
  const loadPendingTasks = useCallback(async () => {
    if (!applicationId) return;
    try {
      setPendingTasks(await taskApi.list({
        status: 'pending', applicationId,
        previewAsUserId: previewUser ? previewUser.id : undefined,
      }));
    } catch {
      setPendingTasks([]);
    }
  }, [previewUser, applicationId]);
  useEffect(() => {
    // 不论面板开合都拉一次，按钮上直接显示待办数量；切换身份后自动刷新
    loadPendingTasks();
  }, [loadPendingTasks]);

  const handleTaskAction = useCallback(async (taskId: number, action: 'approve' | 'reject') => {
    const comment = action === 'reject' ? (window.prompt('驳回意见（可选）') || '') : '同意';
    try {
      if (action === 'approve') await taskApi.approve(taskId, comment, previewUser ? previewUser.id : undefined);
      else await taskApi.reject(taskId, comment, previewUser ? previewUser.id : undefined);
      await loadPendingTasks();
    } catch (e) {
      window.alert((e as Error).message || '操作失败');
    }
  }, [previewUser, loadPendingTasks]);

  // iframe 内按 Esc → 通知父层（AppEditorPage 用它退出全屏预览）
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'PREVIEW_ESCAPE' && e.source === iframeRef.current?.contentWindow) {
        onEscapeRef.current?.();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

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
    const identityChanged = identityKeyRef.current !== identityKey;

    if (shellBuiltRef.current && !namesChanged && !identityChanged) return;

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
    identityKeyRef.current = identityKey;
  }, [buildShellScript, queryNames, identityKey]);

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
      <div className="ip-identity-bar">
        <span className="ip-identity-label">身份预览</span>
        <Select
          className="ip-identity-select"
          small
          value={previewUser ? String(previewUser.id) : ''}
          placeholder="本人（登录账号）"
          onOpen={loadPreviewOptions}
          options={[
            { value: '', label: '本人（登录账号）' },
            ...previewOptions.map((o) => ({ value: String(o.id), label: o.label })),
          ]}
          onChange={(v) => {
            if (!v) { setPreviewUser(null); setTasksOpen(false); return; }
            const found = previewOptions.find((o) => String(o.id) === v);
            if (found) {
              setPreviewUser({ id: found.id, account: found.account, email: '', name: found.name });
            }
          }}
        />
        {applicationId ? (
          <button
            className="ip-todo-toggle"
            style={{
              marginLeft: 'auto', border: '1px solid #d1d5db', background: tasksOpen ? '#eef2ff' : '#fff',
              color: '#374151', borderRadius: 6, padding: '2px 10px', fontSize: 12, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            onClick={() => setTasksOpen((v) => !v)}
          >
            我的待办{pendingTasks ? `（${pendingTasks.length}）` : ''}
          </button>
        ) : null}
      </div>
      {tasksOpen && applicationId ? (
        <div style={{ borderBottom: '1px solid #e5e7eb', padding: '6px 12px', fontSize: 12, background: '#fafafa' }}>
          {pendingTasks === null ? (
            <span style={{ color: '#6b7280' }}>加载中…</span>
          ) : pendingTasks.length === 0 ? (
            <span style={{ color: '#6b7280' }}>当前身份在本应用内没有待办审批</span>
          ) : (
            pendingTasks.map((t) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <span style={{ color: '#374151' }}>
                  #{t.id} {t.nodeName || t.nodeId} · 实例 {t.instanceId}
                </span>
                <button
                  style={{ border: '1px solid #059669', background: '#ecfdf5', color: '#059669', borderRadius: 4, padding: '1px 8px', cursor: 'pointer', fontSize: 12 }}
                  onClick={() => handleTaskAction(t.id, 'approve')}
                >通过</button>
                <button
                  style={{ border: '1px solid #dc2626', background: '#fef2f2', color: '#dc2626', borderRadius: 4, padding: '1px 8px', cursor: 'pointer', fontSize: 12 }}
                  onClick={() => handleTaskAction(t.id, 'reject')}
                >驳回</button>
              </div>
            ))
          )}
        </div>
      ) : null}
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