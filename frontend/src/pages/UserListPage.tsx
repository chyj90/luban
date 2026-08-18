import { useState, useEffect, useCallback } from 'react';
import { Users, Search, Plus, Shield, Building2, UserCog, X, Check, Loader2 } from 'lucide-react';
import type { User, Role, Department } from '@/types/user';
import { listUsers, updateUserRole, updateUserDepartment, listRoles, listDepartments } from '@/api/user';
import './UserListPage.css';

export default function UserListPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<{ roleId: number | null; deptId: number | null }>({
    roleId: null,
    deptId: null,
  });
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [usersRes, rolesRes, deptsRes] = await Promise.all([
        listUsers(),
        listRoles(),
        listDepartments(),
      ]);
      setUsers(usersRes.data as User[]);
      setRoles(rolesRes.data as Role[]);
      setDepartments(deptsRes.data as Department[]);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredUsers = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      u.username.toLowerCase().includes(q) ||
      u.displayName.toLowerCase().includes(q) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.roleName && u.roleName.toLowerCase().includes(q)) ||
      (u.deptName && u.deptName.toLowerCase().includes(q))
    );
  });

  const openEdit = (user: User) => {
    setEditingUser(user);
    setEditForm({
      roleId: user.roleId ?? null,
      deptId: user.deptId ?? null,
    });
  };

  const handleSave = async () => {
    if (!editingUser) return;
    setSaving(true);
    try {
      if (editForm.roleId !== null && editForm.roleId !== editingUser.roleId) {
        await updateUserRole(editingUser.id, editForm.roleId);
      }
      if (editForm.deptId !== null && editForm.deptId !== editingUser.deptId) {
        await updateUserDepartment(editingUser.id, editForm.deptId);
      }
      setEditingUser(null);
      fetchData();
    } catch {
      setSaving(false);
    }
  };

  const getRoleBadgeClass = (roleName: string | undefined) => {
    if (!roleName) return 'user-list__role-badge--default';
    const map: Record<string, string> = {
      '超级管理员': 'user-list__role-badge--super',
      '系统管理员': 'user-list__role-badge--admin',
      '外部开发者': 'user-list__role-badge--dev',
      '普通用户': 'user-list__role-badge--user',
    };
    return map[roleName] || 'user-list__role-badge--default';
  };

  if (loading) {
    return (
      <div className="user-list__loading">
        <Loader2 className="user-list__loading-icon" />
        <span>加载中...</span>
      </div>
    );
  }

  return (
    <div className="user-list">
      <div className="user-list__header">
        <div className="user-list__header-left">
          <Users size={20} />
          <h2>用户列表</h2>
          <span className="user-list__count">{filteredUsers.length} 个用户</span>
        </div>
        <div className="user-list__header-right">
          <div className="user-list__search">
            <Search size={16} />
            <input
              type="text"
              placeholder="搜索用户名、角色、部门..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="user-list__table">
        <div className="user-list__table-header">
          <span className="user-list__col user-list__col--user">用户</span>
          <span className="user-list__col user-list__col--role">角色</span>
          <span className="user-list__col user-list__col--dept">部门</span>
          <span className="user-list__col user-list__col--email">邮箱</span>
          <span className="user-list__col user-list__col--actions">操作</span>
        </div>
        {filteredUsers.length === 0 ? (
          <div className="user-list__empty">暂无用户数据</div>
        ) : (
          filteredUsers.map((user) => (
            <div key={user.id} className="user-list__row">
              <span className="user-list__col user-list__col--user">
                <div className="user-list__avatar">
                  {(user.displayName || user.username).charAt(0).toUpperCase()}
                </div>
                <div className="user-list__user-info">
                  <span className="user-list__user-name">{user.displayName}</span>
                  <span className="user-list__user-username">@{user.username}</span>
                </div>
              </span>
              <span className="user-list__col user-list__col--role">
                <span className={`user-list__role-badge ${getRoleBadgeClass(user.roleName)}`}>
                  {user.roleName || '未分配'}
                </span>
              </span>
              <span className="user-list__col user-list__col--dept">
                {user.deptName || '-'}
              </span>
              <span className="user-list__col user-list__col--email">
                {user.email || '-'}
              </span>
              <span className="user-list__col user-list__col--actions">
                <button className="user-list__edit-btn" onClick={() => openEdit(user)}>
                  <UserCog size={14} />
                  编辑
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      {editingUser && (
        <div className="user-list__modal-backdrop" onClick={() => setEditingUser(null)}>
          <div className="user-list__modal" onClick={(e) => e.stopPropagation()}>
            <div className="user-list__modal-header">
              <h3>编辑用户 - {editingUser.displayName}</h3>
              <button className="user-list__modal-close" onClick={() => setEditingUser(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="user-list__modal-body">
              <div className="user-list__form-group">
                <label>
                  <Shield size={14} />
                  角色
                </label>
                <select
                  value={editForm.roleId ?? ''}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      roleId: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                >
                  <option value="">-- 选择角色 --</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.slug})
                    </option>
                  ))}
                </select>
              </div>
              <div className="user-list__form-group">
                <label>
                  <Building2 size={14} />
                  部门
                </label>
                <select
                  value={editForm.deptId ?? ''}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      deptId: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                >
                  <option value="">-- 选择部门 --</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="user-list__modal-footer">
              <button className="user-list__modal-cancel" onClick={() => setEditingUser(null)}>
                取消
              </button>
              <button className="user-list__modal-save" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 size={14} className="user-list__spin" />
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
    </div>
  );
}