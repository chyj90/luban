import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Trash2, EyeOff, Lightbulb, ClipboardCopy, ArrowRight, ListChecks, Sparkles } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import Select from '@/components/Select';
import { RegressionCaseModal } from '@/components/RegressionCaseModal';
import { GapFixModal } from '@/components/GapFixModal';
import { useToastStore } from '@/stores/toastStore';
import {
  listConceptFeedback,
  ignoreConceptFeedback,
  deleteConceptFeedback,
  getQuestionGaps,
  type QuestionGapReport,
  type GapCluster,
} from '@/api/concept';
import type { ConceptFeedback } from '@/types/concept';
import './og-page.css';
import './ConceptFeedbackPage.css';

const BUCKET_LABELS: Record<string, string> = {
  'no-concept': '未命中概念',
  'user-flagged': '用户标记',
  'sql-fail': 'SQL 失败',
  'permission-denied': '权限拦截',
};

/** 每类缺口的修复路径：steps 是具体怎么修，target 是「去修复」跳转的目的地 */
const BUCKET_FIXES: Record<string, { target: 'concept' | 'binding' | 'feedback' | null; steps: string[] }> = {
  'no-concept': {
    target: 'concept',
    steps: ['去建概念（自动带上高频词与样例问题）', '建完按引导一键自动映射数据表', '样例问题加入回归验证修复效果'],
  },
  'sql-fail': {
    target: 'binding',
    steps: ['去绑定管理检查相关概念的表/字段绑定', '核对数据源表结构或数据是否变更', '修复后把样例问题加入回归验证'],
  },
  'permission-denied': {
    target: null,
    steps: ['确认问数用户的角色与概念域授权范围', '为对应角色补充概念域查询授权'],
  },
  'user-flagged': {
    target: 'feedback',
    steps: ['看反馈明细定位坏答案（原问题/SQL 快照）', '按缺概念、缺绑定还是口径错误修复', '修复后把样例问题加入回归验证'],
  },
};

const FIX_TARGET_LABELS: Record<string, string> = {
  concept: '去建概念',
  binding: '去查绑定',
  feedback: '看反馈明细',
};

const GAP_RANGE_OPTIONS = [
  { value: '7', label: '近 7 天' },
  { value: '14', label: '近 14 天' },
  { value: '30', label: '近 30 天' },
  { value: '90', label: '近 90 天' },
];

/** 支持 AI 一键修复的缺口类型：未命中概念（建概念+自动绑定）、SQL 失败（诊断+重映射） */
const AI_FIXABLE_BUCKETS = new Set(['no-concept', 'sql-fail']);

