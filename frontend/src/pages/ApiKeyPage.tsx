import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Key, Check, X, Pencil, Shield, Ban, RotateCcw, Trash2 } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import { listApiKeys, generateApiKey, deleteApiKey, deletePermanentApiKey, restoreApiKey, renameApiKey, listApplicationsByKey } from '@/api/tool';
import { useToastStore } from '@/stores/toastStore';
import { useConfirmStore } from '@/stores/confirmStore';
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
  const navigate = useNavigate();
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [appBindings, setAppBindings] = useState<Map<number, string[]>>(new Map());
  const [showNewKey, setShowNewKey] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [editingKeyId, setEditingKeyId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const toast = useToastStore((s) => s.show);
  const confirm = useConfirmStore((s) => s.confirm);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await listApiKeys();
      const keyList = (res.data as ApiKeyItem[]) || [];
      setKeys(keyList);

      const bindings = new Map<number, string[]>();
      await Promise.all(keyList.map(async (key) => {
        try {
          const appRes = await listApplicationsByKey(key.id);
          const apps = (appRes.data as { name: string }[]) || [];
          bindings.set(key.id, apps.map((a) => a.name));
        } catch {
          bindings.set(key.id, []);
        }
      }));
      setAppBindings(bindings);
    } catch {
      toast('加载 API Key 失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleGenerate = async () => {
    const name = newKeyName.trim() || '默认 Key';
    const result = await confirm({
      title: '确认生成',
      message: "您将生成名为" + name + "的 API Key，确定继续吗？",
    });
    if (!result) return;
    try {
      const res = await generateApiKey(newKeyName.trim() || undefined);
      const data = res.data as { apiKeyId: string };
      setShowNewKey(data.apiKeyId);
      setNewKeyName('');
      fetchKeys();
      toast('生成成功', 'success');
    } catch {
      toast('生成失败', 'error');
    }
  };

  const startEditName = (key: ApiKeyItem) => {
    setEditingKeyId(key.id);
    setEditingName(key.name);
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const saveEditName = async () => {
    if (editingKeyId === null || savingRef.current) return;
    const name = editingName.trim();
    if (!name) {
      setEditingKeyId(null);
      return;
    }
    savingRef.current = true;
    try {
      await renameApiKey(editingKeyId, name);
      setKeys((prev) => prev.map((k) => (k.id === editingKeyId ? { ...k, name } : k)));
      toast('重命名成功', 'success');
    } catch {
      toast('重命名失败', 'error');
    }
    savingRef.current = false;
    setEditingKeyId(null);
  };

  const cancelEditName = () => {
    setEditingKeyId(null);
  };

  const handleDelete = async (key: ApiKeyItem) => {
    const result = await confirm({
      title: '确认吊销',
      message: "确定要吊销 API Key " + key.name + " 吗？吊销后所有使用该 Key 的请求将立即失效。",
    });
    if (!result) return;
    try {
      await deleteApiKey(key.id);
      toast('吊销成功', 'success');
      fetchKeys();
    } catch {
      toast('吊销失败', 'error');
    }
  };

  const handlePermanentDelete = async (key: ApiKeyItem) => {
    const result = await confirm({
      title: '确认删除',
      message: "确定要永久删除 API Key " + key.name + " 吗？此操作不可撤销，所有关联的权限记录也将一并删除。",
    });
    if (!result) return;
    try {
      await deletePermanentApiKey(key.id);
      toast('已删除', 'success');
      fetchKeys();
    } catch {
      toast('删除失败', 'error');
    }
  };

  const handleRestore = async (key: ApiKeyItem) => {
    try {
      await restoreApiKey(key.id);
      toast('已恢复', 'success');
      fetchKeys();
    } catch {
      toast('恢复失败', 'error');
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
      <PageTopbar
        icon={<Key size={22} />}
        title="我的 KEY"
        subtitle="管理 API 访问密钥，用于外部系统调用平台接口"
        actions={
          <div className="api-key-header-right">
            <input
              className="api-key-name-input"
              type="text"
              placeholder="输入名称便于识别，如 生产环境"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleGenerate(); }}
            />
            <button className="api-key-generate-btn" onClick={handleGenerate}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              生成新 KEY
            </button>
          </div>
        }
      />

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
              <th>绑定应用</th>
              <th>创建时间</th>
              <th>最近使用</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td colSpan={7} className="api-key-empty">暂无 API Key</td>
              </tr>
            ) : (
              keys.map((key) => (
                <tr key={key.id}>
                  <td className="api-key-name">
                    {editingKeyId === key.id ? (
                      <div className="api-key-name-edit">
                        <input
                          ref={editInputRef}
                          className="api-key-name-edit-input"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditName();
                            if (e.key === 'Escape') cancelEditName();
                          }}
                        />
                        <button className="api-key-name-edit-btn" onMouseDown={(e) => { e.preventDefault(); saveEditName(); }}><Check size={14} /></button>
                        <button className="api-key-name-edit-btn" onMouseDown={(e) => { e.preventDefault(); cancelEditName(); }}><X size={14} /></button>
                      </div>
                    ) : (
                      <span className="api-key-name-text" onClick={() => { if (key.status === 'ACTIVE') startEditName(key); }} title="点击编辑名称">
                        {key.name}
                        {key.status === 'ACTIVE' && <Pencil size={12} className="api-key-name-edit-icon" />}
                      </span>
                    )}
                  </td>
                  <td><code className="api-key-id">{key.apiKeyId}</code></td>
                  <td>
                    <span className={`api-key-status ${key.status === 'ACTIVE' ? 'active' : 'revoked'}`}>
                      {key.status === 'ACTIVE' ? '活跃' : '已吊销'}
                    </span>
                  </td>
                  <td>
                    <span className="api-key-app-bindings">
                      {(() => {
                        const apps = appBindings.get(key.id) || [];
                        if (apps.length === 0) return <span className="api-key-app-none">未绑定</span>;
                        return apps.map((name, i) => (
                          <span key={i} className="api-key-app-tag">{name}</span>
                        ));
                      })()}
                    </span>
                  </td>
                  <td>{key.createdAt ? new Date(key.createdAt).toLocaleString() : '-'}</td>
                  <td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : '-'}</td>
                  <td>
                    <div className="api-key-row-actions">
                      {key.status === 'ACTIVE' ? (
                        <>
                          <button className="api-key-row-btn" onClick={() => navigate(`/connect/keys/${key.id}/permissions`)} data-tip="申请权限">
                            <Shield size={16} />
                          </button>
                          <button className="api-key-row-btn danger" onClick={() => handleDelete(key)} data-tip="吊销">
                            <Ban size={16} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="api-key-row-btn" onClick={() => handleRestore(key)} data-tip="恢复">
                            <RotateCcw size={16} />
                          </button>
                          <button className="api-key-row-btn danger" onClick={() => handlePermanentDelete(key)} data-tip="删除">
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}