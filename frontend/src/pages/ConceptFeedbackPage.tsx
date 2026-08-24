import { useState, useEffect, useCallback, Fragment } from 'react';
import { MessageSquare, Check, X, Loader2, Eye, Zap, ChevronRight, AlertTriangle, Trash2 } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import {
  listConceptFeedback,
  analyzeConceptFeedback,
  previewConceptFeedbackSuggestion,
  applyConceptFeedbackSuggestion,
  ignoreConceptFeedback,
} from '@/api/concept';
import { useToastStore } from '@/stores/toastStore';
import { useAuthStore } from '@/stores/authStore';
import type { ConceptFeedback } from '@/types/concept';
import './ConceptFeedbackPage.css';

const STATUS_LABELS: Record<string, string> = {
  recorded: '已记录',
  pending: '待处理',
  analyzing: '分析中',
  applied: '已应用',
  ignored: '已忽略',
};

const STATUS_COLORS: Record<string, string> = {
  recorded: '#8c8c8c',
  pending: '#fa8c16',
  analyzing: '#722ed1',
  applied: '#52c41a',
  ignored: '#8c8c8c',
};

const TABS = [
  { key: 'actionable', label: '需处理', desc: '点踩 · 待分析' },
  { key: 'recorded', label: '已记录', desc: '点赞 · 回归分析' },
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

const SUGGESTION_TYPE_LABELS: Record<string, string> = {
  rename_concept: '重命名概念',
  update_mapping: '更新映射',
  add_relation: '添加关系',
  remove_relation: '移除关系',
  add_mapping: '添加映射',
  remove_mapping: '移除映射',
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
  conflicts?: Array<Record<string, unknown>>;
}

export default function ConceptFeedbackPage() {
  const [feedbackList, setFeedbackList] = useState<ConceptFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('actionable');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<Record<number, Suggestion[]>>({});
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [previewingIdx, setPreviewingIdx] = useState<number>(-1);
  const [applyingIdx, setApplyingIdx] = useState<number>(-1);

  const toast = useToastStore((s) => s.show);
  const user = useAuthStore((s) => s.user);

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
      case 'actionable': return fb.feedbackType === 'dislike' && (fb.status === 'pending' || fb.status === 'analyzing');
      case 'recorded': return fb.feedbackType === 'like';
      case 'done': return fb.status === 'applied' || fb.status === 'ignored';
      default: return true;
    }
  });

  const selectedItem = expandedId ? feedbackList.find(fb => fb.id === expandedId) || null : null;

  const toggleExpand = (fb: ConceptFeedback) => {
    if (expandedId === fb.id) {
      setExpandedId(null);
      setPreviewResult(null);
    } else {
      setExpandedId(fb.id);
      setPreviewResult(null);
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
      fetchFeedback();
    } catch {
      toast('应用建议失败', 'error');
    } finally {
      setApplyingIdx(-1);
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
        subtitle="点赞用于回归分析，点踩触发 LLM 分析建议调整本体概念"
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
            <div className="cfb-page__table-wrap">
              <table className="cfb-page__table">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>类型</th>
                    <th>用户问题</th>
                    <th style={{ width: 280 }}>解析概念</th>
                    <th style={{ width: 80 }}>状态</th>
                    <th style={{ width: 120 }}>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredList.map((fb) => {
                    const isExpanded = expandedId === fb.id;
                    const fbSuggestions = suggestions[fb.id] || [];
                    return (
                      <Fragment key={fb.id}>
                        <tr
                          className={`cfb-page__table-row ${isExpanded ? 'expanded' : ''}`}
                          onClick={() => toggleExpand(fb)}
                        >
                          <td>
                            <span className={`cfb-page__type-badge ${fb.feedbackType === 'like' ? 'like' : 'dislike'}`}>
                              {fb.feedbackType === 'like' ? '赞' : '踩'}
                            </span>
                          </td>
                          <td className="cfb-page__cell-text" title={`Q: ${fb.userQuestion}\nA: ${fb.reasoning || '（无回答）'}`}>{fb.userQuestion}</td>
                          <td>{renderConceptSummary(parseResolvedConcepts(fb.resolvedConcepts))}</td>
                          <td>{renderStatusBadge(fb.status)}</td>
                          <td className="cfb-page__cell-time">{formatTime(fb.createdAt)}</td>
                        </tr>
                        {isExpanded && (
                          <tr className="cfb-page__expand-row">
                            <td colSpan={5}>
                              <div className="cfb-page__expand-content">
                                <div className="cfb-page__expand-grid">
                                  <div className="cfb-page__expand-group">
                                    <h4>用户问题</h4>
                                    <p>{fb.userQuestion}</p>
                                  </div>
                                  <div className="cfb-page__expand-group">
                                    <h4>LLM 回答</h4>
                                    <p>{fb.reasoning || '（无）'}</p>
                                  </div>
                                  <div className="cfb-page__expand-group">
                                    <h4>解析的概念</h4>
                                    {renderConceptBreakdown(parseResolvedConcepts(fb.resolvedConcepts))}
                                  </div>
                                  <div className="cfb-page__expand-group">
                                    <h4>用户反馈</h4>
                                    <p>{fb.userFeedback || '（无）'}</p>
                                  </div>
                                  <div className="cfb-page__expand-group cfb-page__expand-group--full">
                                    <h4>生成的 SQL</h4>
                                    <pre className="cfb-page__expand-code">{fb.generatedSql || '（无）'}</pre>
                                  </div>
                                </div>

                                {fb.feedbackType === 'dislike' && (fb.status === 'pending' || fb.status === 'analyzing') && (
                                  <div className="cfb-page__expand-actions">
                                    <button
                                      className="cfb-page__btn-primary"
                                      onClick={(e) => { e.stopPropagation(); handleAnalyze(fb); }}
                                      disabled={analyzing === fb.id || fbSuggestions.length > 0}
                                    >
                                      {analyzing === fb.id ? (
                                        <><Loader2 size={14} className="cfb-page__spin" /> 分析中...</>
                                      ) : (
                                        <><Zap size={14} /> LLM 分析</>
                                      )}
                                    </button>
                                    <button className="cfb-page__btn-cancel" onClick={(e) => { e.stopPropagation(); handleIgnore(fb); }}>
                                      <Trash2 size={14} /> 忽略
                                    </button>
                                  </div>
                                )}

                                {fbSuggestions.length > 0 && (
                                  <div className="cfb-page__expand-suggestions">
                                    <h4>分析建议 <span className="cfb-page__suggestion-count">{fbSuggestions.length} 条</span></h4>
                                    <div className="cfb-page__suggestion-list">
                                      {fbSuggestions.map((s, i) => (
                                        <div key={i} className="cfb-page__suggestion-card">
                                          <div className="cfb-page__suggestion-card-header">
                                            <span className="cfb-page__suggestion-card-type">
                                              {SUGGESTION_TYPE_LABELS[s.type] || s.type}
                                            </span>
                                            <span className="cfb-page__suggestion-card-index">#{i + 1}</span>
                                          </div>
                                          {s.reasoning && (
                                            <p className="cfb-page__suggestion-card-reasoning">{s.reasoning}</p>
                                          )}
                                          <div className="cfb-page__suggestion-card-params">
                                            {Object.entries(s.params).map(([k, v]) => (
                                              <span key={k} className="cfb-page__suggestion-card-param">
                                                <em>{k}</em>: {String(v)}
                                              </span>
                                            ))}
                                          </div>
                                          <div className="cfb-page__suggestion-card-actions">
                                            <button
                                              className="cfb-page__btn-sm cfb-page__btn-sm--outline"
                                              onClick={(e) => { e.stopPropagation(); handlePreview(fb.id, i); }}
                                              disabled={previewingIdx === i}
                                            >
                                              {previewingIdx === i ? <Loader2 size={12} className="cfb-page__spin" /> : <Eye size={12} />}
                                              预览
                                            </button>
                                            <button
                                              className="cfb-page__btn-sm cfb-page__btn-sm--primary"
                                              onClick={(e) => { e.stopPropagation(); handleApply(fb.id, i); }}
                                              disabled={applyingIdx === i}
                                            >
                                              {applyingIdx === i ? <Loader2 size={12} className="cfb-page__spin" /> : <Check size={12} />}
                                              应用
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {previewResult && (
                                  <div className="cfb-page__expand-preview">
                                    <div className="cfb-page__expand-preview-header">
                                      <h4>
                                        变更预览
                                        <span className="cfb-page__preview-type-tag">
                                          {SUGGESTION_TYPE_LABELS[previewResult.type] || previewResult.type}
                                        </span>
                                      </h4>
                                      <button className="cfb-page__back-btn" onClick={(e) => { e.stopPropagation(); setPreviewResult(null); }}>
                                        <ChevronRight size={16} className="cfb-page__back-icon" />
                                        返回建议
                                      </button>
                                    </div>
                                    <div className="cfb-page__expand-group">
                                      <h4>变更参数</h4>
                                      <pre className="cfb-page__expand-code">{JSON.stringify(previewResult.params, null, 2)}</pre>
                                    </div>
                                    {previewResult.impact && previewResult.impact.length > 0 && (
                                      <div className="cfb-page__expand-group">
                                        <h4 className="cfb-page__label-warning">
                                          <AlertTriangle size={14} /> 受影响实体 ({previewResult.impact.length})
                                        </h4>
                                        <div className="cfb-page__impact-list">
                                          {previewResult.impact.map((imp, i) => (
                                            <div key={i} className="cfb-page__impact-item">
                                              <span className="cfb-page__impact-entity">{imp.entity as string}</span>
                                              <span className="cfb-page__impact-id">ID: {String(imp.id)}</span>
                                              {Object.entries(imp).filter(([k]) => k !== 'entity' && k !== 'id').map(([k, v]) => (
                                                <span key={k} className="cfb-page__impact-attr">{k}: {String(v)}</span>
                                              ))}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {previewResult.conflicts && previewResult.conflicts.length > 0 && (
                                      <div className="cfb-page__expand-group">
                                        <h4 className="cfb-page__label-danger">
                                          <AlertTriangle size={14} /> 冲突 ({previewResult.conflicts.length})
                                        </h4>
                                        <div className="cfb-page__impact-list">
                                          {previewResult.conflicts.map((c, i) => (
                                            <div key={i} className="cfb-page__impact-item cfb-page__impact-item--conflict">
                                              <span className="cfb-page__impact-entity">{c.entity as string}</span>
                                              <span className="cfb-page__impact-reason">{c.reason as string}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
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