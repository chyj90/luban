import { useState, useEffect, useCallback } from 'react';
import { Shield, Plus, Pencil, Trash2, X, Check, Loader2, Globe, Building2 } from 'lucide-react';
import type { Role } from '@/types/user';
import { listRoles, createRole, updateRole, deleteRole } from '@/api/user';
import './RoleManagementPage.css';

const SCOPE_LABELS: Record<string, string> = {
  PLATFORM: '平台级',
  APPLICATION: '应用级',
};

export default function RoleManagementPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [form, setForm] = useState({ name: '', slug: '', description: '', scope: 'PLATFORM' });
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Role | null>(null);

  const fetchRoles = useCallback(async () => {
    try {
      const res = await listRoles();
      setRoles(res.data as Role[]);
    } catch {
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', slug: '', description: '', scope: 'PLATFORM' });
    setShowForm(true);
  };

  const openEdit = (role: Role) => {
    setEditing(role);
    setForm({ name: role.name, slug: role.slug, description: role.description, scope: role.scope });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.slug) return;
    setSaving(true);
    try {
      if (editing) {
        await updateRole(editing.id, form);
      } else {
        await createRole(form);
      }
      setShowForm(false);
      setEditing(null);
      fetchRoles();
    } catch {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteRole(deleteConfirm.id);
      setDeleteConfirm(null);
      fetchRoles();
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="role-page__loading">
        <Loader2 className="role-page__loading-icon" />
        <span>加载中...</span>
      </div>
    );
  }

  return (
    <div className="role-page">
      <div className="role-page__header">
        <div className="role-page__header-left">
          <Shield size={20} />
          <h2>角色管理</h2>
          <span className="role-page__count">{roles.length} 个角色</span>
        </div>
        <button className="role-page__add-btn" onClick={openCreate}>
          <Plus size={16} />
          新建角色
        </button>
      </div>

      <div className="role-page__grid">
        {roles.length === 0 ? (
          <div className="role-page__empty">暂无角色数据</div>
        ) : (
          roles.map((role) => (
            <div key={role.id} className="role-page__card">
              <div className="role-page__card-body">
                <div className="role-page__card-icon">
                  <Shield size={20} />
                </div>
                <div className="role-page__card-info">
                  <h4 className="role-page__card-name">{role.name}</h4>
                  <span className="role-page__card-slug">{role.slug}</span>
                  <p className="role-page__card-desc">{role.description}</p>
                </div>
              </div>
              <div className="role-page__card-footer">
                <span className="role-page__scope-badge">
                  <Globe size={12} />
                  {SCOPE_LABELS[role.scope] || role.scope}
                </span>
                <div className="role-page__card-actions">
                  <button className="role-page__action-btn" onClick={() => openEdit(role)}>
                    <Pencil size={14} />
                  </button>
                  <button
                    className="role-page__action-btn role-page__action-btn--danger"
                    onClick={() => setDeleteConfirm(role)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {showForm && (
        <div className="role-page__modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="role-page__modal" onClick={(e) => e.stopPropagation()}>
            <div className="role-page__modal-header">
              <h3>{editing ? '编辑角色' : '新建角色'}</h3>
              <button className="role-page__modal-close" onClick={() => setShowForm(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="role-page__modal-body">
              <div className="role-page__form-group">
                <label>角色名称</label>
                <input
                  type="text"
                  placeholder="如：超级管理员"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="role-page__form-group">
                <label>角色标识</label>
                <input
                  type="text"
                  placeholder="如：super_admin"
                  value={form.slug}
                  onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value }))}
                />
              </div>
              <div className="role-page__form-group">
                <label>描述</label>
                <textarea
                  placeholder="角色描述"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                />
              </div>
              <div className="role-page__form-group">
                <label>作用域</label>
                <select
                  value={form.scope}
                  onChange={(e) => setForm((prev) => ({ ...prev, scope: e.target.value }))}
                >
                  <option value="PLATFORM">平台级</option>
                  <option value="APPLICATION">应用级</option>
                </select>
              </div>
            </div>
            <div className="role-page__modal-footer">
              <button className="role-page__modal-cancel" onClick={() => setShowForm(false)}>
                取消
              </button>
              <button className="role-page__modal-save" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 size={14} className="role-page__spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    保存
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="role-page__modal-backdrop" onClick={() => setDeleteConfirm(null)}>
          <div className="role-page__modal" onClick={(e) => e.stopPropagation()}>
            <div className="role-page__modal-header">
              <h3>删除角色</h3>
              <button className="role-page__modal-close" onClick={() => setDeleteConfirm(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="role-page__modal-body">
              <p className="role-page__delete-confirm-text">
                确定要删除角色 <strong>{deleteConfirm.name}</strong> ({deleteConfirm.slug}) 吗？此操作不可撤销。
              </p>
            </div>
            <div className="role-page__modal-footer">
              <button className="role-page__modal-cancel" onClick={() => setDeleteConfirm(null)}>
                取消
              </button>
              <button className="role-page__modal-save role-page__modal-save--danger" onClick={handleDelete}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}