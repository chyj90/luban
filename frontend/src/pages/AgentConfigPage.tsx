import { useState, useEffect, useCallback } from 'react';
import { Cpu } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import { getAgentConfig, updateAgentConfig, testAgentConfig } from '@/api/tool';
import { useToastStore } from '@/stores/toastStore';
import type { AgentConfig } from '@/types/tool';
import './AgentConfigPage.css';

interface ModelOption {
  id: string;
  name: string;
}

export default function AgentConfigPage() {
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AgentConfig | null>(null);
  const [form, setForm] = useState({ modelEndpoint: '', secretKey: '', modelName: '' });
  const [models, setModels] = useState<ModelOption[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'idle' | 'success' | 'fail'>('idle');
  const [testError, setTestError] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToastStore((s) => s.show);

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
    setForm({ modelEndpoint: config.modelEndpoint, secretKey: '', modelName: config.modelName });
    setModels([]);
    setTestResult('idle');
    setTestError('');
  };

  const closeEdit = () => {
    setEditing(null);
    setModels([]);
    setTestResult('idle');
    setTestError('');
  };

  const handleTest = async () => {
    if (!form.modelEndpoint) {
      toast('请先填写端点地址', 'error');
      return;
    }
    if (!form.secretKey) {
      toast('请先填写 API Key', 'error');
      return;
    }
    setTesting(true);
    setTestResult('idle');
    setTestError('');
    try {
      const res = await testAgentConfig({ modelEndpoint: form.modelEndpoint, secretKey: form.secretKey });
      if (res.data.success) {
        setTestResult('success');
        setModels(res.data.models || []);
        toast('连接成功', 'success');
      } else {
        setTestResult('fail');
        setTestError(res.data.error || '连接失败');
        setModels([]);
        toast('连接失败: ' + (res.data.error || '未知错误'), 'error');
      }
    } catch {
      setTestResult('fail');
      setTestError('网络请求失败');
      setModels([]);
      toast('测试请求失败', 'error');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!editing || !form.modelEndpoint) {
      toast('端点地址为必填项', 'error');
      return;
    }
    if (!form.modelName) {
      toast('请选择模型', 'error');
      return;
    }
    setSaving(true);
    try {
      await updateAgentConfig(editing.id, {
        name: editing.name,
        modelEndpoint: form.modelEndpoint,
        modelName: form.modelName,
        ...(form.secretKey ? { secretKey: form.secretKey } as Partial<AgentConfig> : {}),
      } as Partial<AgentConfig>);
      toast('保存成功', 'success');
      setEditing(null);
      fetchConfigs();
    } catch {
      toast('保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="agent-config-loading">加载中...</div>;
  }

  return (
    <div className="agent-config">
      <PageTopbar
        icon={<Cpu size={22} />}
        title="大模型配置"
        subtitle="配置大模型连接参数，管理模型的端点、密钥和默认设置"
      />
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
              <code title={config.modelEndpoint}>{config.modelEndpoint}</code>
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
        <div className="agent-config-overlay" onClick={closeEdit}>
          <div className="agent-config-form" onClick={(e) => e.stopPropagation()}>
            <h3 className="agent-config-form-title">编辑 {editing.name}</h3>

            <div className="agent-config-form-field">
              <label>模型端点</label>
              <input
                value={form.modelEndpoint}
                onChange={(e) => { setForm({ ...form, modelEndpoint: e.target.value }); setTestResult('idle'); }}
                placeholder="https://api.example.com/v1"
              />
            </div>

            <div className="agent-config-form-field">
              <label>API Key</label>
              <input
                type="password"
                value={form.secretKey}
                onChange={(e) => { setForm({ ...form, secretKey: e.target.value }); setTestResult('idle'); }}
                placeholder="已有密钥，重新输入以覆盖"
              />
            </div>

            <div className="agent-config-form-test">
              <button
                className="agent-config-form-test-btn"
                onClick={handleTest}
                disabled={testing || !form.secretKey}
              >
                {testing ? '测试中...' : '测试连接'}
              </button>
              {testResult === 'success' && (
                <span className="agent-config-form-test-ok">连接成功</span>
              )}
              {testResult === 'fail' && (
                <span className="agent-config-form-test-err" title={testError}>连接失败: {testError}</span>
              )}
            </div>

            <div className="agent-config-form-field">
              <label>模型名称</label>
              <select
                value={form.modelName}
                onChange={(e) => setForm({ ...form, modelName: e.target.value })}
                disabled={models.length === 0}
                className="agent-config-form-select"
              >
                {models.length === 0 ? (
                  <option value={form.modelName}>{form.modelName || '请先测试连接获取模型列表'}</option>
                ) : (
                  <>
                    <option value="">请选择模型</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </>
                )}
              </select>
            </div>

            <div className="agent-config-form-actions">
              <button className="agent-config-form-cancel" onClick={closeEdit}>取消</button>
              <button className="agent-config-form-save" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}