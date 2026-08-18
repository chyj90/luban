import { useState, useEffect, useCallback } from 'react';
import { listApiKeys, generateApiKey, deleteApiKey, requestToolPermission, listToolDefinitions } from '@/api/tool';
import { useToastStore } from '@/stores/toastStore';
import { useConfirmStore } from '@/stores/confirmStore';
import type { ToolDefinition } from '@/types/tool';
import './ApiKeyPage.css';

interface ApiKeyItem {
  id: number;
  apiKeyId: string;
  name: string;
  status: string;
  createdAt: string;
  lastUsedAt: string;
}

export default function ApiKeyPage() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewKey, setShowNewKey] = useState<string | null>(null);
  const [showPermission, setShowPermission] = useState<number | null>(null);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [selectedToolId, setSelectedToolId] = useState<number>(0);
  const toast = useToastStore((s) => s.add);
  const confirm = useConfirmStore((s) => s.show);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await listApiKeys();
      setKeys(res.data as ApiKeyItem[]);
    } catch {
      toast('加载 API Key 失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchTools = useCallback(async () => {
    try {
      const res = await listToolDefinitions();
      setTools(res.data);
      if (res.data.length > 0) {
        setSelectedToolId(res.data[0].id);
      }
    } catch {
      toast('加载工具列表失败', 'error');
    }
  }, [toast]);

  useEffect(() => {
    fetchKeys();
    fetchTools();
  }, [fetchKeys, fetchTools]);

  const handleGenerate = async () => {
    try {
      const res = await generateApiKey();
      const data = res.data as { apiKeyId: string };
      setShowNewKey(data.apiKeyId);
      fetchKeys();
      toast('生成成功', 'success');
    } catch {
      toast('生成失败', 'error');
    }
  };

  const handleDelete = async (key: ApiKeyItem) => {
    confirm({
      title: '确认删除',
      message: `确定要吊销 API Key「${key.name}」吗？吊销后所有使用该 Key 的请求将立即失效。`,
      onConfirm: async () => {
        try {
          await deleteApiKey(key.id);
          toast('吊销成功', 'success');
          fetchKeys();
        } catch {
          toast('吊销失败', 'error');
        }
      },
    });
  };

  const handleRequestPermission = async () => {
    if (showPermission === null || !selectedToolId) return;
    try {
      await requestToolPermission(showPermission, selectedToolId);
      toast('权限申请已提交', 'success');
      setShowPermission(null);
    } catch {
      toast('权限申请失败', 'error');
    }
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key).then(() => {
      toast('已复制到剪贴板', 'success');
    });
  };

  if (loading) {
    return <div className="api-key-loading">加载中...</div>;
  }

  return (
    <div className="api-key">
      <div className="api-key-header">
        <h2 className="api-key-title">API Key 管理</h2>
        <button className="api-key-generate-btn" onClick={handleGenerate}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          生成新 Key
        </button>
      </div>

      {showNewKey && (
        <div className="api-key-new-key">
          <div className="api-key-new-key-header">
            <h3>新 Key 已生成</h3>
            <span className="api-key-new-key-warning">请立即复制，关闭后将无法再次查看</span>
          </div>
          <div className="api-key-new-key-value">
            <code>{showNewKey}</code>
            <button onClick={() => copyKey(showNewKey)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              复制
            </button>
          </div>
          <button className="api-key-new-key-close" onClick={() => setShowNewKey(null)}>已复制，关闭</button>
        </div>
      )}

      <div className="api-key-table-wrap">
        <table className="api-key-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>Key ID</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>最近使用</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td colSpan={6} className="api-key-empty">暂无 API Key</td>
              </tr>
            ) : (
              keys.map((key) => (
                <tr key={key.id}>
                  <td className="api-key-name">{key.name}</td>
                  <td><code className="api-key-id">{key.apiKeyId}</code></td>
                  <td>
                    <span className={`api-key-status ${key.status === 'ACTIVE' ? 'active' : 'revoked'}`}>
                      {key.status === 'ACTIVE' ? '活跃' : '已吊销'}
                    </span>
                  </td>
                  <td>{key.createdAt ? new Date(key.createdAt).toLocaleString() : '-'}</td>
                  <td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : '-'}</td>
                  <td>
                    <div className="api-key-row-actions">
                      <button
                        className="api-key-row-btn"
                        onClick={() => { setShowPermission(key.id); }}
                        disabled={key.status !== 'ACTIVE'}
                      >
                        申请权限
                      </button>
                      <button
                        className="api-key-row-btn danger"
                        onClick={() => handleDelete(key)}
                        disabled={key.status !== 'ACTIVE'}
                      >
                        吊销
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showPermission !== null && (
        <div className="api-key-perm-overlay" onClick={() => setShowPermission(null)}>
          <div className="api-key-perm" onClick={(e) => e.stopPropagation()}>
            <h3 className="api-key-perm-title">申请工具权限</h3>
            <div className="api-key-perm-field">
              <label>选择工具</label>
              <select value={selectedToolId} onChange={(e) => setSelectedToolId(Number(e.target.value))}>
                {tools.map((t) => (
                  <option key={t.id} value={t.id}>{t.displayName} ({t.name})</option>
                ))}
              </select>
            </div>
            <div className="api-key-perm-actions">
              <button className="api-key-perm-cancel" onClick={() => setShowPermission(null)}>取消</button>
              <button className="api-key-perm-submit" onClick={handleRequestPermission}>提交申请</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}