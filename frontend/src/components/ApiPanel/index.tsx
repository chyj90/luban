import { useState, useEffect, useCallback } from 'react';
import { Key, Plus, X, ChevronDown, ChevronRight, ExternalLink, Code } from 'lucide-react';
import { listApplicationTools } from '@/api/tool';
import { toast } from '@/stores/toastStore';
import './ApiPanel.css';

interface KeyToolItem {
  id: number;
  toolId: number;
  apiKeyId: number;
  status: string;
  toolName: string;
  displayName: string;
  description: string;
  toolType: string;
  inputSchema: string;
  outputSchema: string;
}

interface ManualApi {
  id: number;
  name: string;
  method: string;
  url: string;
  description: string;
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

export function ApiPanel({ applicationId }: { applicationId: number }) {
  const [keyTools, setKeyTools] = useState<KeyToolItem[]>([]);
  const [manualApis, setManualApis] = useState<ManualApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTool, setExpandedTool] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', method: 'GET', url: '', description: '' });

  const fetchTools = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listApplicationTools(applicationId);
      setKeyTools((res.data as KeyToolItem[]) || []);
    } catch {
      setKeyTools([]);
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  const loadManualApis = () => {
    try {
      const stored = localStorage.getItem(`manual_apis_${applicationId}`);
      setManualApis(stored ? JSON.parse(stored) : []);
    } catch {
      setManualApis([]);
    }
  };

  useEffect(() => {
    loadManualApis();
  }, [applicationId]);

  const saveManualApis = (apis: ManualApi[]) => {
    localStorage.setItem(`manual_apis_${applicationId}`, JSON.stringify(apis));
    setManualApis(apis);
  };

  const handleSubmit = () => {
    if (!form.name.trim() || !form.url.trim()) return;
    if (editingId) {
      const updated = manualApis.map((a) => (a.id === editingId ? { ...form, id: editingId } : a));
      saveManualApis(updated);
      toast.success('API 已更新');
    } else {
      const newApi: ManualApi = { ...form, id: Date.now() };
      saveManualApis([newApi, ...manualApis]);
      toast.success('API 已添加');
    }
    setShowForm(false);
    setForm({ name: '', method: 'GET', url: '', description: '' });
    setEditingId(null);
  };

  const handleEdit = (api: ManualApi) => {
    setEditingId(api.id);
    setForm({ name: api.name, method: api.method, url: api.url, description: api.description });
    setShowForm(true);
  };

  const handleDelete = (id: number) => {
    saveManualApis(manualApis.filter((a) => a.id !== id));
    toast.success('API 已删除');
  };

  const formatSchema = (schema: string) => {
    try {
      return JSON.stringify(JSON.parse(schema), null, 2);
    } catch {
      return schema;
    }
  };

  const methodColor = (method: string) => {
    const colors: Record<string, string> = { GET: '#52c41a', POST: '#1677ff', PUT: '#fa8c16', DELETE: '#ff4d4f', PATCH: '#722ed1' };
    return colors[method] || '#666';
  };

  return (
    <div className="api-panel">
      <div className="api-panel-header">
        <span className="api-panel-title">API</span>
        <button
          className="api-add-btn"
          onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ name: '', method: 'GET', url: '', description: '' }); }}
        >
          <Plus size={14} /> 添加
        </button>
      </div>

      {showForm && (
        <div className="api-form">
          <div className="api-form-row">
            <select
              className="api-form-method"
              value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value })}
            >
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              className="api-form-url"
              placeholder="https://api.example.com/endpoint"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              autoFocus
            />
          </div>
          <input
            className="api-input"
            placeholder="API 名称"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className="api-input"
            placeholder="描述（可选）"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="api-form-actions">
            <button className="api-btn api-btn-primary" onClick={handleSubmit}>
              {editingId ? '保存' : '添加'}
            </button>
            <button className="api-btn api-btn-cancel" onClick={() => { setShowForm(false); setEditingId(null); }}>
              取消
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="api-empty">加载中...</div>
      ) : (
        <>
          {keyTools.length > 0 && (
            <div className="api-section">
              <div className="api-section-title">
                <Key size={14} />
                KEY 授权 API
                <span className="api-section-count">{keyTools.length}</span>
              </div>
              <div className="api-list">
                {keyTools.map((tool) => (
                  <div key={tool.id} className="api-card">
                    <div
                      className="api-card-header"
                      onClick={() => setExpandedTool(expandedTool === tool.id ? null : tool.id)}
                    >
                      <span className="api-card-chevron">
                        {expandedTool === tool.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </span>
                      <span className={`api-card-method method-${tool.toolType}`}>
                        {tool.toolType}
                      </span>
                      <span className="api-card-name">{tool.displayName || tool.toolName}</span>
                    </div>
                    {expandedTool === tool.id && (
                      <div className="api-card-detail">
                        {tool.description && (
                          <div className="api-detail-row">
                            <span className="api-detail-label">描述</span>
                            <span className="api-detail-value">{tool.description}</span>
                          </div>
                        )}
                        {tool.inputSchema && (
                          <div className="api-detail-row">
                            <span className="api-detail-label">输入 Schema</span>
                            <pre className="api-detail-code">{formatSchema(tool.inputSchema)}</pre>
                          </div>
                        )}
                        {tool.outputSchema && (
                          <div className="api-detail-row">
                            <span className="api-detail-label">输出 Schema</span>
                            <pre className="api-detail-code">{formatSchema(tool.outputSchema)}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="api-section">
            <div className="api-section-title">
              <Code size={14} />
              维护 API
              <span className="api-section-count">{manualApis.length}</span>
            </div>
            {manualApis.length === 0 && !showForm && (
              <div className="api-empty">暂无添加的 API，点击"+ 添加"添加</div>
            )}
            <div className="api-list">
              {manualApis.map((api) => (
                <div key={api.id} className="api-card">
                  <div className="api-card-header">
                    <span className="api-card-method" style={{ background: methodColor(api.method) + '14', color: methodColor(api.method) }}>
                      {api.method}
                    </span>
                    <span className="api-card-name">{api.name}</span>
                    <div className="api-card-actions">
                      <button className="api-card-action-btn" onClick={() => handleEdit(api)}>
                        <ExternalLink size={12} />
                      </button>
                      <button className="api-card-action-btn api-card-action-del" onClick={() => handleDelete(api.id)}>
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="api-card-url">{api.url}</div>
                  {api.description && <div className="api-card-desc">{api.description}</div>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}