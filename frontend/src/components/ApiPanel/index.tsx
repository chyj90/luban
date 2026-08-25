import { useState, useEffect, useCallback } from 'react';
import { Key, Plus, X, Pencil, Code, Trash2 } from 'lucide-react';
import { listApplicationTools, createAppTool, updateAppTool, deleteAppTool } from '@/api/tool';
import { toast } from '@/stores/toastStore';
import type { SelectedApi } from '@/components/ApiDetail';
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
  config: string;
}

interface KeyValuePair {
  key: string;
  value: string;
  enabled: boolean;
}

interface AppToolItem {
  id: number;
  toolId: number;
  toolName: string;
  displayName: string;
  description: string;
  toolType: string;
  inputSchema: string;
  outputSchema: string;
  config: string;
  status: string;
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const CONTENT_TYPES = ['application/json', 'application/x-www-form-urlencoded', 'text/plain', 'multipart/form-data'];

type FormTab = 'basic' | 'headers' | 'params' | 'body';

interface ApiPanelProps {
  applicationId: number;
  selectedApi: SelectedApi | null;
  onSelect: (api: SelectedApi | null) => void;
  onToolsChange?: (tools: Array<{ id: number; name: string }>) => void;
}

function emptyApiForm() {
  return {
    name: '', method: 'GET', url: '', description: '',
    headers: [] as KeyValuePair[],
    queryParams: [] as KeyValuePair[],
    body: '',
    contentType: 'application/json',
  };
}

function parseAppToolConfig(tool: AppToolItem) {
  try {
    const cfg = JSON.parse(tool.config || '{}');
    return {
      id: tool.id,
      name: tool.displayName || tool.toolName || '',
      method: cfg.method || 'GET',
      url: cfg.url || '',
      description: tool.description || '',
      headers: (cfg.headers as KeyValuePair[]) || [],
      queryParams: (cfg.queryParams as KeyValuePair[]) || [],
      body: (cfg.body as string) || '',
      contentType: (cfg.contentType as string) || 'application/json',
    };
  } catch {
    return {
      id: tool.id,
      name: tool.displayName || tool.toolName || '',
      method: 'GET',
      url: '',
      description: tool.description || '',
      headers: [] as KeyValuePair[],
      queryParams: [] as KeyValuePair[],
      body: '',
      contentType: 'application/json',
    };
  }
}

export function ApiPanel({ applicationId, selectedApi, onSelect, onToolsChange }: ApiPanelProps) {
  const [keyTools, setKeyTools] = useState<KeyToolItem[]>([]);
  const [appTools, setAppTools] = useState<AppToolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyApiForm);
  const [formTab, setFormTab] = useState<FormTab>('basic');
  const [submitting, setSubmitting] = useState(false);

