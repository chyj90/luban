import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, CheckCircle, Clock, AlertCircle, AlertTriangle, RefreshCw,
  Brain, Database, Zap, ShieldCheck, Loader2, X, XCircle, ChevronRight, ScrollText,
} from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import {
  getAgentMetricsOverview, getAgentMetricsConceptHealth, getAgentMetricsAnomalies,
  getAgentMetricsRequests, getAgentQueryDetail, getFaissHealth,
} from '@/api/agent';
import { getEmbeddingHealth, rebuildConceptIndex, regenerateAllEmbeddings } from '@/api/concept';
import type {
  MetricsOverview, ConceptHealth, Anomaly, FaissHealth, RequestLogItem, QueryDetail,
} from '@/api/agent';
import type { EmbeddingHealth } from '@/api/concept';
import { useToastStore } from '@/stores/toastStore';
import './GatewayPage.css';

const TIME_RANGES = [
  { key: '1h', label: '最近 1 小时', hours: 1 },
  { key: '24h', label: '最近 24 小时', hours: 24 },
  { key: '7d', label: '最近 7 天', hours: 168 },
] as const;

const DECISION_LABELS: Record<string, string> = {
  tool_call: 'API 工具',
  nl2sql: 'SQL 查询',
  final_answer: '直接回答',
};

const DECISION_COLORS: Record<string, string> = {
  tool_call: '#1677ff',
  nl2sql: '#52c41a',
  final_answer: '#722ed1',
};

const ANOMALY_TYPE_LABELS: Record<string, string> = {
  sql_success_rate_low: 'SQL 成功率',
  llm_latency_high: 'LLM 延迟',
  execution_latency_high: 'SQL 执行延迟',
  feedback_rate_high: '用户反馈',
  permission_denied_rate_high: '权限拦截',
};

