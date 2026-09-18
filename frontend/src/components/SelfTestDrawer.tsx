/**
 * 应用链路自检抽屉（一键测试入口）：
 * ① 页面冒烟——勾选的页面（单/多选，默认全选）在隐藏 InteliPreview 沙箱加载（与真实渲染同路径），
 *    收集 JS 运行时错误 + 桥接调用记账（页面初始化真实触发的 DataQuery/发起流程）；
 * ② 业务链路——勾选的流程（单/多选，默认第一条主链路）经契约提取器生成 TestSpec，调后端引擎执行；
 * ③ 报告——步骤表 + 自动清理 + 残留/缺口清单。
 * 设计见 doc/需求文档/需求文档-应用自检测试引擎设计.md。
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { InteliPreview } from './InteliPreview';
import type { BridgeJournalEntry, UserInfo } from '@/hooks/useQueryBridge';
import { listPages, getCodePage } from '@/api';
import { selfTestApi } from '@/api/selfTest';
import { buildSpecForWorkflows, listChainCandidates, type ChainCandidate } from '@/agent/registry/skills/selfTestContract';
import type { Page, CodePageData } from '@/types/page';
import type { Query } from '@/types/query';
import type { SelfTestReport, SelfTestRun, SelfTestSpec } from '@/types/selfTest';

interface SelfTestDrawerProps {
  appId: number;
  open: boolean;
  onClose: () => void;
  queries: Query[];
  userInfo: UserInfo | null;
}

interface PageSmokeResult {
  pageId: number;
  pageName: string;
  jsErrors: string[];
  queryCalls: Array<{ name: string; ok: boolean; error?: string }>;
  workflowCalls: Array<{ definitionId: string; ok: boolean; instanceId?: number; error?: string }>;
}

type Phase = 'idle' | 'smoking' | 'business' | 'done' | 'failed';

interface SmokePageState {
  pageId: number;
  codePage: CodePageData;
}

const SMOKE_WAIT_MS = 5000;

/** 业务链路为异步运行：start 立即返回 RUNNING 记录，随后轮询至终态（引擎预算 60s + 清理） */
const FOLLOW_POLL_MS = 2000;
const FOLLOW_BUDGET_MS = 90_000;

/** 给页面 JS 包一层错误上报（iframe 内运行时错误/未处理 Promise 拒绝 → postMessage 给父层） */
function wrapPageJs(js: string): string {
  return `
;(function(){
  var _p = function(m){ try { parent.postMessage({ type: 'SELFTEST_PAGE_ERROR', message: String(m) }, '*'); } catch(e){} };
  window.addEventListener('error', function(e){ _p((e && e.message) || String(e)); });
  window.addEventListener('unhandledrejection', function(e){ _p('UnhandledRejection: ' + String(e && e.reason)); });
})();
` + (js || '');
}

