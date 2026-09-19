import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import Select from '@/components/Select';
import { useToastStore } from '@/stores/toastStore';
import { listRegressionPackages, addRegressionCases, type RegressionPackageInfo } from '@/api/concept';
import './RegressionCaseModal.css';

interface RegressionCaseModalProps {
  /** 要加入回归验证的问题（问数流量样例 / 用户标记问题） */
  questions: string[];
  /** 可选：期望命中的概念名（建概念引导带入，回归时校验新概念已生效） */
  mustHitConcepts?: string[];
  onClose: () => void;
  onAdded?: (info: { packageName: string; added: number }) => void;
}

/**
 * 把问题补进语义包回归问题集：缺口问题随下一次回归跑真实问数链路，
 * 修完概念不用自己想怎么验证——回归报告直接告诉你答没答对。
 */
export function RegressionCaseModal({ questions, mustHitConcepts, onClose, onAdded }: RegressionCaseModalProps) {
  const toast = useToastStore((s) => s.show);
  const [packages, setPackages] = useState<RegressionPackageInfo[]>([]);
  const [packageName, setPackageName] = useState('');
  const [checked, setChecked] = useState<string[]>(questions);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    listRegressionPackages()
      .then((res) => {
        if (!mounted) return;
        const list = res.data || [];
        setPackages(list);
        if (list.length > 0) setPackageName(list[0].name);
      })
      .catch(() => toast('加载回归问题集失败', 'error'));
    return () => { mounted = false; };
    // 弹窗由父组件按需条件挂载，挂载时加载一次即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const packageOptions = useMemo(
    () => packages.map((p) => ({
      value: p.name,
      label: `${p.displayName || p.name}（${p.caseCount} 题${p.customCount ? ` · 含追加 ${p.customCount}` : ''}）`,
    })),
    [packages],
  );

  const toggle = (q: string) => {
    setChecked((prev) => (prev.includes(q) ? prev.filter((x) => x !== q) : [...prev, q]));
  };

  const handleSubmit = async () => {
    if (!packageName) { toast('请选择回归问题集', 'error'); return; }
    if (checked.length === 0) { toast('请至少勾选一条问题', 'error'); return; }
    setSubmitting(true);
    try {
      const res = await addRegressionCases(packageName, checked, mustHitConcepts);
      const pkg = packages.find((p) => p.name === packageName);
      toast(`已加入「${pkg?.displayName || packageName}」回归问题集（新增 ${res.data.added}${res.data.duplicated ? `，跳过重复 ${res.data.duplicated}` : ''}）`, 'success');
      onAdded?.({ packageName, added: res.data.added });
      onClose();
    } catch {
      toast('加入回归问题集失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="regcase-overlay" onClick={onClose}>
      <div className="regcase-modal" onClick={(e) => e.stopPropagation()}>
        <div className="regcase-header">
          <div className="regcase-title">加入回归验证</div>
          <button className="regcase-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="regcase-body">
          <div className="regcase-hint">
            这些问题会随下一次语义包回归跑真实问数链路。{mustHitConcepts?.length
              ? `回归将校验「${mustHitConcepts.join('、')}」概念已命中且回答可用。`
              : '当前不带概念断言，重点检查能生成 SQL 且回答不出错。'}
          </div>
          {packages.length === 0 ? (
            <div className="regcase-empty">暂无可用回归问题集</div>
          ) : (
            <>
              <div className="regcase-field">
                <label className="regcase-label">回归问题集</label>
                <Select
                  value={packageName}
                  options={packageOptions}
                  onChange={setPackageName}
                />
              </div>
              <div className="regcase-field">
                <div className="regcase-label">
                  问题清单
                  <button className="regcase-toggle" onClick={() => setChecked(checked.length === questions.length ? [] : questions)}>
                    {checked.length === questions.length ? '全不选' : '全选'}
                  </button>
                </div>
                <div className="regcase-questions">
                  {questions.map((q) => (
                    <label key={q} className="regcase-question">
                      <input
                        type="checkbox"
                        checked={checked.includes(q)}
                        onChange={() => toggle(q)}
                      />
                      <span>{q}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="regcase-footer">
          <button className="regcase-btn regcase-btn--primary" disabled={submitting || packages.length === 0} onClick={handleSubmit}>
            {submitting ? '提交中…' : `加入回归（${checked.length} 题）`}
          </button>
          <button className="regcase-btn" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
