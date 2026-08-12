import { useState, useEffect } from 'react';
import { listDatasources, createDatasource, updateDatasource, testDatasource, getDatasourceStructure, deleteDatasource } from '@/api/datasource';
import { toast } from '@/stores/toastStore';
import type { Datasource, DatasourceType, DatasourceStructure } from '@/types/datasource';
import './DatasourcePanel.css';

interface DatasourcePanelProps {
  applicationId: number;
}

const DS_TYPES: { value: DatasourceType; label: string; icon: string; color: string }[] = [
  { value: 'MySQL', label: 'MySQL', icon: '🐬', color: '#00758F' },
  { value: 'PostgreSQL', label: 'PostgreSQL', icon: '🐘', color: '#336791' },
  { value: 'REST_API', label: 'REST API', icon: '🔗', color: '#6B8F71' },
];

const isJdbcType = (type: string) => type === 'MySQL' || type === 'PostgreSQL';

const EMPTY_FORM = {
  name: '', type: 'MySQL' as DatasourceType,
  host: '', port: '', database: '', username: '', password: '',
  baseUrl: '', headers: [] as { key: string; value: string }[],
  authType: 'none' as 'none' | 'basic' | 'apiKey' | 'bearer',
  authUsername: '', authPassword: '',
  apiKey: '', apiValue: '', apiAddTo: 'header' as 'header' | 'query',
  bearerToken: '',
};

