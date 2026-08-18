import { useState, useEffect, useCallback } from 'react';
import { getAgentConfig, updateAgentConfig } from '@/api/tool';
import { useToastStore } from '@/stores/toastStore';
import type { AgentConfig } from '@/types/tool';
import './AgentConfigPage.css';

export default function AgentConfigPage() {
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AgentConfig | null>(null);
  const [form, setForm] = useState({ modelEndpoint: '', modelName: '' });
  const toast = useToastStore((s) => s.add);

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await getAgentConfig();
      setConfigs(res.data);
    } catch {
      toast('加载配置失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const openEdit = (config: AgentConfig) => {
    setEditing(config);
    setForm({ modelEndpoint: config.modelEndpoint, modelName: config.modelName });
  };

  const handleSave = async () => {
    if (!editing || !form.modelEndpoint) {
      toast('端点地址为必填项', 'error');
      return;
    }
    try {
      await updateAgentConfig(editing.id, form);
      toast('保存成功', 'success');
      setEditing(null);
      fetchConfigs();
    } catch {
      toast('保存失败', 'error');
    }
  };

  if (loading) {
    return <div className="agent-config-loading">加载中...</div>;
  }

  return (
    <div className="agent-config">
      <h2 className="agent-config-title">Agent 配置</h2>
      <div className="agent-config-grid">
        {configs.map((config) => (
          <div key={config.id} className="agent-config-card">
            <div className="agent-config-card-header">
              <h3 className="agent-config-card-name">{config.name}</h3>
              {config.isDefault && <span className="agent-config-card-default">默认</span>}
              <span className={`agent-config-card-status ${config.status === 'ENABLED' ? 'enabled' : 'disabled'}`}>
                {config.status === 'ENABLED' ? '启用' : '禁用'}
              </span>
            </div>
            <div className="agent-config-card-field">
              <label>模型端点</label>
              <code>{config.modelEndpoint}</code>
            </div>
            <div className="agent-config-card-field">
              <label>模型名称</label>
              <code>{config.modelName}</code>
            </div>
            <button className="agent-config-card-edit" onClick={() => openEdit(config)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              编辑
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="agent-config-overlay" onClick={() => setEditing(null)}>
          <div className="agent-config-form" onClick={(e) => e.stopPropagation()}>
            <h3 className="agent-config-form-title">编辑 {editing.name}</h3>
            <div className="agent-config-form-field">
              <label>模型端点</label>
              <input value={form.modelEndpoint} onChange={(e) => setForm({ ...form, modelEndpoint: e.target.value })} placeholder="https://api.example.com/v1" />
            </div>
            <div className="agent-config-form-field">
              <label>模型名称</label>
              <input value={form.modelName} onChange={(e) => setForm({ ...form, modelName: e.target.value })} placeholder="deepseek-v4" />
            </div>
            <div className="agent-config-form-actions">
              <button className="agent-config-form-cancel" onClick={() => setEditing(null)}>取消</button>
              <button className="agent-config-form-save" onClick={handleSave}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}