export default function GatewayPage() {
  const [timeKey, setTimeKey] = useState<string>('24h');
  const hours = TIME_RANGES.find((r) => r.key === timeKey)?.hours ?? 24;

  const [overview, setOverview] = useState<MetricsOverview | null>(null);
  const [conceptHealth, setConceptHealth] = useState<ConceptHealth[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [faissHealth, setFaissHealth] = useState<FaissHealth | null>(null);
  const [requests, setRequests] = useState<RequestLogItem[]>([]);
  const [failedOnly, setFailedOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [requestsLoading, setRequestsLoading] = useState(false);

  const [embeddingHealth, setEmbeddingHealth] = useState<EmbeddingHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<QueryDetail | null>(null);
  const [detailError, setDetailError] = useState('');

  const toast = useToastStore((s) => s.show);
  const logSectionRef = useRef<HTMLDivElement>(null);

  const fetchEmbeddingHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const res = await getEmbeddingHealth();
      setEmbeddingHealth(res.data);
    } catch {
      toast('获取语义层健康状态失败', 'error');
    } finally {
      setHealthLoading(false);
    }
  }, [toast]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [ovRes, chRes, anRes, fhRes] = await Promise.all([
        getAgentMetricsOverview(hours),
        getAgentMetricsConceptHealth(hours),
        getAgentMetricsAnomalies(hours),
        getFaissHealth(),
      ]);
      if (ovRes.success) setOverview(ovRes.data);
      if (chRes.success) setConceptHealth(chRes.data || []);
      if (anRes.success) setAnomalies(anRes.data || []);
      if (fhRes.success) setFaissHealth(fhRes.data);
    } catch (e) {
      console.error('Failed to fetch agent metrics', e);
    } finally {
      setLoading(false);
    }
  }, [hours]);

  const fetchRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const res = await getAgentMetricsRequests(hours, failedOnly, 200);
      if (res.success) setRequests(res.data || []);
    } catch (e) {
      console.error('Failed to fetch request logs', e);
    } finally {
      setRequestsLoading(false);
    }
  }, [hours, failedOnly]);

  useEffect(() => {
    fetchData();
    fetchEmbeddingHealth();
  }, [fetchData, fetchEmbeddingHealth]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // ===== 详情抽屉 =====
  const openDetail = useCallback(async (messageId: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    setDetailError('');
    try {
      const res = await getAgentQueryDetail(messageId);
      if (res.success) setDetail(res.data);
      else setDetailError('加载请求详情失败');
    } catch (e) {
      setDetailError((e as Error).message || '加载请求详情失败');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!detailOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailOpen]);

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      const res = await rebuildConceptIndex();
      toast(res.data.message || '索引重建完成', 'success');
      fetchEmbeddingHealth();
    } catch {
      toast('索引重建失败', 'error');
    } finally {
      setRebuilding(false);
    }
  };

  const handleRegenerateAll = async () => {
    setRegenerating(true);
    try {
      const res = await regenerateAllEmbeddings();
      toast(res.data.message || '全量 Embedding 生成完成', 'success');
      fetchEmbeddingHealth();
    } catch {
      toast('全量 Embedding 生成失败', 'error');
    } finally {
      setRegenerating(false);
    }
  };

  /** 点击异常/异常 KPI：切到"仅失败"并滚动到请求日志 */
  const viewFailedRequests = () => {
    setFailedOnly(true);
    logSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ===== 展示数据派生 =====
  const formatDuration = (ms?: number | null) => {
    if (ms == null) return '-';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatDateTime = (iso?: string | null) => {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };

  const totalRequests = overview?.totalRequests ?? 0;
  const sqlExecuted = overview?.sqlExecuted ?? 0;
  const sqlSuccess = overview?.sqlSuccess ?? 0;
  const sqlSuccessRate = overview?.sqlSuccessRate ?? 0;
  const sqlFailed = Math.max(sqlExecuted - sqlSuccess, 0);
  const avgLatency = overview?.avgTotalLatencyMs ?? 0;
  const p95Latency = overview?.p95TotalLatencyMs ?? 0;
  const feedbackGiven = overview?.feedbackGiven ?? 0;
  const permissionDenied = overview?.permissionDenied ?? 0;
  const anomalyCount = anomalies.length;

  const hasSql = sqlExecuted > 0;
  const rateLevel = !hasSql ? 'none' : sqlSuccessRate >= 90 ? 'good' : sqlSuccessRate >= 70 ? 'warn' : 'bad';

  const decisionDist = overview?.decisionDistribution ?? {};
  const decisionTotal = Object.values(decisionDist).reduce((s, v) => s + (v as number), 0);
  const decisions = Object.entries(DECISION_LABELS).map(([key, label]) => ({
    key,
    label,
    count: (decisionDist[key] as number) || 0,
    color: DECISION_COLORS[key],
  }));

  const embedded = embeddingHealth?.embeddedConcepts ?? 0;
  const totalConcepts = embeddingHealth?.totalConcepts ?? 0;
  const coverage = embeddingHealth?.coverageRate ?? 0;
  const faissOk = embeddingHealth?.faissHealthy ?? false;
  const indexTotal = typeof embeddingHealth?.indexStats?.total_indexed === 'number'
    ? embeddingHealth.indexStats.total_indexed : 0;

  return (
    <div className="monitor">
      <PageTopbar
        icon={<Activity size={22} />}
        title="Agent 监控"
        subtitle="问数请求成功率、延迟与异常下钻，语义层索引维护"
        actions={
          <div className="monitor-header-right">
            <div className="monitor-time-range">
              {TIME_RANGES.map((r) => (
                <button
                  key={r.key}
                  className={`monitor-time-btn ${timeKey === r.key ? 'active' : ''}`}
                  onClick={() => setTimeKey(r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              className="monitor-refresh-btn"
              onClick={() => { fetchData(); fetchEmbeddingHealth(); fetchRequests(); }}
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'monitor-refresh-spin' : ''} />
              刷新
            </button>
          </div>
        }
      />

      <div className="monitor-content">
        {/* ===== KPI 行 ===== */}
        <div className="monitor-summary">
          <div className="monitor-summary-card">
            <div className="monitor-summary-icon monitor-summary-icon--blue"><Brain size={20} /></div>
            <div className="monitor-summary-info">
              <span className="monitor-summary-label">请求量</span>
              <span className="monitor-summary-value">
                {totalRequests.toLocaleString()}
                <DeltaBadge cur={totalRequests} prev={overview?.totalRequestsPrev} neutral />
              </span>
              <div className="monitor-kpi-bar">
                {decisions.map((d) => (
                  d.count > 0 && (
                    <div
                      key={d.key}
                      className="monitor-kpi-bar-seg"
                      style={{ width: `${decisionTotal > 0 ? (d.count / decisionTotal) * 100 : 0}%`, background: d.color }}
                      title={`${d.label} ${d.count}`}
                    />
                  )
                ))}
              </div>
              <div className="monitor-kpi-legend">
                {decisions.map((d) => (
                  <span key={d.key} className="monitor-kpi-legend-item">
                    <i style={{ background: d.color }} />
                    {d.label} {d.count}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="monitor-summary-card">
            <div className={`monitor-summary-icon monitor-summary-icon--${rateLevel === 'good' ? 'green' : rateLevel === 'warn' ? 'amber' : rateLevel === 'bad' ? 'red' : 'gray'}`}>
              {rateLevel === 'bad' ? <XCircle size={20} /> : <CheckCircle size={20} />}
            </div>
            <div className="monitor-summary-info">
              <span className="monitor-summary-label">SQL 成功率</span>
              <span
                className="monitor-summary-value"
                style={{ color: rateLevel === 'good' ? '#52c41a' : rateLevel === 'warn' ? '#fa8c16' : rateLevel === 'bad' ? '#ff4d4f' : '#8c8c8c' }}
              >
                {hasSql ? `${sqlSuccessRate}%` : '—'}
              </span>
              <span className="monitor-summary-sub">
                {hasSql ? `成功 ${sqlSuccess} / 执行 ${sqlExecuted} 次` : '窗口内无 SQL 执行'}
              </span>
            </div>
          </div>

          <div className="monitor-summary-card">
            <div className="monitor-summary-icon monitor-summary-icon--purple"><Clock size={20} /></div>
            <div className="monitor-summary-info">
              <span className="monitor-summary-label">平均延迟</span>
              <span className="monitor-summary-value">
                {formatDuration(avgLatency)}
                <DeltaBadge
                  cur={avgLatency}
                  prev={overview?.avgTotalLatencyMsPrev}
                  invert
                />
              </span>
              <span className="monitor-summary-sub">P95 {formatDuration(p95Latency)}</span>
            </div>
          </div>

          <div
            className={`monitor-summary-card ${anomalyCount > 0 ? 'monitor-summary-card--clickable' : ''}`}
            onClick={anomalyCount > 0 ? viewFailedRequests : undefined}
            title={anomalyCount > 0 ? '点击查看失败请求' : undefined}
          >
            <div className={`monitor-summary-icon ${anomalyCount > 0 ? 'monitor-summary-icon--red' : 'monitor-summary-icon--green'}`}>
              {anomalyCount > 0 ? <AlertCircle size={20} /> : <ShieldCheck size={20} />}
            </div>
            <div className="monitor-summary-info">
              <span className="monitor-summary-label">异常与反馈</span>
              <span className="monitor-summary-value" style={{ color: anomalyCount > 0 ? '#ff4d4f' : '#52c41a' }}>
                {anomalyCount > 0 ? `${anomalyCount} 项告警` : '无告警'}
              </span>
              <span className="monitor-summary-sub">反馈 {feedbackGiven} · 权限拒绝 {permissionDenied}</span>
            </div>
            {anomalyCount > 0 && <ChevronRight size={16} className="monitor-card-arrow" />}
          </div>

          <div className="monitor-summary-card">
            <div className={`monitor-summary-icon ${faissOk && coverage >= 80 ? 'monitor-summary-icon--teal' : 'monitor-summary-icon--amber'}`}>
              <Database size={20} />
            </div>
            <div className="monitor-summary-info">
              <span className="monitor-summary-label">语义层</span>
              <span className="monitor-summary-value" style={{ color: faissOk && coverage >= 80 ? '#1f1f1f' : '#fa8c16' }}>
                {healthLoading ? '...' : `${embedded}/${totalConcepts}`}
              </span>
              <span className="monitor-summary-sub">
                FAISS {faissOk ? '正常' : '异常'} · 覆盖率 {coverage}% · 索引 {indexTotal}
              </span>
            </div>
          </div>
        </div>

        {/* ===== 异常告警（需要处理的事，紧挨 KPI）===== */}
        <div className="monitor-section">
          <h3 className="monitor-section-title">
            <AlertTriangle size={16} />
            异常告警
            {anomalyCount > 0 && <span className="monitor-count-badge">{anomalyCount}</span>}
          </h3>
          {anomalies.length > 0 ? (
            <div className="monitor-anomaly-list">
              {anomalies.map((a, i) => (
                <div
                  key={i}
                  className={`monitor-anomaly-card monitor-anomaly-card--${a.level} ${a.type === 'sql_success_rate_low' ? 'monitor-anomaly-card--clickable' : ''}`}
                  onClick={a.type === 'sql_success_rate_low' ? viewFailedRequests : undefined}
                >
                  <div className="monitor-anomaly-card-header">
                    <span className="monitor-anomaly-card-type">
                      {ANOMALY_TYPE_LABELS[a.type] || a.type}
                    </span>
                    <span className="monitor-anomaly-card-time">{formatDateTime(a.time)}</span>
                  </div>
                  <p className="monitor-anomaly-card-message">{a.message}</p>
                  <p className="monitor-anomaly-card-detail">
                    {a.detail}
                    {a.type === 'sql_success_rate_low' && <span className="monitor-anomaly-card-action">查看失败请求 →</span>}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="monitor-anomaly-ok">
              <CheckCircle size={16} />
              所选窗口内无异常
            </div>
          )}
        </div>

        {/* ===== 请求日志（下钻）===== */}
        <div className="monitor-section" ref={logSectionRef}>
          <div className="monitor-section-header">
            <h3 className="monitor-section-title">
              <ScrollText size={16} />
              请求日志
              <span className="monitor-section-hint">点击行查看决策、生成 SQL 与报错详情</span>
            </h3>
            <div className="monitor-log-filters">
              <button
                className={`monitor-chip ${!failedOnly ? 'monitor-chip--active' : ''}`}
                onClick={() => setFailedOnly(false)}
              >
                全部
              </button>
              <button
                className={`monitor-chip ${failedOnly ? 'monitor-chip--active' : ''}`}
                onClick={() => setFailedOnly(true)}
              >
                仅失败{sqlFailed > 0 ? ` (${sqlFailed})` : ''}
              </button>
            </div>
          </div>
          <div className="monitor-tool-table-wrap">
            <table className="monitor-table">
              <thead>
                <tr>
                  <th style={{ width: 130 }}>时间</th>
                  <th>用户问题</th>
                  <th style={{ width: 110 }}>决策</th>
                  <th style={{ width: 80 }}>概念命中</th>
                  <th style={{ width: 90 }}>延迟</th>
                  <th style={{ width: 100 }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr
                    key={r.messageId}
                    className="monitor-table-row-clickable"
                    onClick={() => openDetail(r.messageId)}
                  >
                    <td className="monitor-table-time">{formatDateTime(r.createdAt)}</td>
                    <td className="monitor-table-query" title={r.userQuery}>{r.userQuery || '-'}</td>
                    <td>
                      <span className="monitor-decision-dot" style={{ background: DECISION_COLORS[r.decisionType] || '#8c8c8c' }} />
                      {DECISION_LABELS[r.decisionType] || r.decisionType || '-'}
                    </td>
                    <td>{r.conceptMatchCount > 0 ? `${r.conceptMatchCount}(+${r.conceptExpandCount})` : '-'}</td>
                    <td>{formatDuration(r.totalLatencyMs)}</td>
                    <td>
                      {r.permissionDenied
                        ? <span className="monitor-tag monitor-tag--neutral">已拦截</span>
                        : !r.sqlExecuted
                          ? <span className="monitor-tag monitor-tag--blue">直接回答</span>
                          : r.sqlSuccess
                            ? <span className="monitor-tag monitor-tag--success">SQL 成功</span>
                            : <span className="monitor-tag monitor-tag--fail" title={r.sqlError || ''}>SQL 失败</span>}
                    </td>
                  </tr>
                ))}
                {requests.length === 0 && (
                  <tr>
                    <td colSpan={6} className="monitor-table-empty">
                      {requestsLoading ? '加载中...' : failedOnly ? '窗口内无失败请求' : '窗口内暂无请求日志'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ===== 概念健康度 ===== */}
        <div className="monitor-section">
          <h3 className="monitor-section-title">
            <Database size={16} />
            概念健康度
          </h3>
          <div className="monitor-tool-table-wrap">
            <table className="monitor-table">
              <thead>
                <tr>
                  <th>概念</th>
                  <th>查询次数</th>
                  <th>SQL 成功率</th>
                  <th>反馈数</th>
                  <th>健康状态</th>
                </tr>
              </thead>
              <tbody>
                {conceptHealth.map((ch) => {
                  const rate = ch.sqlSuccessRate;
                  const status = rate >= 90 ? 'healthy' : rate >= 70 ? 'warning' : 'critical';
                  return (
                    <tr key={ch.conceptId}>
                      <td className="monitor-table-tool-name">
                        {ch.conceptName || `概念 #${ch.conceptId}`}
                        <span className="monitor-table-subid">ID {ch.conceptId}</span>
                      </td>
                      <td>{ch.totalQueries}</td>
                      <td>
                        <span style={{ color: rate >= 90 ? '#52c41a' : rate >= 70 ? '#faad14' : '#ff4d4f', fontWeight: 500 }}>
                          {ch.sqlTotal > 0 ? `${rate}%` : '-'}
                        </span>
                      </td>
                      <td>
                        <span style={{ color: ch.feedbackCount > 0 ? '#ff4d4f' : '#8c8c8c' }}>
                          {ch.feedbackCount}
                        </span>
                      </td>
                      <td>
                        <span className={`monitor-health-badge monitor-health-badge--${status}`}>
                          {status === 'healthy' ? '健康' : status === 'warning' ? '警告' : '严重'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {conceptHealth.length === 0 && (
                  <tr>
                    <td colSpan={5} className="monitor-table-empty">窗口内暂无概念查询数据</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ===== 语义层维护（紧凑条）===== */}
        <div className="monitor-section">
          <div className="monitor-section-header">
            <h3 className="monitor-section-title">
              <ShieldCheck size={16} />
              语义层维护
            </h3>
            <div className="monitor-health-actions">
              <button className="btnPrimary" disabled={rebuilding} onClick={handleRebuild}>
                {rebuilding ? <><Loader2 size={14} className="monitor-refresh-spin" />重建中...</> : <><RefreshCw size={14} />重建索引</>}
              </button>
              <button className="btnOutline" disabled={regenerating} onClick={handleRegenerateAll}>
                {regenerating ? <><Loader2 size={14} className="monitor-refresh-spin" />生成中...</> : <><Zap size={14} />全量生成</>}
              </button>
            </div>
          </div>
          <div className="monitor-semantic">
            <div className="monitor-semantic-item">
              <span className="monitor-semantic-label">FAISS 服务</span>
              <span className="monitor-semantic-value" style={{ color: faissOk ? '#52c41a' : '#ff4d4f' }}>
                {healthLoading ? '检测中...' : faissOk ? '正常' : '异常'}
              </span>
            </div>
            <div className="monitor-semantic-divider" />
            <div className="monitor-semantic-item monitor-semantic-item--wide">
              <span className="monitor-semantic-label">概念向量化</span>
              <span className="monitor-semantic-value">
                {healthLoading ? '...' : `${embedded}/${totalConcepts}`}
                <span className="monitor-semantic-unit">（{coverage}%）</span>
              </span>
              <div className="healthProgressBar">
                <div
                  className="healthProgressFill"
                  style={{ width: `${coverage}%`, background: coverage >= 80 ? '#52c41a' : coverage >= 50 ? '#fa8c16' : '#ff4d4f' }}
                />
              </div>
            </div>
            <div className="monitor-semantic-divider" />
            <div className="monitor-semantic-item">
              <span className="monitor-semantic-label">索引概念数</span>
              <span className="monitor-semantic-value">{healthLoading ? '...' : indexTotal}</span>
            </div>
            <div className="monitor-semantic-divider" />
            <div className="monitor-semantic-item">
              <span className="monitor-semantic-label">模型版本</span>
              <span className="monitor-semantic-value monitor-semantic-value--sm">
                {healthLoading ? '...' : embeddingHealth?.embeddingModelVersion || '-'}
              </span>
            </div>
            <div className="monitor-semantic-divider" />
            <div className="monitor-semantic-item">
              <span className="monitor-semantic-label">最近重建</span>
              <span className="monitor-semantic-value monitor-semantic-value--sm">
                {faissHealth?.lastRebuild ? formatDateTime(faissHealth.lastRebuild) : '—'}
              </span>
            </div>
            {!healthLoading && coverage < 80 && totalConcepts > 0 && (
              <span className="monitor-semantic-warn">
                <AlertTriangle size={13} />
                覆盖率偏低，建议执行全量生成
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ===== 请求详情抽屉 ===== */}
      {detailOpen && (
        <div className="monitor-drawer-backdrop" onClick={() => setDetailOpen(false)}>
          <div className="monitor-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="monitor-drawer-header">
              <h3>请求详情</h3>
              <button className="monitor-drawer-close" onClick={() => setDetailOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="monitor-drawer-body">
              {detailLoading && (
                <div className="monitor-drawer-loading">
                  <Loader2 size={18} className="monitor-refresh-spin" />
                  加载中...
                </div>
              )}
              {!detailLoading && detailError && (
                <div className="monitor-drawer-error">{detailError}</div>
              )}
              {!detailLoading && detail && !detail.found && (
                <div className="monitor-drawer-error">未找到该请求记录</div>
              )}
              {!detailLoading && detail?.found && (
                <>
                  <div className="monitor-detail-query">{detail.userQuery}</div>

                  <div className="monitor-detail-status">
                    {detail.permissionDenied
                      ? <span className="monitor-tag monitor-tag--neutral">权限拦截</span>
                      : !detail.sqlExecuted
                        ? <span className="monitor-tag monitor-tag--blue">{DECISION_LABELS[detail.decisionType || ''] || '直接回答'}</span>
                        : detail.sqlSuccess
                          ? <span className="monitor-tag monitor-tag--success">SQL 执行成功</span>
                          : <span className="monitor-tag monitor-tag--fail">SQL 执行失败</span>}
                    {detail.feedbackGiven && <span className="monitor-tag monitor-tag--fail">用户已反馈</span>}
                  </div>

                  <div className="monitor-detail-meta">
                    <div className="monitor-detail-meta-item">
                      <span className="monitor-detail-meta-label">时间</span>
                      <span>{formatDateTime(detail.createdAt)}</span>
                    </div>
                    <div className="monitor-detail-meta-item">
                      <span className="monitor-detail-meta-label">决策</span>
                      <span>{DECISION_LABELS[detail.decisionType || ''] || detail.decisionType || '-'}</span>
                    </div>
                    <div className="monitor-detail-meta-item">
                      <span className="monitor-detail-meta-label">概念命中</span>
                      <span>{detail.conceptMatchCount ?? 0}（扩展 {detail.conceptExpandCount ?? 0}）</span>
                    </div>
                    <div className="monitor-detail-meta-item">
                      <span className="monitor-detail-meta-label">API 工具</span>
                      <span>{detail.apiToolCount ?? 0} 个</span>
                    </div>
                    <div className="monitor-detail-meta-item">
                      <span className="monitor-detail-meta-label">会话</span>
                      <span className="monitor-detail-mono">{detail.sessionId || '-'}</span>
                    </div>
                    <div className="monitor-detail-meta-item">
                      <span className="monitor-detail-meta-label">消息</span>
                      <span className="monitor-detail-mono">{detail.messageId || '-'}</span>
                    </div>
                  </div>

                  <div className="monitor-detail-latencies">
                    {(detail.llmLatencyMs ?? 0) > 0 && (
                      <div className="monitor-detail-latency">
                        <span className="monitor-detail-latency-label">LLM 生成</span>
                        <span className="monitor-detail-latency-value">{formatDuration(detail.llmLatencyMs)}</span>
                      </div>
                    )}
                    {(detail.executionLatencyMs ?? 0) > 0 && (
                      <div className="monitor-detail-latency">
                        <span className="monitor-detail-latency-label">SQL 执行</span>
                        <span className="monitor-detail-latency-value">{formatDuration(detail.executionLatencyMs)}</span>
                      </div>
                    )}
                    <div className="monitor-detail-latency">
                      <span className="monitor-detail-latency-label">总耗时</span>
                      <span className="monitor-detail-latency-value">{formatDuration(detail.totalLatencyMs)}</span>
                    </div>
                  </div>
                  {(detail.llmLatencyMs ?? 0) === 0 && (detail.executionLatencyMs ?? 0) === 0 && (detail.totalLatencyMs ?? 0) > 0 && (
                    <div className="monitor-detail-latency-note">该请求分段耗时未记录（可能在中途失败），仅总耗时有效</div>
                  )}

                  {(detail.sqlGenerated || detail.sqlError) && (
                    <div className="monitor-detail-sql">
                      <span className="monitor-detail-section-label">生成 SQL</span>
                      {detail.sqlGenerated ? (
                        <pre className="monitor-detail-code">{detail.sqlGenerated}</pre>
                      ) : (
                        <span className="monitor-detail-mono monitor-detail-muted">（未生成）</span>
                      )}
                      {detail.sqlError && (
                        <div className="monitor-detail-error-box">
                          <AlertCircle size={14} />
                          {detail.sqlError}
                        </div>
                      )}
                    </div>
                  )}

                  {detail.conceptIds && (
                    <div className="monitor-detail-sql">
                      <span className="monitor-detail-section-label">关联概念</span>
                      <span className="monitor-detail-mono monitor-detail-muted">
                        {detail.conceptIds.replace(/[\[\]"]/g, '') || '-'}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** KPI 环比徽章：invert=true 表示上涨为坏（如延迟）；neutral 表示涨跌不加好坏色；无基线且有值时显示"新增" */
function DeltaBadge({ cur, prev, invert, neutral }: { cur: number; prev?: number; invert?: boolean; neutral?: boolean }) {
  if (prev == null) return null;
  if (prev === 0) {
    return cur > 0 ? <span className="monitor-delta monitor-delta--new">新增</span> : null;
  }
  const change = Math.round(((cur - prev) / prev) * 100);
  if (change === 0) return <span className="monitor-delta monitor-delta--flat">持平</span>;
  const up = change > 0;
  const good = neutral ? true : invert ? !up : up;
  return (
    <span className={`monitor-delta ${good ? 'monitor-delta--good' : 'monitor-delta--bad'}`}>
      {up ? '↑' : '↓'}
      {Math.abs(change)}%
    </span>
  );
}