export default function ConceptFeedbackPage() {
  const navigate = useNavigate();
  const [gaps, setGaps] = useState<QuestionGapReport | null>(null);
  const [gapDays, setGapDays] = useState(14);
  const [gapsLoading, setGapsLoading] = useState(true);
  const [feedbacks, setFeedbacks] = useState<ConceptFeedback[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [regCaseCluster, setRegCaseCluster] = useState<GapCluster | null>(null);
  const [addedClusterKeys, setAddedClusterKeys] = useState<Set<string>>(new Set());
  const [fixCluster, setFixCluster] = useState<GapCluster | null>(null);
  const toast = useToastStore((s) => s.show);

  const fetchGaps = useCallback(async () => {
    setGapsLoading(true);
    try {
      const res = await getQuestionGaps(gapDays);
      setGaps(res.data);
    } catch {
      toast('加载缺口洞察失败', 'error');
    } finally {
      setGapsLoading(false);
    }
  }, [gapDays, toast]);

  const fetchFeedbacks = useCallback(async () => {
    setFeedbackLoading(true);
    try {
      const res = await listConceptFeedback();
      setFeedbacks(res.data || []);
    } catch {
      toast('加载用户反馈失败', 'error');
    } finally {
      setFeedbackLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchGaps();
    fetchFeedbacks();
  }, [fetchGaps, fetchFeedbacks]);

  const handleIgnore = async (fb: ConceptFeedback) => {
    try {
      await ignoreConceptFeedback(fb.id, { reviewedBy: 'admin', reviewComment: '已人工处理' });
      fetchFeedbacks();
    } catch {
      toast('操作失败', 'error');
    }
  };

  const handleDelete = async (fb: ConceptFeedback) => {
    try {
      await deleteConceptFeedback(fb.id);
      setFeedbacks((prev) => prev.filter((f) => f.id !== fb.id));
    } catch {
      toast('删除失败', 'error');
    }
  };

  const handleFixJump = (c: GapCluster) => {
    const fix = BUCKET_FIXES[c.bucket];
    if (!fix?.target) return;
    if (fix.target === 'concept') {
      const samples = c.samples.map((s) => s.question).join('\n');
      navigate(`/modeling/concepts?create=${encodeURIComponent(c.term)}&samples=${encodeURIComponent(samples)}`);
    } else if (fix.target === 'binding') {
      navigate('/modeling/binding-profiles');
    } else {
      document.getElementById('gap-feedback-section')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleCopySamples = (c: GapCluster) => {
    const text = c.samples.map((s) => s.question).join('\n');
    navigator.clipboard.writeText(text)
      .then(() => toast(`已复制 ${c.samples.length} 条样例问题`, 'success'))
      .catch(() => toast('复制失败', 'error'));
  };

  const clusterKey = (c: GapCluster) => `${c.bucket}|${c.term}`;

  return (
    <div className="og-page">
      <PageTopbar
        icon={<Lightbulb size={22} />}
        title="问题洞察"
        subtitle="从问数流量挖语义缺口：高频未命中/失败/被反馈的问题，决定下一个该内置的内容"
      />

      <div className="og-page__content">
        <div className="bp-section" style={{ padding: '0 24px' }}>
          <div className="bp-section-title">
            缺口洞察
            <span className="bp-section-hint">窗口期内问数流量按结果信号聚簇；按修复建议逐步处理，样例问题可一键加入回归验证修复效果</span>
            <Select
              className="gap-range-select"
              small
              value={String(gapDays)}
              options={GAP_RANGE_OPTIONS}
              onChange={(v) => setGapDays(Number(v))}
            />
          </div>

          {gapsLoading ? (
            <div className="bp-loading"><Loader2 size={20} className="bp-spin" /></div>
          ) : (
            <>
              <div className="gap-buckets">
                <div className="gap-bucket"><b>{gaps?.totalQuestions ?? 0}</b><span>总问题数</span></div>
                <div className="gap-bucket gap-bucket--warn"><b>{gaps?.buckets.noConcept ?? 0}</b><span>未命中概念</span></div>
                <div className="gap-bucket gap-bucket--err"><b>{gaps?.buckets.sqlFail ?? 0}</b><span>SQL 失败</span></div>
                <div className="gap-bucket gap-bucket--warn"><b>{gaps?.buckets.permissionDenied ?? 0}</b><span>权限拦截</span></div>
                <div className="gap-bucket gap-bucket--err"><b>{gaps?.buckets.userFlagged ?? 0}</b><span>用户标记</span></div>
              </div>

              {(gaps?.clusters.length ?? 0) === 0 ? (
                <div className="bp-empty">窗口期内没有聚出来的缺口。流量越多洞察越准。</div>
              ) : (
                <table className="bp-table">
                  <thead>
                    <tr>
                      <th>类别</th>
                      <th>高频词</th>
                      <th>问题数</th>
                      <th>修复建议</th>
                      <th>样例问题</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(gaps!.clusters as GapCluster[]).map((c, i) => {
                      const fix = BUCKET_FIXES[c.bucket];
                      return (
                        <tr key={i}>
                          <td><span className="bp-status bp-status--empty">{BUCKET_LABELS[c.bucket] || c.bucket}</span></td>
                          <td className="bp-ds-name">{c.term}</td>
                          <td>{c.count}</td>
                          <td style={{ maxWidth: 300 }}>
                            {fix ? (
                              <ol className="gap-fix-steps">
                                {fix.steps.map((s, j) => <li key={j}>{s}</li>)}
                              </ol>
                            ) : (
                              <span style={{ color: '#8c8c8c', fontSize: 12 }}>{c.action}</span>
                            )}
                          </td>
                          <td style={{ maxWidth: 340 }}>
                            {c.samples.map((s, j) => (
                              <div key={j} style={{ fontSize: 12, color: '#595959', marginBottom: 2 }}>· {s.question}</div>
                            ))}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {AI_FIXABLE_BUCKETS.has(c.bucket) && (
                              <button className="bp-btn bp-btn--ai" title="AI 分析缺口并给出修复建议，确认后自动执行" onClick={() => setFixCluster(c)}>
                                <Sparkles size={12} />AI 修复
                              </button>
                            )}
                            {fix?.target && (
                              <button className="bp-btn" onClick={() => handleFixJump(c)} style={AI_FIXABLE_BUCKETS.has(c.bucket) ? { marginLeft: 6 } : undefined}>
                                {FIX_TARGET_LABELS[fix.target]}<ArrowRight size={12} />
                              </button>
                            )}
                            <button
                              className="bp-btn bp-btn--reg"
                              title="把样例问题补进语义包回归，修完后跑回归即可验证"
                              disabled={addedClusterKeys.has(clusterKey(c))}
                              onClick={() => setRegCaseCluster(c)}
                              style={{ marginLeft: 6 }}
                            >
                              <ListChecks size={12} />
                              {addedClusterKeys.has(clusterKey(c)) ? '已加回归' : '加入回归'}
                            </button>
                            <button
                              className="bp-btn"
                              title="复制样例问题"
                              onClick={() => handleCopySamples(c)}
                              style={{ marginLeft: 6 }}
                            >
                              <ClipboardCopy size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        <div className="bp-section" id="gap-feedback-section" style={{ padding: '0 24px' }}>
          <div className="bp-section-title">
            用户反馈
            <span className="bp-section-hint">问数页用户标记的坏答案（已快照原问题/回答/SQL），处理完可忽略或删除</span>
          </div>
          {feedbackLoading ? (
            <div className="bp-loading"><Loader2 size={20} className="bp-spin" /></div>
          ) : feedbacks.length === 0 ? (
            <div className="bp-empty">暂无用户反馈</div>
          ) : (
            <table className="bp-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>用户问题</th>
                  <th>用户说明</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {feedbacks.map((fb) => (
                  <tr key={fb.id}>
                    <td style={{ fontSize: 12 }}>{(fb.createdAt || '').slice(0, 16).replace('T', ' ')}</td>
                    <td style={{ maxWidth: 260 }}>{fb.userQuestion || '-'}</td>
                    <td style={{ maxWidth: 260 }}>{fb.userDescription || '-'}</td>
                    <td>
                      <span className={`bp-status bp-status--${fb.status === 'pending' ? 'empty' : 'active'}`}>
                        {fb.status === 'pending' ? '待处理' : '已忽略'}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="bp-btn" title="忽略" onClick={() => handleIgnore(fb)}><EyeOff size={12} /></button>
                      <button className="bp-btn" title="删除" onClick={() => handleDelete(fb)} style={{ marginLeft: 6 }}><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {regCaseCluster && (
        <RegressionCaseModal
          questions={regCaseCluster.samples.map((s) => s.question)}
          onClose={() => setRegCaseCluster(null)}
          onAdded={({ added }) => {
            const key = clusterKey(regCaseCluster);
            setAddedClusterKeys((prev) => new Set(prev).add(key));
            if (added === 0) toast('这些样例问题已在回归问题集里，无需重复添加', 'info');
          }}
        />
      )}

      {fixCluster && (
        <GapFixModal
          bucket={fixCluster.bucket}
          term={fixCluster.term}
          samples={fixCluster.samples}
          onClose={() => setFixCluster(null)}
        />
      )}
    </div>
  );
}
