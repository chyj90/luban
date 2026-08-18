import { useState, useEffect, useCallback } from 'react';
import { Building2, Plus, Pencil, Trash2, X, Users, ChevronRight, GitBranch } from 'lucide-react';
import type { Department, User } from '@/types/user';
import { listDepartments, createDepartment, updateDepartment, deleteDepartment, listUsers } from '@/api/user';
import { useToastStore } from '@/stores/toastStore';
import { useConfirmStore } from '@/stores/confirmStore';
import './OrgPage.css';

export default function OrgPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState({ name: '', managerId: null as number | null, parentId: null as number | null });
  const [saving, setSaving] = useState(false);
  const toast = useToastStore((s) => s.add);
  const confirm = useConfirmStore((s) => s.show);

  const fetchData = useCallback(async () => {
    try {
      const [deptsRes, usersRes] = await Promise.all([listDepartments(), listUsers()]);
      setDepartments(deptsRes.data as Department[]);
      setUsers(usersRes.data as User[]);
    } catch {
      toast('加载数据失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreate = (parentId: number | null = null) => {
    setEditing(null);
    setForm({ name: '', managerId: null, parentId });
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
      if (editing) {
        await updateDepartment(editing.id, form);
        toast('部门已更新', 'success');
      } else {
        await createDepartment(form);
        toast('部门已创建', 'success');
      }
      setShowForm(false);
      setEditing(null);
      fetchData();
    } catch {
      toast('保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (dept: Department) => {
    confirm({
      title: '确认删除',
      message: `确定要删除部门「${dept.name}」吗？`,
      onConfirm: async () => {
        try {
          await deleteDepartment(dept.id);
          toast('已删除', 'success');
          fetchData();
        } catch {
          toast('删除失败', 'error');
        }
      },
    });
  };

  const getManagerName = (managerId: number | null) => {
    if (!managerId) return null;
    const user = users.find((u) => u.id === managerId);
    return user ? user.displayName || user.username : null;
  };

  const getParentName = (parentId: number | null) => {
    if (!parentId) return null;
    const parent = departments.find((d) => d.id === parentId);
    return parent ? parent.name : null;
  };

  const getChildDepartments = (parentId: number | null) => {
    return departments.filter((d) => d.parentId === parentId);
  };

  const renderDeptTree = (parentId: number | null, level: number) => {
    const children = getChildDepartments(parentId);
    if (children.length === 0) return null;

    return children.map((dept) => {
      const managerName = getManagerName(dept.managerId);
      const grandChildren = getChildDepartments(dept.id);

      return (
        <div key={dept.id} className="org-tree-node">
          <div className="org-tree-row" style={{ paddingLeft: `${level * 24}px` }}>
            <div className="org-tree-row-main">
              {level > 0 && <GitBranch size={14} className="org-tree-branch" />}
              <div className="org-tree-icon">
                <Building2 size={16} />
              </div>
              <div className="org-tree-info">
                <span className="org-tree-name">{dept.name}</span>
                <span className="org-tree-meta">
                  <Users size={11} />
                  {managerName || '未设置负责人'}
                </span>
              </div>
            </div>
            <div className="org-tree-actions">
              {grandChildren.length === 0 && (
                <button className="org-tree-action-btn" onClick={() => openCreate(dept.id)} title="添加子部门">
                  <Plus size={14} />
                </button>
              )}
              <button className="org-tree-action-btn" onClick={() => openEdit(dept)} title="编辑">
                <Pencil size={14} />
              </button>
              <button className="org-tree-action-btn org-tree-action-btn--danger" onClick={() => handleDelete(dept)} title="删除">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          {renderDeptTree(dept.id, level + 1)}
        </div>
      );
    });
  };

  if (loading) {
    return (
      <div className="org-page__loading">
        <span>加载中...</span>
      </div>
    );
  }

  return (
    <div className="org-page">
      <div className="org-page__header">
        <div className="org-page__header-left">
          <Building2 size={20} />
          <h2>组织架构</h2>
          <span className="org-page__count">{departments.length} 个部门</span>
        </div>
        <button className="org-page__add-btn" onClick={() => openCreate(null)}>
          <Plus size={16} />
          新建部门
        </button>
      </div>

      <div className="org-page__tree">
        {departments.length === 0 ? (
          <div className="org-page__empty">暂无部门数据，点击「新建部门」开始</div>
        ) : (
          renderDeptTree(null, 0)
        )}
      </div>

      {showForm && (
        <div className="org-page__modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="org-page__modal" onClick={(e) => e.stopPropagation()}>
            <div className="org-page__modal-header">
              <h3>{editing ? '编辑部门' : '新建部门'}</h3>
              <button className="org-page__modal-close" onClick={() => setShowForm(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="org-page__modal-body">
              <div className="org-page__form-group">
                <label>部门名称</label>
                <input
                  type="text"
                  placeholder="如：技术部"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="org-page__form-group">
                <label>上级部门</label>
                <select
                  value={form.parentId ?? ''}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      parentId: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                >
                  <option value="">-- 无（顶级部门） --</option>
                  {departments
                    .filter((d) => d.id !== editing?.id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="org-page__form-group">
                <label>部门负责人</label>
                <select
                  value={form.managerId ?? ''}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      managerId: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                >
                  <option value="">-- 选择负责人 --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName || u.username}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="org-page__modal-footer">
              <button className="org-page__btn-cancel" onClick={() => setShowForm(false)}>取消</button>
              <button className="org-page__btn-save" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}