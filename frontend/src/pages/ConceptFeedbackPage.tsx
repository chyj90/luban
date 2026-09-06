import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { MessageSquare, X, Loader2, Eye, Zap, ChevronRight, AlertTriangle, Trash2, BarChart3, Target, Play, Layers } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import {
  listConceptFeedback,
  analyzeConceptFeedback,
  previewConceptFeedbackSuggestion,
  applyConceptFeedbackSuggestion,
  applyAllConceptFeedbackSuggestions,
  ignoreConceptFeedback,
  deleteConceptFeedback,
  locateConceptFeedback,
  batchAnalyzeFeedback,
  getFeedbackDashboard,
} from '@/api/concept';
import { useToastStore } from '@/stores/toastStore';
import { useAuthStore } from '@/stores/authStore';
import type { ConceptFeedback } from '@/types/concept';
import './ConceptFeedbackPage.css';

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  analyzing: '分析中',
  applied: '已应用',
  ignored: '已忽略',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#fa8c16',
  analyzing: '#722ed1',
  applied: '#52c41a',
  ignored: '#8c8c8c',
};

const TABS = [
  { key: 'actionable', label: '需处理', desc: '待定位 · 待分析' },
  { key: 'done', label: '已处理', desc: '已应用/已忽略' },
  { key: 'all', label: '全部', desc: '' },
] as const;

type TabKey = typeof TABS[number]['key'];

interface ConceptEntry {
  conceptName: string;
  confidence?: number;
  depth?: number;
}

interface ResolvedConcepts {
  faiss?: ConceptEntry[];
  ontology?: ConceptEntry[];
  used?: ConceptEntry[];
}

function parseResolvedConcepts(json: string): ResolvedConcepts | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const CATEGORY_META: { key: keyof ResolvedConcepts; label: string; color: string }[] = [
  { key: 'faiss', label: 'FAISS', color: '#1677ff' },
  { key: 'ontology', label: '本体', color: '#722ed1' },
  { key: 'used', label: 'LLM', color: '#52c41a' },
];

function renderConceptSummary(concepts: ResolvedConcepts | null) {
  if (!concepts) return <span className="cfb-page__text-muted">—</span>;
  const parts: string[] = [];
  const faissLen = (concepts.faiss || []).length;
  const ontoLen = (concepts.ontology || []).length;
  const usedLen = (concepts.used || []).length;
  if (faissLen > 0) parts.push(`FAISS ${faissLen}`);
  if (ontoLen > 0) parts.push(`本体 ${ontoLen}`);
  if (usedLen > 0) parts.push(`LLM ${usedLen}`);
  if (parts.length === 0) return <span className="cfb-page__text-muted">—</span>;
  return <span className="cfb-page__cell-text">{parts.join(' · ')}</span>;
}

