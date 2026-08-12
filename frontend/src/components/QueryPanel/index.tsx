import { useState, useEffect, useMemo } from 'react';
import { listQueries, createQuery, deleteQuery } from '@/api';
import { listDatasources } from '@/api/datasource';
import { toast } from '@/stores/toastStore';
import type { Query } from '@/types/query';
import type { Datasource } from '@/types/datasource';
import './QueryPanel.css';

interface QueryPanelProps {
  applicationId: number;
  selectedQuery: Query | null;
  onQuerySelect: (query: Query | null) => void;
}

export function QueryPanel({ applicationId, selectedQuery, onQuerySelect }: QueryPanelProps) {
  const [queries, setQueries] = useState<Query[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [form, setForm] = useState({ name: '', datasourceId: 0, body: '' });

  useEffect(() => {
    if (applicationId) {
      listQueries(applicationId).then((res) => setQueries(res.data));
    }
  }, [applicationId]);

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
    setQueries([...queries, res.data]);
    setShowForm(false);
    onQuerySelect(res.data);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此查询？')) return;
    await deleteQuery(id);
    setQueries(queries.filter((q) => q.id !== id));
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
                <span className="editor-sidebar-item-icon">⚡</span>
                <span className="editor-sidebar-item-name">{q.name}</span>
                <button
                  className="qp-item-delete"
                  onClick={(e) => { e.stopPropagation(); handleDelete(q.id); }}
                  title="删除"
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}