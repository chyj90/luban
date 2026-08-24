import { useState, useEffect, useMemo } from 'react';
import { listQueries, createQuery, deleteQuery } from '@/api';
import { listDatasources } from '@/api/datasource';
import { toast } from '@/stores/toastStore';
import { confirm } from '@/stores/confirmStore';
import type { Query } from '@/types/query';
import type { Datasource } from '@/types/datasource';
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
  const _setQueries = onQueriesChange
    ? (() => {}) 
    : setInternalQueries;
  const [showForm, setShowForm] = useState(false);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [form, setForm] = useState({ name: '', datasourceId: 0, body: '' });

  useEffect(() => {
    if (applicationId && !externalQueries) {
      listQueries(applicationId).then((res) => setInternalQueries(res.data));
    }
  }, [applicationId, externalQueries]);

  useEffect(() => {
    if (applicationId) {
      listDatasources(applicationId).then((res) => setDatasources(res.data));
    }
  }, [applicationId]);

  const nextName = useMemo(() => {
    const max = queries.reduce((n, q) => {
      const m = q.name.match(/^Query(\d+)$/);
      return m ? Math.max(n, parseInt(m[1])) : n;
    }, 0);
    return `Query${max + 1}`;
  }, [queries]);

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

  const handleDelete = async (id: number) => {
    const confirmed = await confirm({
      title: '删除查询',
      message: '确定删除此查询？',
      confirmText: '删除',
      variant: 'danger',
    });
    if (!confirmed) return;
    await deleteQuery(id);
    if (onQueriesChange) {
      onQueriesChange();
    } else {
      setInternalQueries(queries.filter((q) => q.id !== id));
    }
    if (selectedQuery?.id === id) onQuerySelect(null);
    toast.success('查询已删除');
  };

  return (
    <div className="qp-panel">
      <div className="editor-sidebar-section">
        <div className="editor-sidebar-section-header">
          <span>查询列表</span>
          <button className="editor-sidebar-add-btn" onClick={handleOpenCreate}>+</button>
        </div>

        {showForm && (
          <div className="qp-create-form">
            <select
              value={form.datasourceId}
              onChange={(e) => setForm({ ...form, datasourceId: Number(e.target.value) })}
            >
              <option value={0} disabled>选择数据源</option>
              {datasources.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.name} ({ds.type})
                </option>
              ))}
            </select>
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
            {queries.map((q) => (
              <div
                key={q.id}
                className={`editor-sidebar-item ${selectedQuery?.id === q.id ? 'active' : ''}`}
                onClick={() => onQuerySelect(q)}
              >
                <span className="editor-sidebar-item-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
                </span>
                <span className="editor-sidebar-item-name">{q.name}</span>
                <button
                  className="qp-item-delete"
                  onClick={(e) => { e.stopPropagation(); handleDelete(q.id); }}
                  title="删除"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}