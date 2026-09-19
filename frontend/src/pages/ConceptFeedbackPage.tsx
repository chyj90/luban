import { useState, useEffect, useCallback } from 'react';
import { Loader2, Trash2, EyeOff, Lightbulb } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
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
import './ConceptFeedbackPage.css';

const BUCKET_LABELS: Record<string, string> = {
  'no-concept': '未命中概念',
  'user-flagged': '用户标记',
  'sql-fail': 'SQL 失败',
  'permission-denied': '权限拦截',
};

export default function ConceptFeedbackPage() {
  const [gaps, setGaps] = useState<QuestionGapReport | null>(null);
  const [gapDays, setGapDays] = useState(14);
  const [gapsLoading, setGapsLoading] = useState(true);
  const [feedbacks, setFeedbacks] = useState<ConceptFeedback[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
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
            <span className="bp-section-hint">近 N 天问数流量按结果信号聚簇；样例问题可直接补充到语义包回归问题集</span>
            <select
              value={gapDays}
              onChange={(e) => setGapDays(Number(e.target.value))}
              style={{ marginLeft: 10, padding: '4px 8px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 12 }}
            >
              <option value={7}>近 7 天</option>
              <option value={14}>近 14 天</option>
              <option value={30}>近 30 天</option>
              <option value={90}>近 90 天</option>
            </select>
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
                      <th>建议动作</th>
                      <th>样例问题</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(gaps!.clusters as GapCluster[]).map((c, i) => (
                      <tr key={i}>
                        <td><span className="bp-status bp-status--empty">{BUCKET_LABELS[c.bucket] || c.bucket}</span></td>
                        <td className="bp-ds-name">{c.term}</td>
                        <td>{c.count}</td>
                        <td style={{ color: '#8c8c8c', fontSize: 12 }}>{c.action}</td>
                        <td style={{ maxWidth: 380 }}>
                          {c.samples.map((s, j) => (
                            <div key={j} style={{ fontSize: 12, color: '#595959', marginBottom: 2 }}>· {s.question}</div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>

        <div className="bp-section" style={{ padding: '24px 24px 0' }}>
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
    </div>
  );
}