export function SelfTestDrawer({ appId, open, onClose, queries, userInfo }: SelfTestDrawerProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progressText, setProgressText] = useState('');
  const [pageResults, setPageResults] = useState<PageSmokeResult[]>([]);
  const [report, setReport] = useState<SelfTestReport | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  /** 页面清单；null = 加载中 */
  const [pages, setPages] = useState<Page[] | null>(null);
  const [pagesError, setPagesError] = useState('');
  const [selectedPageIds, setSelectedPageIds] = useState<Set<number>>(new Set());
  /** 业务链路候选流程；null = 加载中 */
  const [chainCandidates, setChainCandidates] = useState<ChainCandidate[] | null>(null);
  const [chainError, setChainError] = useState('');
  const [selectedChainIds, setSelectedChainIds] = useState<Set<number>>(new Set());
  const [smokePage, setSmokePage] = useState<SmokePageState | null>(null);
  /** 自检运行历史（异步运行记录）；null = 加载中 */
  const [history, setHistory] = useState<SelfTestRun[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  /** 当前报告对应的运行（历史高亮用） */
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  const journalRef: MutableRefObject<BridgeJournalEntry[] | null> = useRef(null);
  const errorCollectorRef = useRef<{ pageId: number; errors: string[] } | null>(null);
  /** 轮询令牌：重跑/切换历史/关抽屉时递增，使旧的跟随循环失效 */
  const followTokenRef = useRef(0);

  // 打开抽屉时拉取运行历史
  useEffect(() => {
    if (!open) return;
    setHistory(null);
    setHistoryError('');
    selfTestApi.listRuns(appId, 20)
      .then((res) => setHistory(res.data || []))
      .catch((e) => setHistoryError((e as Error).message || '未知错误'));
  }, [open, appId]);

  // 打开抽屉时拉取页面清单供勾选，默认全选（保持"整个应用"的行为）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listPages(appId)
      .then((res) => {
        if (cancelled) return;
        const list = res.data || [];
        setPages(list);
        setSelectedPageIds(new Set(list.map((p) => p.id)));
      })
      .catch((e) => {
        if (!cancelled) {
          setPages([]);
          setPagesError(`页面清单加载失败：${(e as Error).message || '未知错误'}`);
        }
      });
    return () => { cancelled = true; };
  }, [open, appId]);

  // 打开抽屉时拉取业务链路候选流程（已发布 + 绑定表单），默认勾选第一条主链路（保持原行为）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listChainCandidates(appId)
      .then((list) => {
        if (cancelled) return;
        setChainCandidates(list);
        setSelectedChainIds(list.length > 0 ? new Set([list[0].workflowId]) : new Set());
      })
      .catch((e) => {
        if (!cancelled) {
          setChainCandidates([]);
          setChainError(`流程清单加载失败：${(e as Error).message || '未知错误'}`);
        }
      });
    return () => { cancelled = true; };
  }, [open, appId]);

  const handleClose = useCallback(() => {
    followTokenRef.current += 1;
    setPages(null);
    setPagesError('');
    setChainCandidates(null);
    setChainError('');
    setHistory(null);
    setHistoryError('');
    setReport(null);
    setGaps([]);
    setNotes([]);
    setPageResults([]);
    setErrorMsg('');
    setViewingRunId(null);
    setPhase('idle');
    onClose();
  }, [onClose]);

  /** 轮询跟随一次运行直到终态/预算耗尽；返回 null 表示被新操作取代（调用方直接退出） */
  const followRun = useCallback(async (runId: string, token: number): Promise<SelfTestRun | null> => {
    setPhase('business');
    const deadline = Date.now() + FOLLOW_BUDGET_MS;
    let run: SelfTestRun | null = null;
    while (Date.now() < deadline) {
      if (followTokenRef.current !== token) return null;
      try {
        const resp = await selfTestApi.getRun(appId, runId);
        run = resp.data;
      } catch { /* 单次轮询失败忽略，下一轮重试 */ }
      if (run && run.status !== 'RUNNING') break;
      setProgressText(`执行业务链路（runId ${runId}${run?.currentStepId ? `，当前步骤 ${run.currentStepId}` : ''}）…`);
      await new Promise((r) => setTimeout(r, FOLLOW_POLL_MS));
    }
    return run;
  }, [appId]);

  /** 终态运行落到界面：有报告展示报告，无报告（ABORTED 等）给出说明 */
  const applyFinishedRun = useCallback((run: SelfTestRun) => {
    if (run.status === 'RUNNING') {
      setErrorMsg(`自检仍在后台执行（runId=${run.runId}，当前步骤 ${run.currentStepId ?? '…'}）。稍后重新打开抽屉可查看结果。`);
      setPhase('failed');
      return;
    }
    if (!run.report) {
      setErrorMsg(`运行 ${run.runId} 终态为 ${run.status}：${run.summary ?? '无报告'}`);
      setPhase('failed');
      return;
    }
    setReport(run.report);
    setViewingRunId(run.runId);
    setErrorMsg('');
    setPhase('done');
  }, []);

  /** 静默刷新历史（不改变加载态） */
  const loadHistoryQuiet = useCallback(() => {
    selfTestApi.listRuns(appId, 20)
      .then((res) => setHistory(res.data || []))
      .catch(() => { /* 历史刷新失败不打扰主流程 */ });
  }, [appId]);

  /** 回看历史运行：仍在跑的转跟随，终态的直接展示报告 */
  const openHistoryRun = useCallback(async (runId: string) => {
    const token = ++followTokenRef.current;
    try {
      let run = (await selfTestApi.getRun(appId, runId)).data;
      if (run.status === 'RUNNING') {
        const finalRun = await followRun(runId, token);
        if (finalRun === null) return;
        run = finalRun;
      }
      applyFinishedRun(run);
      loadHistoryQuiet();
    } catch (e) {
      setErrorMsg((e as Error).message || '加载运行详情失败');
      setPhase('failed');
    }
  }, [appId, followRun, applyFinishedRun, loadHistoryQuiet]);

  const togglePage = useCallback((pageId: number) => {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }, []);

  const toggleChain = useCallback((workflowId: number) => {
    setSelectedChainIds((prev) => {
      const next = new Set(prev);
      if (next.has(workflowId)) next.delete(workflowId);
      else next.add(workflowId);
      return next;
    });
  }, []);

  // 页面冒烟期间收集 iframe 内的运行时错误
  useEffect(() => {
    if (phase !== 'smoking') return;
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'SELFTEST_PAGE_ERROR' && errorCollectorRef.current) {
        errorCollectorRef.current.errors.push(String(e.data.message || ''));
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [phase]);

  const runPageSmoke = useCallback(async (pages: Page[]): Promise<PageSmokeResult[]> => {
    const results: PageSmokeResult[] = [];
    for (const [idx, p] of pages.entries()) {
      setProgressText(`页面冒烟（${idx + 1}/${pages.length}）：${p.name}`);
      let codePage: CodePageData | null = null;
      try {
        const res = await getCodePage(p.id);
        codePage = res.data.codePage || null;
      } catch { /* 页面无代码页，跳过 */ }
      if (!codePage || !codePage.js) continue;

      errorCollectorRef.current = { pageId: p.id, errors: [] };
      const journal: BridgeJournalEntry[] = [];
      journalRef.current = journal;

      setSmokePage({ pageId: p.id, codePage: { ...codePage, js: wrapPageJs(codePage.js) } });
      // 等待沙箱加载 + 页面初始化查询完成
      await new Promise((r) => setTimeout(r, SMOKE_WAIT_MS));

      const collector = errorCollectorRef.current;
      results.push({
        pageId: p.id,
        pageName: p.name,
        jsErrors: [...(collector?.errors || [])],
        queryCalls: journal.filter((j) => j.kind === 'query').map((j) => ({ name: j.name, ok: j.ok, error: j.error })),
        workflowCalls: journal.filter((j) => j.kind === 'workflow').map((j) => ({ definitionId: j.name, ok: j.ok, instanceId: j.instanceId, error: j.error })),
      });
      setSmokePage(null);
      errorCollectorRef.current = null;
    }
    journalRef.current = null;
    return results;
  }, []);

  const startRun = useCallback(async () => {
    followTokenRef.current += 1;
    setPhase('smoking');
    setErrorMsg('');
    setReport(null);
    setViewingRunId(null);
    setGaps([]);
    setNotes([]);
    setPageResults([]);
    try {
      // ① 页面冒烟：仅勾选的页面（单/多选）；全部不选则跳过冒烟，只跑业务链路
      const selected = (pages || []).filter((p) => selectedPageIds.has(p.id));
      const smoke = await runPageSmoke(selected);
      setPageResults(smoke);

      // ② 业务链路：仅勾选的流程（单/多选，默认第一条主链路）；全不选则跳过。
      //    异步运行记录模型：start 立即返回，轮询至终态（报告持久化，超时也能稍后回看）
      setPhase('business');
      const chainIds = (chainCandidates || [])
        .filter((c) => selectedChainIds.has(c.workflowId))
        .map((c) => c.workflowId);
      if (chainIds.length === 0) {
        setProgressText('未勾选业务链路流程，跳过');
      } else {
        setProgressText('执行业务链路（发起 → 审批 → 触发器 → 断言）…');
        const extraction = await buildSpecForWorkflows(appId, chainIds);
        setGaps(extraction.gaps);
        setNotes(extraction.notes);
        if (extraction.spec.steps.length > 0) {
          const token = ++followTokenRef.current;
          const started = await selfTestApi.start(appId, extraction.spec as SelfTestSpec, 'MANUAL');
          const run = started.data;
          if (run.followedExisting) {
            setNotes((prev) => [...prev, `该应用已有自检在运行（runId=${run.runId}），已转而显示该运行的进度与结果`]);
          }
          const finalRun = await followRun(run.runId, token);
          if (finalRun === null) return;
          applyFinishedRun(finalRun);
          loadHistoryQuiet();
          return;
        }
      }
      setPhase('done');
    } catch (e) {
      setErrorMsg((e as Error).message || '自检执行失败');
      setPhase('failed');
    }
  }, [appId, runPageSmoke, pages, selectedPageIds, chainCandidates, selectedChainIds, followRun, applyFinishedRun, loadHistoryQuiet]);

  const overallPassed = pageResults.every((r) => r.jsErrors.length === 0 && r.queryCalls.every((c) => c.ok))
    && (!report || report.passed);

  if (!open) return null;

  return (
    <div className="selftest-drawer-backdrop" onClick={handleClose}>
      <div className="selftest-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="selftest-drawer-header">
          <h3>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            链路自检
          </h3>
          <div>
            {phase === 'idle' || phase === 'failed' ? (
              <button
                className="selftest-btn selftest-btn-primary"
                onClick={startRun}
                disabled={pages === null}
                title={pages === null ? '页面清单加载中…' : undefined}
              >
                {phase === 'failed' ? '重新运行' : '开始自检'}
              </button>
            ) : phase === 'done' ? (
              <button className="selftest-btn" onClick={startRun}>再次运行</button>
            ) : (
              <span className="selftest-running">{progressText}…</span>
            )}
            <button className="selftest-btn" style={{ marginLeft: 8 }} onClick={handleClose}>关闭</button>
          </div>
        </div>

        {phase === 'idle' && (
          <div className="selftest-section">
            <p>点击「开始自检」后平台将自动：</p>
            <ol>
              <li>页面冒烟：仅勾选的页面在沙箱逐页加载（默认全选），收集 JS 错误与真实触发的查询/流程调用</li>
              <li>业务链路：对勾选的流程（默认第一条）以真实平台用户身份执行 写库 → 发起流程 → 审批 → 触发器 → 断言</li>
              <li>自动清理测试数据（新增行删除、被改行恢复原值、测试流程实例清除）</li>
            </ol>
            <p className="selftest-hint">需要应用所有者权限；测试写在业务库但会自动清理，无法清理的部分会在报告中列出。</p>
          </div>
        )}

        {(phase === 'idle' || phase === 'failed' || phase === 'done') && (
          <div className="selftest-section">
            <div className="selftest-select-head">
              <h4>冒烟页面</h4>
              {pages !== null && !pagesError && pages.length > 0 && (
                <>
                  <span className="selftest-select-count">已选 {selectedPageIds.size}/{pages.length}</span>
                  <button
                    className="selftest-btn selftest-btn-mini"
                    onClick={() => setSelectedPageIds(new Set(pages.map((p) => p.id)))}
                  >全选</button>
                  <button
                    className="selftest-btn selftest-btn-mini"
                    onClick={() => setSelectedPageIds(new Set())}
                  >清空</button>
                </>
              )}
            </div>
            {pages === null ? (
              <div className="selftest-hint">页面清单加载中…</div>
            ) : pagesError ? (
              <div className="selftest-fail">{pagesError}</div>
            ) : pages.length === 0 ? (
              <div className="selftest-hint">应用暂无页面，将只执行业务链路（纯流程应用）</div>
            ) : (
              <>
                <div className="selftest-select-hint">支持单选/多选；全不选则跳过页面冒烟</div>
                <div className="selftest-chip-grid">
                  {pages.map((p) => (
                    <label
                      key={p.id}
                      className={`selftest-chip ${selectedPageIds.has(p.id) ? 'selftest-chip-on' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPageIds.has(p.id)}
                        onChange={() => togglePage(p.id)}
                      />
                      <span title={p.name}>{p.name}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {(phase === 'idle' || phase === 'failed' || phase === 'done') && (
          <div className="selftest-section">
            <div className="selftest-select-head">
              <h4>业务链路流程</h4>
              {chainCandidates !== null && !chainError && chainCandidates.length > 0 && (
                <>
                  <span className="selftest-select-count">已选 {selectedChainIds.size}/{chainCandidates.length}</span>
                  <button
                    className="selftest-btn selftest-btn-mini"
                    onClick={() => setSelectedChainIds(new Set(chainCandidates.map((c) => c.workflowId)))}
                  >全选</button>
                  <button
                    className="selftest-btn selftest-btn-mini"
                    onClick={() => setSelectedChainIds(new Set())}
                  >清空</button>
                </>
              )}
            </div>
            {chainCandidates === null ? (
              <div className="selftest-hint">流程清单加载中…</div>
            ) : chainError ? (
              <div className="selftest-fail">{chainError}</div>
            ) : chainCandidates.length === 0 ? (
              <div className="selftest-hint">应用内没有"已发布且绑定表单"的流程，将跳过业务链路（纯查询/页面应用）</div>
            ) : (
              <>
                <div className="selftest-select-hint">每条流程各生成一段"写库 → 发起 → 审批 → 触发器"子链路；全不选则跳过业务链路</div>
                <div className="selftest-chip-grid">
                  {chainCandidates.map((c) => (
                    <label
                      key={c.workflowId}
                      className={`selftest-chip ${selectedChainIds.has(c.workflowId) ? 'selftest-chip-on' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedChainIds.has(c.workflowId)}
                        onChange={() => toggleChain(c.workflowId)}
                      />
                      <span title={c.name}>{c.name}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {(phase === 'idle' || phase === 'failed' || phase === 'done') && (
          <div className="selftest-section">
            <div className="selftest-select-head">
              <h4>历史运行</h4>
              {history !== null && !historyError && history.length > 0 && (
                <span className="selftest-select-count">共 {history.length} 条</span>
              )}
            </div>
            {history === null ? (
              <div className="selftest-hint">历史加载中…</div>
            ) : historyError ? (
              <div className="selftest-hint">历史加载失败：{historyError}</div>
            ) : history.length === 0 ? (
              <div className="selftest-hint">暂无历史运行（含 Agent 执行的自检，报告均持久化于此）</div>
            ) : (
              <div className="selftest-history">
                {history.map((r) => (
                  <button
                    key={r.runId}
                    className={`selftest-history-item ${viewingRunId === r.runId ? 'selftest-history-item-on' : ''}`}
                    onClick={() => openHistoryRun(r.runId)}
                    title={r.summary || ''}
                  >
                    <span className={`selftest-run-badge selftest-run-${r.status.toLowerCase()}`}>{runStatusText(r.status)}</span>
                    <span className="selftest-run-badge selftest-run-src">{r.source === 'AGENT' ? 'Agent' : '手工'}</span>
                    <span className="selftest-history-name">{r.testName || '(未命名用例)'}</span>
                    <span className="selftest-history-time">{formatTime(r.createdAt)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {errorMsg && <div className="selftest-section selftest-error">{errorMsg}</div>}

        {pageResults.length > 0 && (
          <div className="selftest-section">
            <h4>页面冒烟</h4>
            {pageResults.map((r) => (
              <div key={r.pageId} className="selftest-page-result">
                <b>{r.pageName}</b>{' '}
                {r.jsErrors.length === 0 && r.queryCalls.every((c) => c.ok)
                  ? <span className="selftest-pass"><i className="selftest-dot selftest-dot-pass" />无 JS 错误，{r.queryCalls.length} 个查询调用正常</span>
                  : <span className="selftest-fail"><i className="selftest-dot selftest-dot-fail" />存在问题</span>}
                {r.jsErrors.map((e, i) => <div key={`e${i}`} className="selftest-fail">JS 错误：{e}</div>)}
                {r.queryCalls.filter((c) => !c.ok).map((c, i) => (
                  <div key={`q${i}`} className="selftest-fail">查询 {c.name} 失败：{c.error}</div>
                ))}
                {r.queryCalls.length === 0 && <div className="selftest-hint">未记录到页面初始化触发的查询</div>}
              </div>
            ))}
          </div>
        )}

        {report && (
          <div className="selftest-section">
            <h4>
              业务链路{' '}
              <span className={report.passed ? 'selftest-pass' : 'selftest-fail'}>
                <i className={`selftest-dot ${report.passed ? 'selftest-dot-pass' : 'selftest-dot-fail'}`} />
                {report.passed ? '通过' : '未通过'}
              </span>
            </h4>
            <div className="selftest-hint">
              {viewingRunId ? `runId: ${viewingRunId} · ` : ''}{report.summary}
            </div>
            <table className="selftest-table">
              <thead><tr><th>步骤</th><th>类型</th><th>结果</th><th>耗时</th><th>说明</th></tr></thead>
              <tbody>
                {report.steps.map((s) => (
                  <tr key={s.id}>
                    <td>{s.id}</td>
                    <td>{s.type}</td>
                    <td className={s.passed ? 'selftest-pass' : 'selftest-fail'}>{s.passed ? '通过' : '失败'}</td>
                    <td>{s.durationMs}ms</td>
                    <td>{s.error || summarizeEvidence(s.evidence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.cleanupLog.length > 0 && <div>自动清理：{report.cleanupLog.join('；')}</div>}
            {report.residuals.length > 0 && (
              <div className="selftest-fail">测试残留（需人工处理）：{report.residuals.join('；')}</div>
            )}
            {report.warnings.map((w, i) => <div key={i} className="selftest-hint">警告：{w}</div>)}
          </div>
        )}

        {gaps.length > 0 && (
          <div className="selftest-section">
            <h4>可测性缺口</h4>
            {gaps.map((g, i) => <div key={i} className="selftest-hint">- {g}</div>)}
          </div>
        )}
        {notes.length > 0 && (
          <div className="selftest-section">
            <h4>提取说明</h4>
            {notes.map((n, i) => <div key={i} className="selftest-hint">- {n}</div>)}
          </div>
        )}

        {phase === 'done' && (
          <div className="selftest-section">
            <div className={overallPassed ? 'selftest-pass selftest-overall' : 'selftest-fail selftest-overall'}>
              <i className={`selftest-dot ${overallPassed ? 'selftest-dot-pass' : 'selftest-dot-fail'}`} />
              {overallPassed ? '自检全部通过' : '自检存在问题，见上方明细'}
            </div>
          </div>
        )}
      </div>

      {/* 页面冒烟隐藏沙箱：与设计器预览同路径渲染，仅位置移出可视区 */}
      {smokePage && (
        <div style={{ position: 'fixed', left: -99999, top: 0, width: 1280, height: 800, pointerEvents: 'none' }} aria-hidden>
          <InteliPreview
            codePage={smokePage.codePage}
            queries={queries}
            userInfo={userInfo}
            applicationId={appId}
            journalRef={journalRef}
          />
        </div>
      )}
    </div>
  );
}

function runStatusText(status: SelfTestRun['status']): string {
  switch (status) {
    case 'RUNNING': return '运行中';
    case 'PASSED': return '通过';
    case 'FAILED': return '未通过';
    case 'ABORTED': return '已中断';
    default: return status;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { hour12: false });
}

function summarizeEvidence(evidence: Record<string, unknown> | null): string {
  if (!evidence) return '';
  const parts: string[] = [];
  if (evidence.insertId != null) parts.push(`insertId=${evidence.insertId}`);
  if (evidence.instanceId != null) parts.push(`instanceId=${evidence.instanceId}`);
  if (evidence.captured != null) parts.push(String(evidence.captured));
  const triggers = evidence.triggers as Array<{ triggerId: string; status: string }> | undefined;
  if (triggers?.length) parts.push(triggers.map((t) => `${t.triggerId}=${t.status}`).join(', '));
  return parts.join('；');
}