export function DatasourcePanel({ applicationId }: DatasourcePanelProps) {
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [structure, setStructure] = useState<DatasourceStructure | null>(null);
  const [selectedDsId, setSelectedDsId] = useState<number | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  useEffect(() => {
    listDatasources(applicationId).then((res) => setDatasources(res.data));
  }, [applicationId]);

  const buildConfig = () => {
    if (isJdbcType(form.type)) {
      return {
        host: form.host, port: Number(form.port) || 3306,
        database: form.database, username: form.username, password: form.password,
      };
    }
    const config: Record<string, unknown> = { baseUrl: form.baseUrl };
    if (form.headers.length > 0) {
      config.headers = form.headers;
    }
    if (form.authType !== 'none') {
      config.authType = form.authType;
      if (form.authType === 'basic') {
        config.authUsername = form.authUsername;
        config.authPassword = form.authPassword;
      } else if (form.authType === 'apiKey') {
        config.apiKey = form.apiKey;
        config.apiValue = form.apiValue;
        config.apiAddTo = form.apiAddTo;
      } else if (form.authType === 'bearer') {
        config.bearerToken = form.bearerToken;
      }
    }
    return config;
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    try {
      if (editingId) {
        const res = await updateDatasource(editingId, {
          applicationId, name: form.name.trim(), type: form.type, config: buildConfig(),
        });
        setDatasources(datasources.map((d) => (d.id === editingId ? res.data : d)));
        toast.success('数据源已更新');
      } else {
        const res = await createDatasource({
          applicationId, name: form.name.trim(), type: form.type, config: buildConfig(),
        });
        setDatasources([res.data, ...datasources]);
        toast.success('数据源创建成功');
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
    } catch { /* ignore */ }
  };

  const handleEdit = (ds: Datasource) => {
    setEditingId(ds.id);
    setShowForm(true);
    const config = ds.config || {};
    setForm({
      name: ds.name,
      type: ds.type as DatasourceType,
      host: String(config.host || ''),
      port: String(config.port || ''),
      database: String(config.database || ''),
      username: String(config.username || ''),
      password: '',
      baseUrl: String(config.baseUrl || ''),
      headers: (config.headers as { key: string; value: string }[]) || [],
      authType: (config.authType as typeof form.authType) || 'none',
      authUsername: String(config.authUsername || ''),
      authPassword: '',
      apiKey: String(config.apiKey || ''),
      apiValue: '',
      apiAddTo: (config.apiAddTo as 'header' | 'query') || 'header',
      bearerToken: '',
    });
  };

  const handleCancel = () => {
    setShowForm(false);
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const handleTest = async (id: number) => {
    setTesting(id);
    const res = await testDatasource(id);
    toast.show(res.data.message, res.data.success ? 'success' : 'error');
    setTesting(null);
  };

  const handleViewStructure = async (id: number) => {
    if (selectedDsId === id) { setSelectedDsId(null); setStructure(null); return; }
    setSelectedDsId(id);
    const res = await getDatasourceStructure(id);
    setStructure(res.data);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此数据源？')) return;
    await deleteDatasource(id);
    setDatasources(datasources.filter((d) => d.id !== id));
    if (selectedDsId === id) { setSelectedDsId(null); setStructure(null); }
    toast.success('数据源已删除');
  };

  const getDsInfo = (type: DatasourceType) => DS_TYPES.find((t) => t.value === type) || DS_TYPES[0];

  return (
    <div className="ds-panel">
      <div className="ds-panel-header">
        <span className="ds-panel-title">数据源</span>
        <button className="ds-add-btn" onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(EMPTY_FORM); }}>
          + 新建
        </button>
      </div>

      {showForm && (
        <div className="ds-form">
          <div className="ds-form-types">
            {DS_TYPES.map((t) => (
              <button
                key={t.value}
                className={`ds-type-chip ${form.type === t.value ? 'active' : ''}`}
                onClick={() => setForm({ ...form, type: t.value })}
              >
                <span className="ds-type-icon">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          <input
            className="ds-input"
            placeholder="数据源名称"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />

          {isJdbcType(form.type) && (
            <div className="ds-form-grid">
              <input className="ds-input" placeholder="主机" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
              <input className="ds-input" placeholder="端口" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
              <input className="ds-input" placeholder="数据库" value={form.database} onChange={(e) => setForm({ ...form, database: e.target.value })} />
              <input className="ds-input" placeholder="用户名" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              <input className="ds-input" placeholder="密码" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          )}

          {!isJdbcType(form.type) && (
            <div className="ds-form-grid">
              <input className="ds-input ds-input-full" placeholder="Base URL (https://api.example.com)" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />

              <div className="ds-section ds-input-full">
                <div className="ds-section-header">
                  <span>Headers</span>
                  <button
                    className="ds-kv-add"
                    onClick={() => setForm({ ...form, headers: [...form.headers, { key: '', value: '' }] })}
                  >
                    + 添加
                  </button>
                </div>
                {form.headers.length === 0 && (
                  <span className="ds-section-hint">无公共 Headers</span>
                )}
                {form.headers.map((h, i) => (
                  <div key={i} className="ds-kv-row">
                    <input
                      className="ds-input"
                      placeholder="Key"
                      value={h.key}
                      onChange={(e) => {
                        const nh = [...form.headers];
                        nh[i] = { ...nh[i], key: e.target.value };
                        setForm({ ...form, headers: nh });
                      }}
                    />
                    <input
                      className="ds-input"
                      placeholder="Value"
                      value={h.value}
                      onChange={(e) => {
                        const nh = [...form.headers];
                        nh[i] = { ...nh[i], value: e.target.value };
                        setForm({ ...form, headers: nh });
                      }}
                    />
                    <button
                      className="ds-kv-remove"
                      onClick={() => setForm({ ...form, headers: form.headers.filter((_, j) => j !== i) })}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <div className="ds-section ds-input-full">
                <div className="ds-section-header">
                  <span>认证</span>
                </div>
                <select
                  className="ds-input"
                  value={form.authType}
                  onChange={(e) => setForm({ ...form, authType: e.target.value as typeof form.authType })}
                >
                  <option value="none">None</option>
                  <option value="basic">Basic Auth</option>
                  <option value="apiKey">API Key</option>
                  <option value="bearer">Bearer Token</option>
                </select>

                {form.authType === 'basic' && (
                  <>
                    <input className="ds-input" placeholder="用户名" value={form.authUsername} onChange={(e) => setForm({ ...form, authUsername: e.target.value })} />
                    <input className="ds-input" placeholder="密码" type="password" value={form.authPassword} onChange={(e) => setForm({ ...form, authPassword: e.target.value })} />
                  </>
                )}

                {form.authType === 'apiKey' && (
                  <>
                    <input className="ds-input" placeholder="Key 名称" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
                    <input className="ds-input" placeholder="Value" type="password" value={form.apiValue} onChange={(e) => setForm({ ...form, apiValue: e.target.value })} />
                    <select
                      className="ds-input"
                      value={form.apiAddTo}
                      onChange={(e) => setForm({ ...form, apiAddTo: e.target.value as 'header' | 'query' })}
                    >
                      <option value="header">添加到 Header</option>
                      <option value="query">添加到 Query 参数</option>
                    </select>
                  </>
                )}

                {form.authType === 'bearer' && (
                  <input className="ds-input" placeholder="Bearer Token" type="password" value={form.bearerToken} onChange={(e) => setForm({ ...form, bearerToken: e.target.value })} />
                )}
              </div>
            </div>
          )}

          <div className="ds-form-actions">
            <button className="ds-btn ds-btn-primary" onClick={handleSubmit}>{editingId ? '保存' : '创建'}</button>
            <button className="ds-btn ds-btn-cancel" onClick={handleCancel}>取消</button>
          </div>
        </div>
      )}

      <div className="ds-list">
        {datasources.length === 0 && !showForm && (
          <div className="ds-empty">暂无数据源，点击"+ 新建"添加</div>
        )}
        {datasources.map((ds) => {
          const info = getDsInfo(ds.type);
          const isConnected = ds.status === 'connected';
          return (
            <div key={ds.id} className="ds-card">
              <div className="ds-card-main">
                <div className="ds-card-icon" style={{ background: info.color + '14' }}>
                  <span>{info.icon}</span>
                </div>
                <div className="ds-card-info">
                  <span className="ds-card-name">{ds.name}</span>
                  <span className="ds-card-type">{info.label}</span>
                </div>
                <span className={`ds-card-status ${isConnected ? 'connected' : ''}`}>
                  {isConnected ? '●' : '○'}
                </span>
              </div>
              <div className="ds-card-actions">
                <button className="ds-action-btn" onClick={() => handleEdit(ds)}>
                  ✏️ 编辑
                </button>
                <button
                  className="ds-action-btn"
                  onClick={() => handleTest(ds.id)}
                  disabled={testing === ds.id}
                >
                  {testing === ds.id ? '⏳' : '🔌'} 测试
                </button>
                {isJdbcType(ds.type) && (
                  <button className="ds-action-btn" onClick={() => handleViewStructure(ds.id)}>
                    📋 {selectedDsId === ds.id ? '收起' : '结构'}
                  </button>
                )}
                <button className="ds-action-btn ds-action-danger" onClick={() => handleDelete(ds.id)}>
                  🗑 删除
                </button>
              </div>

              {selectedDsId === ds.id && structure && (
                <div className="ds-structure">
                  <div className="ds-structure-title">数据库表结构</div>
                  {structure.tables.map((table) => (
                    <div key={table.name} className="ds-table">
                      <div className="ds-table-name">{table.name}</div>
                      {table.columns.map((col) => (
                        <div key={col.name} className="ds-column">
                          <span className="ds-col-name">{col.name}</span>
                          <span className="ds-col-type">{col.type}</span>
                          {col.primaryKey && <span className="ds-col-pk">PK</span>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}