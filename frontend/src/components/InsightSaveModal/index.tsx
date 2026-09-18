import { useEffect, useMemo, useState } from 'react';
import { listApplications } from '@/api/application';
import { listUnifiedDatasources } from '@/api/datasource';
import { createQuery } from '@/api/query';
import Select from '@/components/Select';
import { useToastStore } from '@/stores/toastStore';
import type { Application } from '@/types/application';
import type { Datasource } from '@/types/datasource';
import './InsightSaveModal.css';

interface InsightSaveModalProps {
  onClose: () => void;
  /** 洞察回答生成的 SQL */
  sql: string;
  /** 触发本次问数的用户问题，作为查询描述与默认名称来源 */
  question: string;
  /** 回答上下文中出现过的候选数据源（恰好一个时默认选中） */
  candidateDatasourceIds?: number[];
  onSaved?: (info: { applicationId: number; applicationName: string; queryId: number }) => void;
}

/** 洞察沉淀：把问数产出的 SQL 固化为应用内查询资产（洞察 → 开发 → 工作中心 链路的第一环） */
export function InsightSaveModal({ onClose, sql, question, candidateDatasourceIds, onSaved }: InsightSaveModalProps) {
  const toast = useToastStore((s) => s.show);
  const [apps, setApps] = useState<Application[]>([]);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [appId, setAppId] = useState('');
  const [datasourceId, setDatasourceId] = useState('');
  const [name, setName] = useState(
    () => question.slice(0, 30).replace(/[\\/:*?"<>|]/g, '').trim() || '洞察查询',
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      listApplications().then((res) => res.data || []).catch(() => [] as Application[]),
      listUnifiedDatasources().catch(() => [] as Datasource[]),
    ]).then(([appList, dsList]) => {
      if (!mounted) return;
      setApps(appList);
      setDatasources(dsList);
      // 预填：只有一个可选应用/唯一候选数据源时直接选中
      if (appList.length === 1) setAppId(String(appList[0].id));
      const candidates = candidateDatasourceIds || [];
      if (candidates.length === 1 && dsList.some((d) => d.id === candidates[0])) {
        setDatasourceId(String(candidates[0]));
      }
    });
    return () => { mounted = false; };
    // 弹窗由父组件按需条件挂载，挂载时加载一次即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const appOptions = useMemo(
    () => apps.map((a) => ({ value: String(a.id), label: a.name })),
    [apps],
  );
  const dsOptions = useMemo(
    () => datasources.map((d) => ({
      value: String(d.id),
      label: d.slug === 'PLATFORM' ? `${d.name}（平台系统）` : `${d.name}（应用）`,
    })),
    [datasources],
  );

  const handleSubmit = async () => {    if (!appId) { toast('请选择目标应用', 'error'); return; }
    if (!datasourceId) { toast('请选择数据源', 'error'); return; }
    if (!name.trim()) { toast('请填写查询名称', 'error'); return; }
    setSaving(true);
    try {
      const res = await createQuery({
        applicationId: Number(appId),
        datasourceId: Number(datasourceId),
        name: name.trim(),
        body: sql,
        description: `洞察沉淀 · ${question}`,
        source: 'INSIGHT',
      });
      const app = apps.find((a) => String(a.id) === appId);
      toast(`已沉淀到应用「${app?.name || appId}」的查询 ${name.trim()}`, 'success');
      onSaved?.({ applicationId: Number(appId), applicationName: app?.name || '', queryId: res.data.id });
      onClose();
    } catch (e: unknown) {
      toast((e as Error)?.message || '沉淀失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="insight-save-overlay" onClick={onClose}>
      <div className="insight-save-modal" onClick={(e) => e.stopPropagation()}>
        <div className="insight-save-header">
          <span className="insight-save-title">沉淀为查询</span>
          <button className="insight-save-close" onClick={onClose}>×</button>
        </div>
        <div className="insight-save-body">
          <p className="insight-save-hint">
            把本次问数的分析 SQL 固化为应用内的查询资产，后续可在开发中心把它组装进页面，
            并随应用发布到工作中心。
          </p>
          <label className="insight-save-label">目标应用</label>
          {apps.length === 0 ? (
            <p className="insight-save-empty">你还没有可管理的应用，请先到「开发中心」创建一个应用。</p>
          ) : (
            <Select
              value={appId}
              onChange={setAppId}
              placeholder="选择沉淀到哪个应用"
              options={appOptions}
              searchable
            />
          )}
          <label className="insight-save-label">数据源</label>
          <Select
            value={datasourceId}
            onChange={setDatasourceId}
            placeholder="选择该 SQL 的目标数据源"
            options={dsOptions}
            searchable
          />
          <label className="insight-save-label">查询名称</label>
          <input
            className="insight-save-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如 GetMonthlySales"
          />
          <label className="insight-save-label">SQL 预览</label>
          <pre className="insight-save-sql">{sql}</pre>
        </div>
        <div className="insight-save-footer">
          <button className="insight-save-btn" onClick={onClose}>取消</button>
          <button
            className="insight-save-btn insight-save-btn-primary"
            onClick={handleSubmit}
            disabled={saving || apps.length === 0}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
