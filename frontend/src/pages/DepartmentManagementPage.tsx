import { useState, useEffect, useCallback } from 'react';
import { Building2, Plus, Pencil, Trash2, X, Check, Loader2, Users, ChevronRight } from 'lucide-react';
import type { Department, User } from '@/types/user';
import { listDepartments, createDepartment, updateDepartment, deleteDepartment, listUsers } from '@/api/user';
import Select from '@/components/Select';
import './DepartmentManagementPage.css';

export default function DepartmentManagementPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState({ name: '', managerId: null as number | null, parentId: null as number | null });
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Department | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [deptsRes, usersRes] = await Promise.all([listDepartments(), listUsers()]);
      setDepartments(deptsRes.data as Department[]);
      setUsers(usersRes.data as User[]);
    } catch {
      setDepartments([]);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', managerId: null, parentId: null });
    setShowForm(true);
  };

  const openEdit = (dept: Department) => {
    setEditing(dept);
    setForm({ name: dept.name, managerId: dept.managerId, parentId: dept.parentId });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        managerId: form.managerId ?? undefined,
        parentId: form.parentId ?? undefined,
      };
      if (editing) {
        await updateDepartment(editing.id, payload);
      } else {
        await createDepartment(payload);
      }
      setShowForm(false);
      setEditing(null);
      fetchData();
    } catch {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteDepartment(deleteConfirm.id);
      setDeleteConfirm(null);
      fetchData();
    } catch {
      // ignore
    }
  };

  const getManagerName = (managerId: number | null) => {
    if (!managerId) return null;
    const user = users.find((u) => u.id === managerId);
    return user ? user.displayName || user.account : null;
  };

  const getParentName = (parentId: number | null) => {
    if (!parentId) return null;
    const parent = departments.find((d) => d.id === parentId);
    return parent ? parent.name : null;
  };

  if (loading) {
    return (
      <div className="dept-page__loading">
        <Loader2 className="dept-page__loading-icon" />
        <span>加载中...</span>
      </div>
    );
  }

  return (
    <div className="dept-page">
      <div className="dept-page__header">
        <div className="dept-page__header-left">
          <Building2 size={20} />
          <h2>部门管理</h2>
          <span className="dept-page__count">{departments.length} 个部门</span>
        </div>
        <button className="dept-page__add-btn" onClick={openCreate}>
          <Plus size={16} />
          新建部门
        </button>
      </div>

      <div className="dept-page__grid">
        {departments.length === 0 ? (
          <div className="dept-page__empty">暂无部门数据</div>
        ) : (
          departments.map((dept) => {
            const managerName = getManagerName(dept.managerId);
            const parentName = getParentName(dept.parentId);
            return (
              <div key={dept.id} className="dept-page__card">
                <div className="dept-page__card-body">
                  <div className="dept-page__card-icon">
                    <Building2 size={20} />
                  </div>
                  <div className="dept-page__card-info">
                    <h4 className="dept-page__card-name">{dept.name}</h4>
                    <div className="dept-page__card-meta">
                      {parentName && (
                        <span className="dept-page__meta-item">
                          <ChevronRight size={12} />
                          上级：{parentName}
                        </span>
                      )}
                      <span className="dept-page__meta-item">
                        <Users size={12} />
                        负责人：{managerName || '未设置'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="dept-page__card-footer">
                  <span className="dept-page__dept-id">ID: {dept.id}</span>
                  <div className="dept-page__card-actions">
                    <button className="dept-page__action-btn" onClick={() => openEdit(dept)}>
                      <Pencil size={14} />
                    </button>
                    <button
                      className="dept-page__action-btn dept-page__action-btn--danger"
                      onClick={() => setDeleteConfirm(dept)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showForm && (
        <div className="dept-page__modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="dept-page__modal" onClick={(e) => e.stopPropagation()}>
            <div className="dept-page__modal-header">
              <h3>{editing ? '编辑部门' : '新建部门'}</h3>
              <button className="dept-page__modal-close" onClick={() => setShowForm(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="dept-page__modal-body">
              <div className="dept-page__form-group">
                <label>部门名称</label>
                <input
                  type="text"
                  placeholder="如：技术部"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="dept-page__form-group">
                <label>上级部门</label>
                <Select
                  value={form.parentId != null ? String(form.parentId) : ''}
                  options={[
                    { value: '', label: '无（顶级部门）' },
                    ...departments
                      .filter((d) => d.id !== editing?.id)
                      .map((d) => ({ value: String(d.id), label: d.name })),
                  ]}
                  onChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      parentId: value ? Number(value) : null,
                    }))
                  }
                />
              </div>
              <div className="dept-page__form-group">
                <label>部门负责人</label>
                <Select
                  value={form.managerId != null ? String(form.managerId) : ''}
                  options={[
                    { value: '', label: '选择负责人' },
                    ...users.map((u) => ({
                      value: String(u.id),
                      label: `${u.displayName} (@${u.account})`,
                    })),
                  ]}
                  onChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      managerId: value ? Number(value) : null,
                    }))
                  }
                />
              </div>
            </div>
            <div className="dept-page__modal-footer">
              <button className="dept-page__modal-cancel" onClick={() => setShowForm(false)}>
                取消
              </button>
              <button className="dept-page__modal-save" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 size={14} className="dept-page__spin" />
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
        <div className="dept-page__modal-backdrop" onClick={() => setDeleteConfirm(null)}>
          <div className="dept-page__modal" onClick={(e) => e.stopPropagation()}>
            <div className="dept-page__modal-header">
              <h3>删除部门</h3>
              <button className="dept-page__modal-close" onClick={() => setDeleteConfirm(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="dept-page__modal-body">
              <p className="dept-page__delete-confirm-text">
                确定要删除部门 <strong>{deleteConfirm.name}</strong> 吗？此操作不可撤销。
              </p>
            </div>
            <div className="dept-page__modal-footer">
              <button className="dept-page__modal-cancel" onClick={() => setDeleteConfirm(null)}>
                取消
              </button>
              <button className="dept-page__modal-save dept-page__modal-save--danger" onClick={handleDelete}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}