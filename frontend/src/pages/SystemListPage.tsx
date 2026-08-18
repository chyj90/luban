import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { listToolGroups, createToolGroup, updateToolGroup, deleteToolGroup } from '@/api/tool';
import { useToastStore } from '@/stores/toastStore';
import { useConfirmStore } from '@/stores/confirmStore';
import type { ToolGroup } from '@/types/tool';
import './SystemListPage.css';

export default function SystemListPage() {
  const [groups, setGroups] = useState<ToolGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ToolGroup | null>(null);
  const [form, setForm] = useState({ name: '', code: '', description: '', icon: 'database' });
  const [showKey, setShowKey] = useState<number | null>(null);
  const navigate = useNavigate();
  const toast = useToastStore((s) => s.add);
  const confirm = useConfirmStore((s) => s.show);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await listToolGroups();
      setGroups(res.data);
    } catch {
      toast('加载系统列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleSubmit = async () => {
    if (!form.name || !form.code) {
      toast('名称和编码为必填项', 'error');
      return;
    }
    try {
      if (editing) {
        await updateToolGroup(editing.id, form);
        toast('更新成功', 'success');
      } else {
        await createToolGroup(form);
        toast('创建成功', 'success');
      }
      setShowForm(false);
      setEditing(null);
      fetchGroups();
    } catch {
      toast('操作失败', 'error');
    }
  };

  const handleDelete = async (group: ToolGroup) => {
    confirm({
      title: '确认删除',
      message: `确定要删除系统「${group.name}」吗？删除后该系统的所有工具也将无法使用。`,
      onConfirm: async () => {
        try {
          await deleteToolGroup(group.id);
          toast('删除成功', 'success');
          fetchGroups();
        } catch {
          toast('删除失败', 'error');
        }
      },
    });
  };

  const openEdit = (group: ToolGroup) => {
    setEditing(group);
    setForm({ name: group.name, code: group.code, description: group.description || '', icon: group.icon || 'database' });
    setShowForm(true);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', code: '', description: '', icon: 'database' });
    setShowForm(true);
  };

  if (loading) {
    return <div className="system-list-loading">加载中...</div>;
  }

  return (
    <div className="system-list">
      <div className="system-list-header">
        <h2 className="system-list-title">系统列表</h2>
        <button className="system-list-add-btn" onClick={openCreate}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新建系统
        </button>
      </div>

      <div className="system-list-grid">
        {groups.map((group) => (
          <div key={group.id} className="system-card">
            <div className="system-card-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1677ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              </svg>
            </div>
            <div className="system-card-body">
              <h3 className="system-card-name">{group.name}</h3>
              <span className="system-card-code">{group.code}</span>
              <p className="system-card-desc">{group.description || '暂无描述'}</p>
              <div className="system-card-meta">
                <span className={`system-card-status ${group.status === 'ENABLED' ? 'enabled' : 'disabled'}`}>
                  {group.status === 'ENABLED' ? '启用' : '禁用'}
                </span>
              </div>
            </div>
            <div className="system-card-actions">
              <button
                className="system-card-btn"
                title="查看工具"
                onClick={() => navigate(`/connect/tools?groupId=${group.id}`)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
              <button className="system-card-btn" title="编辑" onClick={() => openEdit(group)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              <button
                className="system-card-btn"
                title="查看密钥"
                onClick={() => setShowKey(showKey === group.id ? null : group.id)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
              </button>
              <button className="system-card-btn danger" title="删除" onClick={() => handleDelete(group)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
            {showKey === group.id && group.publicKey && (
              <div className="system-card-key">
                <span className="system-card-key-label">公钥</span>
                <code className="system-card-key-value">{group.publicKey}</code>
              </div>
            )}
          </div>
        ))}
      </div>

      {showForm && (
        <div className="system-form-overlay" onClick={() => setShowForm(false)}>
          <div className="system-form" onClick={(e) => e.stopPropagation()}>
            <h3 className="system-form-title">{editing ? '编辑系统' : '新建系统'}</h3>
            <div className="system-form-field">
              <label className="system-form-label">系统名称</label>
              <input
                className="system-form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：MES系统"
              />
            </div>
            <div className="system-form-field">
              <label className="system-form-label">系统编码</label>
              <input
                className="system-form-input"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="如：mes"
              />
            </div>
            <div className="system-form-field">
              <label className="system-form-label">描述</label>
              <textarea
                className="system-form-textarea"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="简要描述该系统功能"
                rows={3}
              />
            </div>
            <div className="system-form-actions">
              <button className="system-form-cancel" onClick={() => setShowForm(false)}>取消</button>
              <button className="system-form-submit" onClick={handleSubmit}>
                {editing ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}