import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { useToastStore } from '@/stores/toastStore';
import { pollTaskUntilDone } from '@/utils/asyncTask';
import {
  postFixProposal,
  autoMatchConceptMappingsV2,
  applyAutoMatchMappings,
  createConcept,
  type GapCluster,
  type GapFixProposal,
} from '@/api/concept';
import { listDatasources } from '@/api/datasource';
import './GapFixModal.css';

interface GapFixModalProps {
  bucket: string;
  term: string;
  samples: GapCluster['samples'];
  onClose: () => void;
}

/**
 * 缺口 AI 修复：LLM 分析聚簇并给出结构化建议，确认后组合既有能力落地——
 * 未命中概念 → 建概念 + 跳转编辑器自动绑定；SQL 失败 → 诊断 + 一键重映射相关概念。
 * 建议只读，写入动作都由用户确认后触发。
 */
export function GapFixModal({ bucket, term, samples, onClose }: GapFixModalProps) {
  const toast = useToastStore((s) => s.show);
  const navigate = useNavigate();
  const [proposal, setProposal] = useState<GapFixProposal | null>(null);
  const [loadError, setLoadError] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState('');

  useEffect(() => {
    let mounted = true;
    postFixProposal(bucket, term, samples)
      .then((res) => {
        if (!mounted) return;
        setProposal(res.data);
        setNameDraft(res.data.conceptName || term);
      })
      .catch(() => {
        if (!mounted) return;
        setLoadError('AI 分析失败：请确认「大模型配置」里已设置默认大模型，然后重试');
      });
    return () => { mounted = false; };
    // 弹窗由父组件按需条件挂载，挂载时分析一次即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyCreateConcept = async () => {
    if (!proposal) return;
    const name = nameDraft.trim();
    if (!name) { toast('请填写概念名称', 'error'); return; }
    setApplying(true);
    setApplyMsg('正在创建概念…');
    try {
      const res = await createConcept({ name, description: proposal.description || '' });
      toast('概念已创建，正在跳转编辑器完成绑定', 'success');
      const qs = new URLSearchParams({
        guide: String(res.data.id),
        name,
        samples: samples.map((s) => s.question).join('\n'),
        auto: '1',
      });
      onClose();
      navigate(`/modeling/concepts?${qs.toString()}`);
    } catch {
      setApplying(false);
      setApplyMsg('');
      toast('概念创建失败（可能已存在同名概念）', 'error');
    }
  };

  const applyRemap = async () => {
    if (!proposal?.involvedConcepts?.length) return;
    const idByName = proposal.conceptIdByName || {};
    const conceptIds = proposal.involvedConcepts
      .map((n) => idByName[n])
      .filter((id): id is number => id != null);
    if (conceptIds.length === 0) {
      toast('没找到对应概念，请到绑定管理手动处理', 'error');
      return;
    }
    setApplying(true);
    try {
      setApplyMsg('正在获取数据源并提交重映射任务…');
      const dsRes = await listDatasources('PLATFORM');
      const dsIds = dsRes.data.map((d) => d.id);
      if (dsIds.length === 0) {
        setApplying(false);
        setApplyMsg('');
        toast('暂无可用数据源，请先在系统管理接入', 'error');
        return;
      }
      setApplyMsg('重映射任务执行中（规则优先、LLM 兜底）…');
      const res = await autoMatchConceptMappingsV2(conceptIds, dsIds);
      const task = await pollTaskUntilDone(res.data.taskId);
      if (task.status === 'FAILED') throw new Error(task.errorMsg || '任务失败');
      setApplyMsg('正在应用映射结果…');
      const applyRes = await applyAutoMatchMappings(task.id);
      const created = Number((applyRes.data as { created?: number })?.created ?? 0);
      setApplying(false);
      setApplyMsg('');
      if (created > 0) {
        toast(`已重新绑定 ${created} 条映射，可用样例问题加回归验证`, 'success');
        onClose();
      } else {
        toast('没有产出新映射，建议到绑定管理手动检查', 'warning');
      }
    } catch (e) {
      setApplying(false);
      setApplyMsg('');
      toast(e instanceof Error && e.message === 'timeout'
        ? '任务仍在后台执行，可稍后在异步任务列表查看结果'
        : '重映射执行失败，请到绑定管理手动处理', 'error');
    }
  };

  return (
    <div className="gapfix-overlay" onClick={applying ? undefined : onClose}>
      <div className="gapfix-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gapfix-header">
          <div className="gapfix-title"><Sparkles size={15} /> AI 修复 · 「{term}」</div>
          <button className="gapfix-close" onClick={onClose} disabled={applying}><X size={16} /></button>
        </div>
        <div className="gapfix-body">
          {!proposal && !loadError && (
            <div className="gapfix-loading">
              <Loader2 size={18} className="gapfix-spin" />
              AI 正在分析这 {samples.length} 条问题，可能需要几十秒…
            </div>
          )}
          {loadError && <div className="gapfix-error">{loadError}</div>}

          {proposal && (
            <>
              {!proposal.feasible && (
                <div className="gapfix-block">
                  <div className="gapfix-block-title">AI 结论：不建议自动修复</div>
                  <div className="gapfix-rationale">{proposal.rationale || proposal.diagnosis || proposal.fixHint || '该缺口需要人工处理'}</div>
                </div>
              )}

              {proposal.feasible && proposal.mode === 'create-concept' && (
                <>
                  <div className="gapfix-block">
                    <div className="gapfix-block-title">建议新增概念</div>
                    <div className="gapfix-field">
                      <label className="gapfix-label">概念名称（可修改）</label>
                      <input
                        className="gapfix-input"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        disabled={applying}
                      />
                    </div>
                    {proposal.description && (
                      <div className="gapfix-field"><span className="gapfix-label">描述</span><p className="gapfix-text">{proposal.description}</p></div>
                    )}
                    {proposal.synonyms && proposal.synonyms.length > 0 && (
                      <div className="gapfix-field"><span className="gapfix-label">同义词</span><p className="gapfix-text">{proposal.synonyms.join('、')}</p></div>
                    )}
                  </div>
                  {proposal.rationale && <div className="gapfix-rationale">{proposal.rationale}</div>}
                  <div className="gapfix-note">确认后将创建概念并跳转编辑器自动绑定数据表，随后可把样例问题加入回归验证。</div>
                </>
              )}

              {proposal.feasible && proposal.mode === 'remap' && (
                <>
                  <div className="gapfix-block">
                    <div className="gapfix-block-title">诊断结论</div>
                    <div className="gapfix-text">{proposal.diagnosis || '概念绑定可能已失效'}</div>
                    {proposal.involvedConcepts && proposal.involvedConcepts.length > 0 && (
                      <div className="gapfix-field">
                        <span className="gapfix-label">涉及概念</span>
                        <div className="gapfix-chips">
                          {proposal.involvedConcepts.map((c) => <span key={c} className="gapfix-chip">{c}</span>)}
                        </div>
                      </div>
                    )}
                    {proposal.fixHint && <div className="gapfix-field"><span className="gapfix-label">修复建议</span><p className="gapfix-text">{proposal.fixHint}</p></div>}
                  </div>
                  <div className="gapfix-note">确认后将重跑这些概念的自动映射（只覆盖自动映射，人工确认过的绑定保留），完成后建议把样例问题加入回归验证。</div>
                </>
              )}
            </>
          )}
        </div>
        <div className="gapfix-footer">
          {proposal?.feasible && (
            <button className="gapfix-btn gapfix-btn--primary" disabled={applying} onClick={proposal.mode === 'remap' ? applyRemap : applyCreateConcept}>
              {applying ? '处理中…' : proposal.mode === 'remap' ? '重新自动映射相关概念' : '创建概念并自动绑定'}
            </button>
          )}
          <button className="gapfix-btn" onClick={onClose} disabled={applying}>关闭</button>
        </div>
        {applyMsg && (
          <div className="gapfix-applying"><Loader2 size={14} className="gapfix-spin" />{applyMsg}</div>
        )}
      </div>
    </div>
  );
}
