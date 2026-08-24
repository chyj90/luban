import { useState, useEffect, useCallback } from 'react';
import { Activity, CheckCircle, Clock, AlertCircle, RefreshCw, Brain, Database, Zap, BarChart3, Cpu, ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import { getAgentMetricsOverview, getAgentMetricsConceptHealth, getAgentMetricsAnomalies, getFaissHealth } from '@/api/agent';
import { getEmbeddingHealth, rebuildConceptIndex, regenerateAllEmbeddings } from '@/api/concept';
import type { MetricsOverview, ConceptHealth, Anomaly, FaissHealth } from '@/api/agent';
import type { EmbeddingHealth } from '@/api/concept';
import { useToastStore } from '@/stores/toastStore';
import './GatewayPage.css';

const TIME_RANGES = [
  { key: '1h', label: '最近 1 小时' },
  { key: '24h', label: '最近 24 小时' },
  { key: '7d', label: '最近 7 天' },
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

export default function GatewayPage() {
  const [timeRange, setTimeRange] = useState<string>('24h');
  const [overview, setOverview] = useState<MetricsOverview | null>(null);
  const [conceptHealth, setConceptHealth] = useState<ConceptHealth[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [faissHealth, setFaissHealth] = useState<FaissHealth | null>(null);
  const [loading, setLoading] = useState(false);

  const [embeddingHealth, setEmbeddingHealth] = useState<EmbeddingHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const toast = useToastStore((s) => s.show);

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

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      const res = await rebuildConceptIndex();
      toast(res.data.message || '索引重建任务已提交', 'success');
      fetchEmbeddingHealth();
    } catch {
      toast('提交重建任务失败', 'error');
    } finally {
      setRebuilding(false);
    }
  };

  const handleRegenerateAll = async () => {
    setRegenerating(true);
    try {
      const res = await regenerateAllEmbeddings();
      toast(res.data.message || '全量重新生成任务已提交', 'success');
      fetchEmbeddingHealth();
    } catch {
      toast('提交全量生成任务失败', 'error');
    } finally {
      setRegenerating(false);
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [ovRes, chRes, anRes, fhRes] = await Promise.all([
        getAgentMetricsOverview(),
        getAgentMetricsConceptHealth(),
        getAgentMetricsAnomalies(),
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
  }, []);

  useEffect(() => {
    fetchData();
    fetchEmbeddingHealth();
  }, [fetchData, fetchEmbeddingHealth]);

  const formatDuration = (ms: number) => {
    if (!ms || ms < 1000) return `${ms || 0}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const totalRequests = overview?.totalRequests ?? 0;
  const sqlSuccessRate = overview?.sqlSuccessRate ?? 0;
  const avgLatency = overview?.avgTotalLatencyMs ?? 0;
  const anomalyCount = anomalies.length;
  const embeddingCoverage = faissHealth?.embeddingCoverage ?? 0;
  const faissIndexes = faissHealth?.indexes ?? 0;
  const faissOk = faissHealth?.isHealthy ?? false;

  const decisionDist = overview?.decisionDistribution ?? {};
  const decisionTotal = Object.values(decisionDist).reduce((s, v) => s + (v as number), 0);

  return (
    <div className="monitor">
      <PageTopbar
        icon={<Activity size={22} />}
        title="Agent 监控"
        subtitle="监控 Agent 问数请求、决策分布、SQL 成功率与异常告警"
        actions={
          <div className="monitor-header-right">
            <div className="monitor-time-range">
              {TIME_RANGES.map((r) => (
                <button
                  key={r.key}
                  className={`monitor-time-btn ${timeRange === r.key ? 'active' : ''}`}
                  onClick={() => setTimeRange(r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button className="monitor-refresh-btn" onClick={() => { fetchData(); fetchEmbeddingHealth(); }}
              disabled={loading}>
              <RefreshCw size={14} className={loading ? 'monitor-refresh-spin' : ''} />
              刷新
            </button>
          </div>
        }
      />

      <div className="monitor-content">
        <div className="monitor-summary">
          <div className="monitor-summary-card">
            <div className="monitor-summary-icon monitor-summary-icon--blue">
              <Brain size={20} />
            </div>
            <div className="monitor-summary-info">
              <span className="monitor-summary-label">总请求数</span>
              <span className="monitor-summary-value">{totalRequests.toLocaleString()}</span>
            </div>
          </div>
          <div className="monitor-summary-card">
            <div className="monitor-summary-icon monitor-summary-icon--green">
              <CheckCircle size={20} />
            </div>
            <div className="monitor-summary-info">
              <span className="monitor-summary-label">SQL 成功率</span>
              <span className="monitor-summary-value">{sqlSuccessRate}%</span>
            </div>
          </div>
          <div className="monitor-summary-card">
            <div className="monitor-summary-icon monitor-summary-icon--purple">
              <Clock size={20} />
            </div>
            <div className="monitor-summary-info">
              <span className="monitor-summary-label">平均延迟</span>
              <span className="monitor-summary-value">{formatDuration(avgLatency)}</span>
            </div>
          </div>
          <div className="monitor-summary-card">
            <div className="monitor-summary-icon monitor-summary-icon--red">
              <AlertCircle size={20} />
            </div>
            <div className="monitor-summary-info">
              <span className="monitor-summary-label">异常告警</span>
              <span className="monitor-summary-value">{anomalyCount}</span>
            </div>
          </div>
          <div className="monitor-summary-card">
            <div className="monitor-summary-icon monitor-summary-icon--teal">
              <Database size={20} />
            </div>
            <div className="monitor-summary-info">
              <span className="monitor-summary-label">Embedding 覆盖率</span>
              <span className="monitor-summary-value">{embeddingCoverage}%</span>
            </div>
          </div>
          <div className="monitor-summary-card">
            <div className="monitor-summary-icon monitor-summary-icon--orange">
              <BarChart3 size={20} />
            </div>
            <div className="monitor-summary-info">
              <span className="monitor-summary-label">FAISS 索引</span>
              <span className="monitor-summary-value">
                {faissIndexes} {faissOk ? '✓' : '⚠'}
              </span>
            </div>
          </div>
        </div>

        <div className="monitor-section">
          <div className="monitor-section-header">
            <h3 className="monitor-section-title">
              <ShieldCheck size={16} />
              语义层健康
            </h3>
            <div className="monitor-health-actions">
              <button
                className="btnPrimary"
                disabled={rebuilding}
                onClick={handleRebuild}
              >
                {rebuilding ? <><Loader2 size={14} className="monitor-refresh-spin" />重建中...</> : <><RefreshCw size={14} />重建索引</>}
              </button>
              <button
                className="btnOutline"
                disabled={regenerating}
                onClick={handleRegenerateAll}
              >
                {regenerating ? <><Loader2 size={14} className="monitor-refresh-spin" />生成中...</> : <><Zap size={14} />全量生成</>}
              </button>
            </div>
          </div>
          <div className="healthCards">
            <div className="healthCard">
              <div className="healthCardIcon" style={{ background: embeddingHealth?.faissHealthy ? '#f6ffed' : '#fff2f0' }}>
                <ShieldCheck size={20} color={embeddingHealth?.faissHealthy ? '#52c41a' : '#ff4d4f'} />
              </div>
              <div className="healthCardBody">
                <span className="healthCardLabel">FAISS 服务</span>
                <span className="healthCardValue" style={{ color: embeddingHealth?.faissHealthy ? '#52c41a' : '#ff4d4f' }}>
                  {healthLoading ? '检测中...' : embeddingHealth?.faissHealthy ? '正常' : '异常'}
                </span>
              </div>
            </div>
            <div className="healthCard">
              <div className="healthCardIcon" style={{ background: '#e6f4ff' }}>
                <Database size={20} color="#1677ff" />
              </div>
              <div className="healthCardBody">
                <span className="healthCardLabel">概念总数</span>
                <span className="healthCardValue">{healthLoading ? '...' : embeddingHealth?.totalConcepts ?? '-'}</span>
              </div>
            </div>
            <div className="healthCard">
              <div className="healthCardIcon" style={{ background: '#f0f5ff' }}>
                <Cpu size={20} color="#722ed1" />
              </div>
              <div className="healthCardBody">
                <span className="healthCardLabel">已向量化</span>
                <span className="healthCardValue">{healthLoading ? '...' : embeddingHealth?.embeddedConcepts ?? '-'}</span>
              </div>
            </div>
            <div className="healthCard">
              <div className="healthCardIcon" style={{ background: (embeddingHealth?.coverageRate ?? 0) >= 80 ? '#f6ffed' : (embeddingHealth?.coverageRate ?? 0) >= 50 ? '#fff7e6' : '#fff2f0' }}>
                <Activity size={20} color={(embeddingHealth?.coverageRate ?? 0) >= 80 ? '#52c41a' : (embeddingHealth?.coverageRate ?? 0) >= 50 ? '#fa8c16' : '#ff4d4f'} />
              </div>
              <div className="healthCardBody">
                <span className="healthCardLabel">覆盖率</span>
                <span className="healthCardValue" style={{ color: (embeddingHealth?.coverageRate ?? 0) >= 80 ? '#52c41a' : (embeddingHealth?.coverageRate ?? 0) >= 50 ? '#fa8c16' : '#ff4d4f' }}>
                  {healthLoading ? '...' : `${embeddingHealth?.coverageRate ?? 0}%`}
                </span>
                {embeddingHealth && embeddingHealth.totalConcepts > 0 && (
                  <div className="healthProgressBar">
                    <div className="healthProgressFill" style={{ width: `${embeddingHealth.coverageRate}%`, background: embeddingHealth.coverageRate >= 80 ? '#52c41a' : embeddingHealth.coverageRate >= 50 ? '#fa8c16' : '#ff4d4f' }} />
                  </div>
                )}
              </div>
            </div>
            <div className="healthCard">
              <div className="healthCardIcon" style={{ background: '#f9f0ff' }}>
                <Zap size={20} color="#531dab" />
              </div>
              <div className="healthCardBody">
                <span className="healthCardLabel">模型版本</span>
                <span className="healthCardValue healthCardValueSm">
                  {healthLoading ? '...' : embeddingHealth?.embeddingModelVersion ?? '-'}
                </span>
              </div>
            </div>
            <div className="healthCard">
              <div className="healthCardIcon" style={{ background: (embeddingHealth?.indexStats && typeof embeddingHealth.indexStats.total_indexed === 'number' && embeddingHealth.indexStats.total_indexed > 0) ? '#e6fffb' : '#fff7e6' }}>
                <Database size={20} color={(embeddingHealth?.indexStats && typeof embeddingHealth.indexStats.total_indexed === 'number' && embeddingHealth.indexStats.total_indexed > 0) ? '#13c2c2' : '#fa8c16'} />
              </div>
              <div className="healthCardBody">
                <span className="healthCardLabel">索引概念数</span>
                <span className="healthCardValue">
                  {healthLoading ? '...' : (embeddingHealth?.indexStats && typeof embeddingHealth.indexStats.total_indexed === 'number' ? embeddingHealth.indexStats.total_indexed : 0)}
                </span>
              </div>
            </div>
          </div>
          {embeddingHealth && !healthLoading && (
            <div className="healthMeta">
              <span className="healthMetaItem">
                最后重建：{embeddingHealth.lastRebuildAt ? new Date(embeddingHealth.lastRebuildAt).toLocaleString('zh-CN') : '从未'}
                <span className={`healthMetaStatus status-${embeddingHealth.lastRebuildStatus?.toLowerCase()}`}>
                  {embeddingHealth.lastRebuildStatus === 'COMPLETED' ? '✓' : embeddingHealth.lastRebuildStatus === 'FAILED' ? '✗' : embeddingHealth.lastRebuildStatus === 'never' ? '—' : '○'}
                </span>
              </span>
              <span className="healthMetaItem">
                最后全量生成：{embeddingHealth.lastRegenerateAt ? new Date(embeddingHealth.lastRegenerateAt).toLocaleString('zh-CN') : '从未'}
                <span className={`healthMetaStatus status-${embeddingHealth.lastRegenerateStatus?.toLowerCase()}`}>
                  {embeddingHealth.lastRegenerateStatus === 'COMPLETED' ? '✓' : embeddingHealth.lastRegenerateStatus === 'FAILED' ? '✗' : embeddingHealth.lastRegenerateStatus === 'never' ? '—' : '○'}
                </span>
              </span>
              {embeddingHealth.coverageRate < 80 && embeddingHealth.totalConcepts > 0 && (
                <span className="healthMetaWarn">
                  <AlertTriangle size={13} />
                  覆盖率偏低，建议执行全量生成
                </span>
              )}
            </div>
          )}
        </div>

        <div className="monitor-section">
          <h3 className="monitor-section-title">
            <Zap size={16} />
            决策分布
          </h3>
          <div className="monitor-decision-cards">
            {Object.entries(DECISION_LABELS).map(([key, label]) => {
              const count = (decisionDist[key] as number) || 0;
              const pct = decisionTotal > 0 ? Math.round((count / decisionTotal) * 100) : 0;
              return (
                <div key={key} className="monitor-decision-card">
                  <div className="monitor-decision-card-bar" style={{ width: `${pct}%`, background: DECISION_COLORS[key] }} />
                  <div className="monitor-decision-card-info">
                    <span className="monitor-decision-card-label">{label}</span>
                    <span className="monitor-decision-card-value">{count}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="monitor-section">
          <h3 className="monitor-section-title">
            <Database size={16} />
            概念健康度
          </h3>
          <div className="monitor-tool-table-wrap">
            <table className="monitor-table">
              <thead>
                <tr>
                  <th>概念 ID</th>
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
                      <td className="monitor-table-tool-name">{ch.conceptId}</td>
                      <td>{ch.totalQueries}</td>
                      <td>
                        <span style={{ color: rate >= 90 ? '#52c41a' : rate >= 70 ? '#faad14' : '#ff4d4f', fontWeight: 500 }}>
                          {rate}%
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
                    <td colSpan={5} className="monitor-table-empty">暂无数据</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="monitor-section">
          <h3 className="monitor-section-title">
            <AlertCircle size={16} />
            最近异常
          </h3>
          <div className="monitor-anomaly-list">
            {anomalies.map((a, i) => (
              <div key={i} className={`monitor-anomaly-card monitor-anomaly-card--${a.level}`}>
                <div className="monitor-anomaly-card-header">
                  <span className="monitor-anomaly-card-type">{a.type}</span>
                  <span className="monitor-anomaly-card-time">{formatTime(a.time)}</span>
                </div>
                <p className="monitor-anomaly-card-message">{a.message}</p>
                <p className="monitor-anomaly-card-detail">{a.detail}</p>
              </div>
            ))}
            {anomalies.length === 0 && (
              <div className="monitor-anomaly-empty">
                <CheckCircle size={20} />
                <span>暂无异常，系统运行正常</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}