  const fetchTools = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listApplicationTools(applicationId);
      const items = (res.data as Record<string, unknown>[]) || [];
      const keys: KeyToolItem[] = [];
      const apps: AppToolItem[] = [];
      for (const item of items) {
        if (item.apiKeyId != null) {
          keys.push(item as unknown as KeyToolItem);
        } else {
          apps.push(item as unknown as AppToolItem);
        }
      }
      setKeyTools(keys);
      setAppTools(apps);
    } catch {
      setKeyTools([]);
      setAppTools([]);
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => { fetchTools(); }, [fetchTools]);

  useEffect(() => {
    const selfTools = appTools.map((t) => ({ id: t.id, name: t.displayName || t.toolName || '' }));
    const keyToolItems = keyTools.map((t) => ({ id: t.id, name: t.displayName || t.toolName || '' }));
    const merged = [...selfTools, ...keyToolItems.filter(kt => !selfTools.some(st => st.id === kt.id))];
    onToolsChange?.(merged);
  }, [appTools, keyTools, onToolsChange]);

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.url.trim()) return;
    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        displayName: form.name,
        method: form.method,
        url: form.url,
        description: form.description,
        headers: form.headers.filter((h) => h.key.trim()),
        queryParams: form.queryParams.filter((p) => p.key.trim()),
        body: form.body,
        contentType: form.contentType,
      };
      if (editingId) {
        await updateAppTool(applicationId, editingId, payload);
        toast.success('API 已更新');
      } else {
        await createAppTool(applicationId, payload);
        toast.success('API 已添加');
      }
      setShowForm(false);
      setForm(emptyApiForm());
      setEditingId(null);
      setFormTab('basic');
      fetchTools();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (raw: AppToolItem) => {
    const api = parseAppToolConfig(raw);
    setEditingId(api.id);
    setForm({
      name: api.name,
      method: api.method,
      url: api.url,
      description: api.description,
      headers: api.headers || [],
      queryParams: api.queryParams || [],
      body: api.body || '',
      contentType: api.contentType || 'application/json',
    });
    setFormTab('basic');
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteAppTool(applicationId, id);
      if (selectedApi?.type === 'app' && selectedApi.data.id === id) {
        onSelect(null);
      }
      toast.success('API 已删除');
      fetchTools();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const handleSelectAppTool = (raw: AppToolItem) => {
    if (selectedApi?.type === 'app' && selectedApi.data.id === raw.id) {
      onSelect(null);
      return;
    }
    const api = parseAppToolConfig(raw);
    onSelect({ type: 'app', data: { ...api, id: raw.id } });
  };

  const addKvPair = (field: 'headers' | 'queryParams') => {
    setForm({ ...form, [field]: [...form[field], { key: '', value: '', enabled: true }] });
  };

  const updateKvPair = (field: 'headers' | 'queryParams', index: number, update: Partial<KeyValuePair>) => {
    const copy = [...form[field]];
    copy[index] = { ...copy[index], ...update };
    setForm({ ...form, [field]: copy });
  };

  const removeKvPair = (field: 'headers' | 'queryParams', index: number) => {
    setForm({ ...form, [field]: form[field].filter((_, i) => i !== index) });
  };

  const methodColor = (method: string) => {
    const colors: Record<string, string> = { GET: '#52c41a', POST: '#1677ff', PUT: '#fa8c16', DELETE: '#ff4d4f', PATCH: '#722ed1' };
    return colors[method] || '#666';
  };

  const isSelected = (type: 'key' | 'app', id: number) => {
    if (!selectedApi) return false;
    return selectedApi.type === type && selectedApi.data.id === id;
  };

  const FORM_TABS: { key: FormTab; label: string }[] = [
    { key: 'basic', label: '基本信息' },
    { key: 'headers', label: 'Headers' },
    { key: 'params', label: 'Query 参数' },
    { key: 'body', label: 'Body' },
  ];

  return (
    <div className="api-panel">
      <div className="api-panel-header">
        <span className="api-panel-title">API</span>
        <button
          className="api-add-btn"
          onClick={() => {
            setShowForm(!showForm);
            setEditingId(null);
            setForm(emptyApiForm());
            setFormTab('basic');
          }}
        >
          <Plus size={14} /> 添加
        </button>
      </div>

      {showForm && (
        <div className="api-form">
          <div className="api-form-tabs">
            {FORM_TABS.map((tab) => (
              <button
                key={tab.key}
                className={`api-form-tab ${formTab === tab.key ? 'active' : ''}`}
                onClick={() => setFormTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {formTab === 'basic' && (
            <div className="api-form-body">
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
            </div>
          )}

          {formTab === 'headers' && (
            <div className="api-form-body">
              <div className="api-kv-header">
                <span className="api-kv-label">Header</span>
                <span className="api-kv-label">Value</span>
                <button className="api-kv-add" onClick={() => addKvPair('headers')}>
                  <Plus size={14} /> 添加
                </button>
              </div>
              {form.headers.map((h, i) => (
                <div key={i} className="api-kv-row">
                  <input
                    className="api-kv-input"
                    placeholder="Key"
                    value={h.key}
                    onChange={(e) => updateKvPair('headers', i, { key: e.target.value })}
                  />
                  <input
                    className="api-kv-input"
                    placeholder="Value"
                    value={h.value}
                    onChange={(e) => updateKvPair('headers', i, { value: e.target.value })}
                  />
                  <button className="api-kv-remove" onClick={() => removeKvPair('headers', i)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {form.headers.length === 0 && (
                <div className="api-kv-empty">暂无 Header，点击"添加"添加</div>
              )}
            </div>
          )}

          {formTab === 'params' && (
            <div className="api-form-body">
              <div className="api-kv-header">
                <span className="api-kv-label">参数名</span>
                <span className="api-kv-label">参数值</span>
                <button className="api-kv-add" onClick={() => addKvPair('queryParams')}>
                  <Plus size={14} /> 添加
                </button>
              </div>
              {form.queryParams.map((p, i) => (
                <div key={i} className="api-kv-row">
                  <input
                    className="api-kv-input"
                    placeholder="Key"
                    value={p.key}
                    onChange={(e) => updateKvPair('queryParams', i, { key: e.target.value })}
                  />
                  <input
                    className="api-kv-input"
                    placeholder="Value"
                    value={p.value}
                    onChange={(e) => updateKvPair('queryParams', i, { value: e.target.value })}
                  />
                  <button className="api-kv-remove" onClick={() => removeKvPair('queryParams', i)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {form.queryParams.length === 0 && (
                <div className="api-kv-empty">暂无 Query 参数，点击"添加"添加</div>
              )}
            </div>
          )}

          {formTab === 'body' && (
            <div className="api-form-body">
              <select
                className="api-form-content-type"
                value={form.contentType}
                onChange={(e) => setForm({ ...form, contentType: e.target.value })}
              >
                {CONTENT_TYPES.map((ct) => (
                  <option key={ct} value={ct}>{ct}</option>
                ))}
              </select>
              <textarea
                className="api-form-body-input"
                placeholder='{"key": "value"}'
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                rows={8}
              />
            </div>
          )}

          <div className="api-form-hint">
            <div className="api-form-hint-title">
              <Code size={14} />
              动态参数
            </div>
            <div className="api-form-hint-text">
              在 URL、Header、Body 中使用 <code>{'{{变量名}}'}</code> 占位符，调用时由 SDK 传入实际值替换
            </div>
            <div className="api-form-hint-text">
              SDK 调用示例：
              <code>__LUBAN__.callApi('{form.name || 'API名称'}', {'{'} 变量名: '值' {'}'})</code>
            </div>
          </div>

          <div className="api-form-actions">
            <button className="api-btn api-btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? '提交中...' : (editingId ? '保存' : '添加')}
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
                  <div
                    key={tool.id}
                    className={`api-card ${isSelected('key', tool.id) ? 'api-card--selected' : ''}`}
                    onClick={() => onSelect(isSelected('key', tool.id) ? null : { type: 'key', data: tool })}
                  >
                    <div className="api-card-header">
                      <span className={`api-card-method method-${tool.toolType}`}>
                        {tool.toolType}
                      </span>
                      <span className="api-card-name">{tool.displayName || tool.toolName}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="api-section">
            <div className="api-section-title">
              <Code size={14} />
              维护 API
              <span className="api-section-count">{appTools.length}</span>
            </div>
            {appTools.length === 0 && !showForm && (
              <div className="api-empty">暂无 API，点击"+ 添加"添加</div>
            )}
            <div className="api-list">
              {appTools.map((raw) => {
                const api = parseAppToolConfig(raw);
                return (
                  <div
                    key={raw.id}
                    className={`api-card ${isSelected('app', raw.id) ? 'api-card--selected' : ''}`}
                    onClick={() => handleSelectAppTool(raw)}
                  >
                    <div className="api-card-header">
                      <span className="api-card-method" style={{ background: methodColor(api.method) + '14', color: methodColor(api.method) }}>
                        {api.method}
                      </span>
                      <span className="api-card-name">{api.name}</span>
                      <div className="api-card-actions" onClick={(e) => e.stopPropagation()}>
                        <button className="api-card-action-btn" onClick={() => handleEdit(raw)} title="编辑">
                          <Pencil size={12} />
                        </button>
                        <button className="api-card-action-btn api-card-action-del" onClick={() => handleDelete(raw.id)}>
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="api-card-url">{api.url}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}