function renderConceptBreakdown(concepts: ResolvedConcepts | null) {
  if (!concepts) return <span className="cfb-page__text-muted">—</span>;
  const hasAny = CATEGORY_META.some(m => (concepts[m.key] || []).length > 0);
  if (!hasAny) return <span className="cfb-page__text-muted">—</span>;

  return (
    <div className="cfb-page__breakdown">
      {CATEGORY_META.map(meta => {
        const list = concepts[meta.key] || [];
        if (list.length === 0) return null;
        const visible = list.slice(0, 3);
        const overflow = list.length - 3;
        const allText = list.map(c => {
          let s = c.conceptName;
          if (c.confidence != null) s += ` ${Math.round(c.confidence * 100)}%`;
          if (c.depth != null) s += ` 深度${c.depth}`;
          return s;
        }).join('\n');
        return (
          <div key={meta.key} className="cfb-page__breakdown-row" title={allText}>
            <span className="cfb-page__breakdown-label" style={{ color: meta.color, borderColor: meta.color }}>{meta.label}</span>
            <span className="cfb-page__breakdown-tags">
              {visible.map((c, i) => (
                <span key={i} className="cfb-page__breakdown-tag">
                  {c.conceptName}
                  {c.confidence != null && <span className="cfb-page__breakdown-pct">{Math.round(c.confidence * 100)}%</span>}
                </span>
              ))}
              {overflow > 0 && <span className="cfb-page__breakdown-more">+{overflow}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const STAGE_NAMES: Record<string, string> = {
  '1': '问题理解',
  '2': '概念匹配',
  '3': '思维链',
  '4': 'SQL 生成',
  '5': '查询执行',
  '6': '最终回答',
};

interface LlmAnalysisResult {
  stages?: Record<string, { hasIssue: boolean; reason: string; suggestion?: string | null }>;
  primaryStage?: number;
  summary?: string;
  ontologySuggestions?: { action: string; name: string; description?: string; mapping?: string; relation?: string }[];
}

function renderLlmAnalysis(analysis: string | LlmAnalysisResult) {
  let parsed: LlmAnalysisResult | null = null;
  if (typeof analysis === 'string') {
    try { parsed = JSON.parse(analysis); } catch { /* ignore */ }
  } else {
    parsed = analysis;
  }

  if (!parsed || !parsed.stages) {
    return <pre className="cfb-page__expand-code">{typeof analysis === 'string' ? analysis : JSON.stringify(analysis, null, 2)}</pre>;
  }

  const issueStages = Object.entries(parsed.stages).filter(([, v]) => v.hasIssue);
  const primaryStage = parsed.primaryStage;
  const ontologySuggestions = parsed.ontologySuggestions || [];

  return (
    <div className="cfb-page__analysis">
      {parsed.summary && (
        <div className="cfb-page__analysis-summary">{parsed.summary}</div>
      )}
      <div className="cfb-page__analysis-stages">
        {issueStages.map(([stage, info]) => {
          const stageNum = Number(stage);
          const isPrimary = stageNum === primaryStage;
          return (
            <div key={stage} className={`cfb-page__analysis-stage ${isPrimary ? 'primary' : ''}`}>
              <div className="cfb-page__analysis-stage-header">
                <span className="cfb-page__analysis-stage-num">阶段 {stage}</span>
                <span className="cfb-page__analysis-stage-name">{STAGE_NAMES[stage] || '未知'}</span>
                {isPrimary && <span className="cfb-page__analysis-primary-badge">根因</span>}
              </div>
              <div className="cfb-page__analysis-stage-reason">{info.reason}</div>
              {info.suggestion && (
                <div className="cfb-page__analysis-stage-suggestion">
                  <span className="cfb-page__analysis-suggestion-label">建议</span>
                  {info.suggestion}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {ontologySuggestions.length > 0 && (
        <div className="cfb-page__analysis-ontology">
          <div className="cfb-page__analysis-ontology-title">本体调整建议</div>
          {ontologySuggestions.map((s, i) => (
            <div key={i} className="cfb-page__analysis-ontology-item">
              <span className="cfb-page__analysis-ontology-action">
                {SUGGESTION_TYPE_LABELS[s.action] || s.action}
              </span>
              <span className="cfb-page__analysis-ontology-name">{s.name}</span>
              {s.mapping && <span className="cfb-page__analysis-ontology-mapping">→ {s.mapping}</span>}
              {s.relation && <span className="cfb-page__analysis-ontology-relation">({s.relation})</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SUGGESTION_TYPE_LABELS: Record<string, string> = {
  add_concept: '添加概念',
  add_mapping: '添加映射',
  add_join_mapping: '添加JOIN映射',
  add_relation: '添加关系',
  update_concept: '更新概念',
  update_mapping: '更新映射',
  update_join_mapping: '更新JOIN映射',
  update_relation: '更新关系',
  delete_concept: '删除概念',
  delete_mapping: '删除映射',
  delete_join_mapping: '删除JOIN映射',
  delete_relation: '删除关系',
};

interface Suggestion {
  type: string;
  params: Record<string, unknown>;
  reasoning?: string;
}

interface PreviewResult {
  type: string;
  params: Record<string, unknown>;
  impact?: Array<Record<string, unknown>>;
  errors?: Array<Record<string, unknown>>;
  conflicts?: Array<Record<string, unknown>>;
  dependsOn?: number[];
}

export default function ConceptFeedbackPage() {
  const [feedbackList, setFeedbackList] = useState<ConceptFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('actionable');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<Record<number, Suggestion[]>>({});
  const [locating, setLocating] = useState<number | null>(null);
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  const [locateFailed, setLocateFailed] = useState<number | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [previewingIdx, setPreviewingIdx] = useState<number>(-1);
  const [previewedIdx, setPreviewedIdx] = useState<number>(-1);
  const [applyingIdx, setApplyingIdx] = useState<number>(-1);
  const [applyingAll, setApplyingAll] = useState<number | null>(null);

  const toast = useToastStore((s) => s.show);
  const user = useAuthStore((s) => s.user);

  const tableWrapRef = useRef<HTMLDivElement>(null);

  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listConceptFeedback(undefined, undefined);
      setFeedbackList(res.data);
    } catch {
      toast('加载反馈列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  const filteredList = feedbackList.filter(fb => {
    switch (activeTab) {
      case 'actionable': return fb.status === 'pending' || fb.status === 'analyzing';
      case 'done': return fb.status === 'applied' || fb.status === 'ignored';
      default: return true;
    }
  });

  const selectedItem = expandedId ? feedbackList.find(fb => fb.id === expandedId) || null : null;

  const toggleExpand = (fb: ConceptFeedback) => {
    if (expandedId === fb.id) {
      setExpandedId(null);
      setPreviewResult(null);
      setPreviewedIdx(-1);
    } else {
      setExpandedId(fb.id);
      setPreviewResult(null);
      setPreviewedIdx(-1);
      setLocateFailed(null);
      setTimeout(() => {
        const wrap = tableWrapRef.current;
        const el = document.getElementById(`expand-${fb.id}`);
        if (wrap && el) {
          const wrapRect = wrap.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          if (elRect.bottom > wrapRect.bottom) {
            wrap.scrollTop += elRect.bottom - wrapRect.bottom + 12;
          }
        }
      }, 50);
    }
  };

  const handleAnalyze = async (fb: ConceptFeedback) => {
    setAnalyzing(fb.id);
    try {
      const res = await analyzeConceptFeedback(fb.id);
      const raw = (res.data || []) as Suggestion[];
      setSuggestions(prev => ({ ...prev, [fb.id]: raw }));
      if (raw.length === 0) {
        toast('LLM 未产出建议，该反馈可能无需调整', 'info');
      } else {
        toast(`LLM 生成 ${raw.length} 条建议`, 'success');
      }
    } catch {
      toast('LLM 分析失败', 'error');
    } finally {
      setAnalyzing(null);
    }
  };

  const handlePreview = async (fbId: number, idx: number) => {
    setPreviewingIdx(idx);
    try {
      const res = await previewConceptFeedbackSuggestion(fbId, idx);
      setPreviewResult(res.data as PreviewResult);
      setPreviewedIdx(idx);
    } catch {
      toast('加载预览失败', 'error');
    } finally {
      setPreviewingIdx(-1);
    }
  };

  const handleApply = async (fbId: number, idx: number) => {
    setApplyingIdx(idx);
    try {
      await applyConceptFeedbackSuggestion(fbId, idx, user?.account || 'admin');
      toast('建议已应用', 'success');
      setSuggestions(prev => {
        const next = { ...prev };
        if (next[fbId]) next[fbId] = next[fbId].filter((_, i) => i !== idx);
        return next;
      });
      setPreviewResult(null);
      setPreviewedIdx(-1);
      fetchFeedback();
    } catch {
      toast('应用建议失败', 'error');
    } finally {
      setApplyingIdx(-1);
    }
  };

  const handleApplyAll = async (fbId: number) => {
    setApplyingAll(fbId);
    try {
      await applyAllConceptFeedbackSuggestions(fbId, user?.account || 'admin');
      toast('全部建议已应用', 'success');
      setPreviewResult(null);
      setPreviewedIdx(-1);
      setSuggestions(prev => {
        const next = { ...prev };
        delete next[fbId];
        return next;
      });
      fetchFeedback();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '批量应用失败';
      toast(msg, 'error');
    } finally {
      setApplyingAll(null);
    }
  };

  const handleIgnore = async (fb: ConceptFeedback) => {
    try {
      await ignoreConceptFeedback(fb.id, {
        reviewedBy: user?.account || 'admin',
        reviewComment: '忽略此反馈',
      });
      toast('已忽略', 'success');
      setExpandedId(null);
      fetchFeedback();
    } catch {
      toast('操作失败', 'error');
    }
  };

  const handleDelete = async (fb: ConceptFeedback) => {
    try {
      await deleteConceptFeedback(fb.id);
      toast('已删除', 'success');
      setExpandedId(null);
      fetchFeedback();
    } catch {
      toast('删除失败', 'error');
    }
  };

  const handleLocate = async (fb: ConceptFeedback) => {
    setLocating(fb.id);
    try {
      const res = await locateConceptFeedback(fb.id);
      toast('阶段定位完成', 'success');
      setLocateFailed(null);
      fetchFeedback();
    } catch {
      toast('定位失败', 'error');
      setLocateFailed(fb.id);
    } finally {
      setLocating(null);
    }
  };

  const formatTime = (iso?: string) => {
    if (!iso) return '-';
    return iso.slice(0, 16).replace('T', ' ');
  };

  const renderStatusBadge = (status: string) => (
    <span className="cfb-page__status" style={{ background: STATUS_COLORS[status] || '#999' }}>
      {STATUS_LABELS[status] || status}
    </span>
  );

  if (loading) {
    return (
      <div className="cfb-page__loading">
        <Loader2 size={24} className="cfb-page__spin" />
      </div>
    );
  }

  return (
    <div className="cfb-page">
      <PageTopbar
        icon={<MessageSquare size={22} />}
        title="反馈工作台"
        subtitle="管道级反馈：精确定位问题阶段，LLM 分析建议调整本体概念"
        actions={
          <div className="cfb-page__header-actions">
            <div className="cfb-page__tabs">
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  className={`cfb-page__tab ${activeTab === tab.key ? 'active' : ''}`}
                  onClick={() => { setActiveTab(tab.key); setExpandedId(null); }}
                >
                  <span className="cfb-page__tab-label">{tab.label}</span>
                  {tab.desc && <span className="cfb-page__tab-desc">{tab.desc}</span>}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {filteredList.length === 0 ? (
            <div className="cfb-page__empty">暂无反馈记录</div>
          ) : (
            <div className="cfb-page__table-wrap" ref={tableWrapRef}>
              <table className="cfb-page__table">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>类型</th>
                    <th>用户问题</th>
                    <th style={{ width: 280 }}>解析概念</th>
                    <th style={{ width: 80 }}>状态</th>
                    <th style={{ width: 120 }}>时间</th>
                    <th style={{ width: 80 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredList.map((fb) => {
                    const isExpanded = expandedId === fb.id;
                    const fbSuggestions = suggestions[fb.id] || (fb.suggestions ? (JSON.parse(fb.suggestions) as Suggestion[]) : []);
                    return (
                      <Fragment key={fb.id}>
                        <tr
                          className={`cfb-page__table-row ${isExpanded ? 'expanded' : ''}`}
                          onClick={() => toggleExpand(fb)}
                        >
                          <td>
                            <span className="cfb-page__type-badge problem">
                              问题
                            </span>
                          </td>
                          <td className="cfb-page__cell-text" title={`Q: ${fb.userQuestion}\nA: ${fb.llmAnswer || '（无回答）'}`}>{fb.userQuestion}</td>
                          <td>{renderConceptSummary(parseResolvedConcepts(fb.resolvedConcepts))}</td>
                          <td>{renderStatusBadge(fb.status)}</td>
                          <td className="cfb-page__cell-time">{formatTime(fb.createdAt)}</td>
                          <td className="cfb-page__row-actions" onClick={(e) => e.stopPropagation()}>
                            {(fb.status === 'pending' || fb.status === 'analyzing') && (
                              <>
                                <button className="cfb-page__icon-btn cfb-page__icon-btn--secondary" title={locating === fb.id ? '定位中...' : '定位'} onClick={() => handleLocate(fb)} disabled={locating === fb.id}>
                                  {locating === fb.id ? <Loader2 size={16} className="cfb-page__spin" /> : <Target size={16} />}
                                </button>
                                <button
                                  className="cfb-page__icon-btn cfb-page__icon-btn--secondary"
                                  title={!fb.llmAnalysis ? '请先定位' : (analyzing === fb.id ? '分析中...' : '分析')}
                                  onClick={() => handleAnalyze(fb)}
                                  disabled={analyzing === fb.id || !fb.llmAnalysis}
                                >
                                  {analyzing === fb.id ? <Loader2 size={16} className="cfb-page__spin" /> : <Zap size={16} />}
                                </button>
                                <button className="cfb-page__icon-btn cfb-page__icon-btn--cancel" title="忽略" onClick={() => handleIgnore(fb)}>
                                  <X size={16} />
                                </button>
                              </>
                            )}
                            {fb.status === 'applied' && (
                              <>
                                <button className="cfb-page__icon-btn cfb-page__icon-btn--secondary" title={locating === fb.id ? '定位中...' : '重新定位'} onClick={() => handleLocate(fb)} disabled={locating === fb.id}>
                                  {locating === fb.id ? <Loader2 size={16} className="cfb-page__spin" /> : <Target size={16} />}
                                </button>
                                <button
                                  className="cfb-page__icon-btn cfb-page__icon-btn--secondary"
                                  title={!fb.llmAnalysis ? '请先定位' : (analyzing === fb.id ? '分析中...' : '重新分析')}
                                  onClick={() => handleAnalyze(fb)}
                                  disabled={analyzing === fb.id || !fb.llmAnalysis}
                                >
                                  {analyzing === fb.id ? <Loader2 size={16} className="cfb-page__spin" /> : <Zap size={16} />}
                                </button>
                              </>
                            )}
                            {fb.status === 'ignored' && (
                              <button className="cfb-page__icon-btn cfb-page__icon-btn--danger" title="删除" onClick={() => handleDelete(fb)}>
                                <Trash2 size={16} />
                              </button>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="cfb-page__expand-row" id={`expand-${fb.id}`}>
                            <td colSpan={6}>
                              <div className="cfb-page__expand-content">
                                <div className="cfb-page__expand-body">
                                  <div className="cfb-page__expand-grid">
                                    <div className="cfb-page__expand-group">
                                      <h4>用户问题</h4>
                                      <p>{fb.userQuestion}</p>
                                    </div>
                                    <div className="cfb-page__expand-group">
                                      <h4>LLM 回答</h4>
                                      <p>{fb.llmAnswer || '（无）'}</p>
                                    </div>
                                    <div className="cfb-page__expand-group">
                                      <h4>解析的概念</h4>
                                      {renderConceptBreakdown(parseResolvedConcepts(fb.resolvedConcepts))}
                                    </div>
                                    <div className="cfb-page__expand-group">
                                      <h4>用户描述</h4>
                                      <p>{fb.userDescription || fb.userFeedback || '（无）'}</p>
                                    </div>
                                    {locating === fb.id && !fb.llmAnalysis && (
                                      <div className="cfb-page__expand-group cfb-page__expand-group--full">
                                        <h4><Target size={14} /> LLM 阶段定位</h4>
                                        <p className="cfb-page__locating-hint"><Loader2 size={14} className="cfb-page__spin" /> LLM 正在定位问题阶段...</p>
                                      </div>
                                    )}
                                    {locateFailed === fb.id && !fb.llmAnalysis && (
                                      <div className="cfb-page__expand-group cfb-page__expand-group--full">
                                        <h4><Target size={14} /> LLM 阶段定位</h4>
                                        <div className="cfb-page__locate-error">
                                          <span>定位失败，请点击操作列「定位」按钮重试</span>
                                        </div>
                                      </div>
                                    )}
                                    {fb.llmAnalysis && (
                                      <div className="cfb-page__expand-group cfb-page__expand-group--full">
                                        <h4><Target size={14} /> LLM 阶段定位</h4>
                                        {renderLlmAnalysis(fb.llmAnalysis)}
                                      </div>
                                    )}
                                    <div className="cfb-page__expand-group cfb-page__expand-group--full">
                                      <h4>生成的 SQL</h4>
                                      <pre className="cfb-page__expand-code">{fb.generatedSql || '（无）'}</pre>
                                    </div>
                                  </div>

                                  {fbSuggestions.length > 0 && (
                                  <div className="cfb-page__expand-suggestions">
                                    <div className="cfb-page__suggestions-header">
                                      <h4>分析建议 <span className="cfb-page__suggestion-count">{fbSuggestions.length} 条</span></h4>
                                      {fbSuggestions.length > 1 && (
                                        <button
                                          className="cfb-page__apply-all-btn"
                                          onClick={(e) => { e.stopPropagation(); handleApplyAll(fb.id); }}
                                          disabled={applyingAll === fb.id}
                                        >
                                          {applyingAll === fb.id ? <Loader2 size={12} className="cfb-page__spin" /> : <Layers size={12} />}
                                          全部应用
                                        </button>
                                      )}
                                    </div>
                                    <div className="cfb-page__suggestion-list">
                                      {fbSuggestions.map((s, i) => (
                                        <div key={i} className="cfb-page__suggestion-card">
                                          <div className="cfb-page__suggestion-card-header">
                                            <span className="cfb-page__suggestion-card-type">
                                              {SUGGESTION_TYPE_LABELS[s.type] || s.type}
                                            </span>
                                            <span className="cfb-page__suggestion-card-index">#{i + 1}</span>
                                            {previewResult && previewedIdx === i && previewResult.dependsOn && previewResult.dependsOn.length > 0 && (
                                              <span className="cfb-page__depends-tag">
                                                ← 依赖 #{previewResult.dependsOn.map(d => d + 1).join(', #')}
                                              </span>
                                            )}
                                          </div>
                                          {s.reasoning && (
                                            <p className="cfb-page__suggestion-card-reasoning">{s.reasoning}</p>
                                          )}
                                          <div className="cfb-page__suggestion-card-params">
                                            {Object.entries(s.params).map(([k, v]) => (
                                              <span key={k} className="cfb-page__suggestion-card-param">
                                                <em>{k}</em>: {typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}
                                              </span>
                                            ))}
                                          </div>
                                          <div className="cfb-page__suggestion-card-actions">
                                            <button
                                              className="cfb-page__icon-btn"
                                              onClick={(e) => { e.stopPropagation(); handlePreview(fb.id, i); }}
                                              disabled={previewingIdx === i}
                                              title="预览变更"
                                            >
                                              {previewingIdx === i ? <Loader2 size={14} className="cfb-page__spin" /> : <Eye size={14} />}
                                            </button>
                                            <button
                                              className={`cfb-page__icon-btn ${applyingIdx === i || (previewResult?.errors?.length ?? 0) > 0 ? 'cfb-page__icon-btn--disabled' : 'cfb-page__icon-btn--apply'}`}
                                              onClick={(e) => { e.stopPropagation(); handleApply(fb.id, i); }}
                                              disabled={applyingIdx === i || (previewResult?.errors?.length ?? 0) > 0}
                                              title="应用建议"
                                            >
                                              {applyingIdx === i ? <Loader2 size={14} className="cfb-page__spin" /> : <Play size={14} />}
                                            </button>
                                          </div>

                                          {previewResult && previewedIdx === i && (
                                          <div className="cfb-page__suggestion-preview">
                                            <div className="cfb-page__suggestion-preview-header">
                                              <span className="cfb-page__preview-type-tag">
                                                {SUGGESTION_TYPE_LABELS[previewResult.type] || previewResult.type}
                                              </span>
                                              <button className="cfb-page__icon-btn" onClick={(e) => { e.stopPropagation(); setPreviewResult(null); setPreviewedIdx(-1); }} title="关闭预览">
                                                <X size={14} />
                                              </button>
                                            </div>
                                            <pre className="cfb-page__suggestion-preview-code">{JSON.stringify(previewResult.params, null, 2)}</pre>
                                            {previewResult.impact && previewResult.impact.length > 0 && (
                                              <div className="cfb-page__suggestion-preview-section">
                                                <span className="cfb-page__label-warning"><AlertTriangle size={12} /> 受影响 {previewResult.impact.length} 项</span>
                                                {previewResult.impact.map((imp, j) => (
                                                  <span key={j} className="cfb-page__preview-impact-tag">{imp.entity as string}</span>
                                                ))}
                                              </div>
                                            )}
                                            {previewResult.errors && previewResult.errors.length > 0 && (
                                              <div className="cfb-page__suggestion-preview-section">
                                                <span className="cfb-page__label-danger"><AlertTriangle size={12} /> 校验错误 — 无法应用</span>
                                                {previewResult.errors.map((c, j) => (
                                                  <p key={j} className="cfb-page__preview-error">{c.message as string}</p>
                                                ))}
                                              </div>
                                            )}
                                            {previewResult.conflicts && previewResult.conflicts.length > 0 && (
                                              <div className="cfb-page__suggestion-preview-section">
                                                <span className="cfb-page__label-warning"><AlertTriangle size={12} /> 软冲突 — 可继续</span>
                                                {previewResult.conflicts.map((c, j) => (
                                                  <p key={j} className="cfb-page__preview-conflict">{c.message as string || (c.reason as string)}</p>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
    </div>
  );
}