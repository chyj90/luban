import { useState, useEffect, useMemo } from 'react';
import { listAccessibleQueries, createQuery, deleteQuery, publishQuery, unpublishQuery } from '@/api';
import { listUnifiedDatasources } from '@/api/datasource';
import { getSystemPermissions } from '@/api/tool';
import { ApplySystemAccessModal } from '@/components/ApplySystemAccessModal';
import { toast } from '@/stores/toastStore';
import { confirm } from '@/stores/confirmStore';
import Select from '@/components/Select';
import type { Query } from '@/types/query';
import type { Datasource } from '@/types/datasource';
import type { SystemWithPerm } from '@/types/tool';
import './QueryPanel.css';

interface QueryPanelProps {
  applicationId: number;
  selectedQuery: Query | null;
  onQuerySelect: (query: Query | null) => void;
  queries?: Query[];
  onQueriesChange?: () => void;
}

export function QueryPanel({ applicationId, selectedQuery, onQuerySelect, queries: externalQueries, onQueriesChange }: QueryPanelProps) {
  const [internalQueries, setInternalQueries] = useState<Query[]>([]);
  const queries = externalQueries ?? internalQueries;
  const [showForm, setShowForm] = useState(false);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [form, setForm] = useState({ name: '', datasourceId: 0, body: '' });
  // 平台订阅（按系统申请权限，与 API/数据源同一套）
  const [showApplyModal, setShowApplyModal] = useState(false);
  // 发布到系统
  const [publishTarget, setPublishTarget] = useState<Query | null>(null);
  const [systems, setSystems] = useState<SystemWithPerm[]>([]);
  const [publishGroupId, setPublishGroupId] = useState<number>(0);

  useEffect(() => {
    if (applicationId && !externalQueries) {
      listAccessibleQueries(applicationId).then((res) => setInternalQueries(res.data));
    }
  }, [applicationId, externalQueries]);

  useEffect(() => {
    if (applicationId) {
      // 一个平台一套：查询数据源可选平台系统库或本应用自建业务库
      listUnifiedDatasources(applicationId).then((list) => setDatasources(list));
    }
  }, [applicationId]);

  const datasourceOptions = useMemo(() => {
    return datasources
      .filter((ds) => ds.type !== 'rest_api' && ds.type !== 'REST_API')
      .map((ds) => ({ value: String(ds.id), label: `${ds.name} (${ds.type})` }));
  }, [datasources]);

  const nextName = useMemo(() => {
    const max = queries.reduce((n, q) => {
      const m = q.name.match(/^Query(\d+)$/);
      return m ? Math.max(n, parseInt(m[1])) : n;
    }, 0);
    return `Query${max + 1}`;
  }, [queries]);

  // 平台发布查询：来自其他应用、按系统权限出现在本面板（accessStatus=APPROVED 可运行 / PENDING 申请中）
  const isPlatform = (q: Query) => q.publishedGroupId != null && q.applicationId !== applicationId;

  const reload = () => {
    if (onQueriesChange) {
      onQueriesChange();
    } else if (applicationId) {
      listAccessibleQueries(applicationId).then((res) => setInternalQueries(res.data));
    }
  };

  const handleOpenCreate = () => {
    setForm({ name: nextName, datasourceId: datasources[0]?.id || 0, body: '' });
    setShowForm(!showForm);
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    if (!form.datasourceId) { toast.error('请选择数据源'); return; }
    const res = await createQuery({
      applicationId,
      datasourceId: form.datasourceId,
      name: form.name.trim(),
      body: form.body,
    });
    if (onQueriesChange) {
      onQueriesChange();
    } else {
      setInternalQueries([...queries, res.data]);
    }
    setShowForm(false);
    onQuerySelect(res.data);
  };

  const handleDelete = async (q: Query) => {
    if (isPlatform(q)) {
      toast.error('平台查询请在发布方应用中维护');
      return;
    }
    const confirmed = await confirm({
      title: '删除查询',
      message: q.publishedGroupId != null
        ? '该查询已发布为平台资产，删除将同步下线平台侧，确定删除？'
        : '确定删除此查询？',
      confirmText: '删除',
      variant: 'danger',
    });
    if (!confirmed) return;
    await deleteQuery(q.id);
    if (onQueriesChange) {
      onQueriesChange();
    } else {
      setInternalQueries(queries.filter((item) => item.id !== q.id));
    }
    if (selectedQuery?.id === q.id) onQuerySelect(null);
    toast.success('查询已删除');
  };

  const handleOpenPublish = (q: Query) => {
    setPublishTarget(q);
    setPublishGroupId(0);
    getSystemPermissions().then((res) => setSystems(res.data || [])).catch(() => setSystems([]));
  };

  const handlePublish = async () => {
    if (!publishTarget || !publishGroupId) return;
    try {
      await publishQuery(publishTarget.id, publishGroupId);
      toast.success('已发布为平台查询');
      setPublishTarget(null);
      reload();
    } catch {
      toast.error('发布失败（需对目标系统有数据访问权限）');
    }
  };

  const handleUnpublish = async (q: Query) => {
    const confirmed = await confirm({
      title: '取消发布',
      message: `取消发布后，其他应用与 KEY 将无法再使用「${q.name}」，确定继续？`,
      confirmText: '取消发布',
      variant: 'danger',
    });
    if (!confirmed) return;
    await unpublishQuery(q.id);
    toast.success('已取消发布');
    reload();
  };

  return (
    <div className="qp-panel">
      <div className="editor-sidebar-section">
        <div className="editor-sidebar-section-header">
          <span>查询列表<span className="editor-sidebar-count">{queries.length}</span></span>
          <span className="qp-header-actions">
            <button className="qp-apply-btn" onClick={() => setShowApplyModal(true)} title="按系统申请平台查询权限">订阅</button>
            <button className="editor-sidebar-add-btn" onClick={handleOpenCreate}>+</button>
          </span>
        </div>

        {showForm && (
          <div className="qp-create-form">
            <Select
              value={form.datasourceId ? String(form.datasourceId) : ''}
              options={datasourceOptions}
              onChange={(value) => setForm({ ...form, datasourceId: Number(value) })}
              placeholder="选择数据源"
            />
            <div className="editor-sidebar-new-form">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="查询名称"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
              <button onClick={handleCreate}>创建</button>
            </div>
          </div>
        )}

        {queries.length === 0 ? (
          <div className="qp-empty">暂无查询</div>
        ) : (
          <div className="editor-sidebar-list">
            {queries.map((q) => {
              const platform = isPlatform(q);
              return (
                <div
                  key={q.id}
                  className={`editor-sidebar-item ${selectedQuery?.id === q.id ? 'active' : ''}`}
                  onClick={() => onQuerySelect(q)}
                >
                  <span className="editor-sidebar-item-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
                  </span>
                  <span className="editor-sidebar-item-name">
                    {q.name}
                    {platform && (
                      <span className={`qp-platform-badge ${q.accessStatus === 'PENDING' ? 'pending' : ''}`}>
                        {q.accessStatus === 'PENDING' ? '申请中' : '平台'}
                      </span>
                    )}
                  </span>
                  {!platform && q.publishedGroupId == null && (
                    <button
                      className="qp-item-action"
                      onClick={(e) => { e.stopPropagation(); handleOpenPublish(q); }}
                      title="发布为平台查询（其他应用与 KEY 可使用）"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
                    </button>
                  )}
                  {!platform && q.publishedGroupId != null && (
                    <button
                      className="qp-item-action published"
                      onClick={(e) => { e.stopPropagation(); handleUnpublish(q); }}
                      title="取消发布"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>
                    </button>
                  )}
                  {!platform && (
                    <button
                      className="qp-item-delete"
                      onClick={(e) => { e.stopPropagation(); handleDelete(q); }}
                      title="删除"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showApplyModal && (
        <ApplySystemAccessModal onClose={() => setShowApplyModal(false)} onApplied={reload} />
      )}

      {publishTarget && (
        <div className="qp-modal-mask" onClick={() => setPublishTarget(null)}>
          <div className="qp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="qp-modal-title">发布「{publishTarget.name}」到系统</div>
            <div className="qp-modal-hint">发布后其他应用可按系统权限使用，KEY 可订阅调用；取消发布随时可撤回。</div>
            <div className="qp-modal-systems">
              {systems.length === 0 && <div className="qp-empty">暂无可选系统（先在建模中心-系统管理接入）</div>}
              {systems.map((s) => (
                <label key={s.groupId} className={`qp-system-item ${publishGroupId === s.groupId ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="publish-group"
                    checked={publishGroupId === s.groupId}
                    onChange={() => setPublishGroupId(s.groupId)}
                  />
                  <span className="qp-system-name">{s.name}</span>
                  {s.status === 'APPROVED' && <span className="qp-system-perm">已授权</span>}
                </label>
              ))}
            </div>
            <div className="qp-modal-actions">
              <button onClick={() => setPublishTarget(null)}>取消</button>
              <button className="primary" disabled={!publishGroupId} onClick={handlePublish}>发布</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
