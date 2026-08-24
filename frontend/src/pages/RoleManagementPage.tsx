import { useState, useEffect, useCallback } from 'react';
import { Shield, Plus, Pencil, Trash2, X, Check, Loader2, Globe, Lock, Users, Search, Box } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import type { Role } from '@/types/user';
import { listRoles, createRole, updateRole, deleteRole, getRolePermissions, updateRolePermissions, getRoleUsers, updateRoleUsers, listSimpleUsers, listPermissions } from '@/api/user';
import { listOntologyGroups, getRoleConceptPermissions, updateRoleConceptPermissions } from '@/api/concept';
import type { OntologyGroup } from '@/types/concept';
import { useToastStore } from '@/stores/toastStore';
import { useAuthStore } from '@/stores/authStore';
import Select from '@/components/Select';
import type { PermissionDef } from '@/config/permissions';
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
  const [permRole, setPermRole] = useState<Role | null>(null);
  const [permIds, setPermIds] = useState<Set<string>>(new Set());
  const [permSaving, setPermSaving] = useState(false);
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [userIds, setUserIds] = useState<Set<number>>(new Set());
  const [allUsers, setAllUsers] = useState<{ id: number; account: string; email: string }[]>([]);
  const [userPage, setUserPage] = useState(1);
  const [userTotalPages, setUserTotalPages] = useState(1);
  const [userSearch, setUserSearch] = useState('');
  const [userSaving, setUserSaving] = useState(false);
  const [allPermissions, setAllPermissions] = useState<PermissionDef[]>([]);
  const [error, setError] = useState('');
  const [conceptPermRole, setConceptPermRole] = useState<Role | null>(null);
  const [conceptGroups, setConceptGroups] = useState<OntologyGroup[]>([]);
  const [conceptPermGroupIds, setConceptPermGroupIds] = useState<Set<number>>(new Set());
  const [conceptPermSaving, setConceptPermSaving] = useState(false);
  const toast = useToastStore((s) => s.show);
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.superAdmin === true;
  const currentUserId = user?.id;

  const canEditRole = (role: Role) => {
    if (role.scope === 'PLATFORM') return isSuperAdmin;
    return isSuperAdmin || role.createdBy === currentUserId;
  };

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

  useEffect(() => {
    listPermissions()
      .then((res) => setAllPermissions(res.data as PermissionDef[]))
      .catch(() => {});
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', slug: '', description: '', scope: isSuperAdmin ? 'PLATFORM' : 'APPLICATION' });
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
    setError('');
    try {
      if (editing) {
        await updateRole(editing.id, form);
      } else {
        await createRole(form);
      }
      setShowForm(false);
      setEditing(null);
      toast(editing ? '角色已更新' : '角色已创建', 'success');
      fetchRoles();
    } catch {
      setError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteRole(deleteConfirm.id);
      setDeleteConfirm(null);
      toast('角色已删除', 'success');
      fetchRoles();
    } catch {
      // ignore
    }
  };

  const openPermissions = async (role: Role) => {
    setPermRole(role);
    try {
      const res = await getRolePermissions(role.id);
      setPermIds(new Set(res.data as string[]));
    } catch {
      setPermIds(new Set());
    }
  };

  const togglePerm = (key: string) => {
    setPermIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSavePermissions = async () => {
    if (!permRole) return;
    setPermSaving(true);
    setError('');
    try {
      await updateRolePermissions(permRole.id, Array.from(permIds));
      setPermRole(null);
      toast('权限已保存', 'success');
      fetchRoles();
    } catch {
      setError('保存权限失败，请重试');
    } finally {
      setPermSaving(false);
    }
  };

  const openConceptPermissions = async (role: Role) => {
    setConceptPermRole(role);
    setError('');
    try {
      const [groupsRes, permRes] = await Promise.all([
        listOntologyGroups(),
        getRoleConceptPermissions(role.id),
      ]);
      setConceptGroups(groupsRes.data as OntologyGroup[]);
      const groupIds = new Set((permRes.data.groups || []).map((g: { groupId: number }) => g.groupId));
      setConceptPermGroupIds(groupIds);
    } catch {
      setConceptGroups([]);
      setConceptPermGroupIds(new Set());
    }
  };

  const toggleConceptGroup = (groupId: number) => {
    setConceptPermGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleSaveConceptPermissions = async () => {
    if (!conceptPermRole) return;
    setConceptPermSaving(true);
    setError('');
    try {
      await updateRoleConceptPermissions(conceptPermRole.id, Array.from(conceptPermGroupIds));
      setConceptPermRole(null);
      toast('概念权限已保存', 'success');
    } catch {
      setError('保存概念权限失败，请重试');
    } finally {
      setConceptPermSaving(false);
    }
  };

  const openUsers = async (role: Role) => {
    setUserRole(role);
    setUserSearch('');
    setUserPage(1);
    try {
      const [usersRes, roleUsersRes] = await Promise.all([
        listSimpleUsers(undefined, 1),
        getRoleUsers(role.id),
      ]);
      const pageData = usersRes.data as { items: { id: number; account: string; email: string }[]; totalPages: number };
      setAllUsers(pageData.items);
      setUserTotalPages(pageData.totalPages);
      setUserIds(new Set((roleUsersRes.data as number[]) || []));
    } catch {
      setAllUsers([]);
      setUserIds(new Set());
    }
  };

  const searchUsers = async (keyword: string) => {
    setUserSearch(keyword);
    setUserPage(1);
    try {
      const res = await listSimpleUsers(keyword || undefined, 1);
      const pageData = res.data as { items: { id: number; account: string; email: string }[]; totalPages: number };
      setAllUsers(pageData.items);
      setUserTotalPages(pageData.totalPages);
    } catch {
      setAllUsers([]);
    }
  };

  const loadUserPage = async (p: number) => {
    setUserPage(p);
    try {
      const res = await listSimpleUsers(userSearch || undefined, p);
      const pageData = res.data as { items: { id: number; account: string; email: string }[]; totalPages: number };
      setAllUsers(pageData.items);
      setUserTotalPages(pageData.totalPages);
    } catch {
      setAllUsers([]);
    }
  };

  const toggleUser = (id: number) => {
    setUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSaveUsers = async () => {
    if (!userRole) return;
    setUserSaving(true);
    setError('');
    try {
      await updateRoleUsers(userRole.id, Array.from(userIds));
      setUserRole(null);
      toast('用户已保存', 'success');
    } catch {
      setError('保存用户失败，请重试');
    } finally {
      setUserSaving(false);
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

  const platformRoles = roles.filter((r) => r.scope === 'PLATFORM');
  const appRoles = roles.filter((r) => r.scope !== 'PLATFORM');

  const renderRoleCard = (role: Role) => (
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
          <button className="role-page__action-btn" onClick={() => openUsers(role)}>
            <Users size={14} />
          </button>
          {role.scope === 'PLATFORM' && (
            <button className="role-page__action-btn" onClick={() => openPermissions(role)}>
              <Lock size={14} />
            </button>
          )}
          {role.scope === 'PLATFORM' && (
            <button className="role-page__action-btn" onClick={() => openConceptPermissions(role)}>
              <Box size={14} />
            </button>
          )}
          {canEditRole(role) && (
          <button className="role-page__action-btn" onClick={() => openEdit(role)}>
            <Pencil size={14} />
          </button>
          )}
          {canEditRole(role) && role.slug !== 'super_admin' && role.slug !== 'flow_tester' && (
            <button
              className="role-page__action-btn role-page__action-btn--danger"
              onClick={() => setDeleteConfirm(role)}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="role-page">
      <PageTopbar
        icon={<Shield size={22} />}
        title="平台角色"
        subtitle="管理平台角色与权限配置，控制用户对功能和数据的访问范围"
        actions={
          <button className="role-page__add-btn" onClick={openCreate}>
            <Plus size={16} />
            新建角色
          </button>
        }
      />

      <div className="role-page__content">
      {roles.length === 0 ? (
        <div className="role-page__empty">暂无角色数据</div>
      ) : (
        <>
          {platformRoles.length > 0 && (
            <div className="role-page__section">
              <div className="role-page__section-header">
                <Globe size={16} />
                <span>平台角色</span>
                <span className="role-page__section-count">{platformRoles.length}</span>
              </div>
              <div className="role-page__grid">
                {platformRoles.map(renderRoleCard)}
              </div>
            </div>
          )}
          {appRoles.length > 0 && (
            <div className="role-page__section">
              <div className="role-page__section-header">
                <Globe size={16} />
                <span>应用角色</span>
                <span className="role-page__section-count">{appRoles.length}</span>
              </div>
              <div className="role-page__grid">
                {appRoles.map(renderRoleCard)}
              </div>
            </div>
          )}
        </>
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
              {error && <div className="role-page__error">{error}</div>}
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
                {isSuperAdmin ? (
                  <Select
                    value={form.scope}
                    options={[
                      { value: 'PLATFORM', label: '平台级', desc: '所有应用共享' },
                      { value: 'APPLICATION', label: '应用级', desc: '仅限指定应用' },
                    ]}
                    onChange={(value) => setForm((prev) => ({ ...prev, scope: value }))}
                  />
                ) : (
                  <div className="role-page__scope-disabled">
                    <Globe size={14} />
                    <span>{SCOPE_LABELS[form.scope] || form.scope}</span>
                  </div>
                )}
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

      {permRole && (
        <div className="role-page__modal-backdrop" onClick={() => setPermRole(null)}>
          <div className="role-page__modal" onClick={(e) => e.stopPropagation()}>
            <div className="role-page__modal-header">
              <h3>权限配置 — {permRole.name}</h3>
              <button className="role-page__modal-close" onClick={() => setPermRole(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="role-page__modal-body">
              {error && <div className="role-page__error">{error}</div>}
              <div className="role-page__perm-list">
                {(() => {
                  let lastSection = '';
                  return allPermissions.map((perm) => {
                    const showSection = perm.section !== lastSection;
                    lastSection = perm.section;
                    return (
                      <div key={perm.key}>
                        {showSection && (
                          <div className="role-page__perm-section">{perm.section}</div>
                        )}
                        <label className="role-page__perm-item">
                          <input
                            type="checkbox"
                            checked={permIds.has(perm.key)}
                            onChange={() => togglePerm(perm.key)}
                          />
                          <span className="role-page__perm-item-body">
                            <span className="role-page__perm-item-label">{perm.label}</span>
                            <span className="role-page__perm-item-desc">{perm.desc}</span>
                          </span>
                        </label>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
            <div className="role-page__modal-footer">
              <button className="role-page__modal-cancel" onClick={() => setPermRole(null)}>
                取消
              </button>
              <button className="role-page__modal-save" onClick={handleSavePermissions} disabled={permSaving}>
                {permSaving ? (
                  <>
                    <Loader2 size={14} className="role-page__spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    保存权限
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {userRole && (
        <div className="role-page__modal-backdrop" onClick={() => setUserRole(null)}>
          <div className="role-page__modal" onClick={(e) => e.stopPropagation()}>
            <div className="role-page__modal-header">
              <h3>分配用户 — {userRole.name}</h3>
              <button className="role-page__modal-close" onClick={() => setUserRole(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="role-page__modal-body">
              {error && <div className="role-page__error">{error}</div>}
              <div className="role-page__user-search">
                <Search size={14} className="role-page__user-search-icon" />
                <input
                  type="text"
                  className="role-page__user-search-input"
                  placeholder="搜索账号或邮箱..."
                  value={userSearch}
                  onChange={(e) => searchUsers(e.target.value)}
                />
              </div>
              <div className="role-page__user-toolbar">
                <span className="role-page__user-count">已选 {userIds.size} 人</span>
                <button
                  className="role-page__user-toggle-all"
                  onClick={() => {
                    const allIds = new Set(allUsers.map((u) => u.id));
                    if (allUsers.every((u) => userIds.has(u.id))) {
                      setUserIds(new Set());
                    } else {
                      setUserIds(allIds);
                    }
                  }}
                >
                  {allUsers.length > 0 && allUsers.every((u) => userIds.has(u.id))
                    ? '取消全选'
                    : '全选'}
                </button>
              </div>
              <div className="role-page__perm-list">
                {allUsers.length === 0 ? (
                  <div className="role-page__empty">暂无匹配用户</div>
                ) : (
                  allUsers.map((u) => (
                    <label key={u.id} className="role-page__perm-item">
                      <input
                        type="checkbox"
                        checked={userIds.has(u.id)}
                        onChange={() => toggleUser(u.id)}
                      />
                      <span className="role-page__perm-item-body">
                        <span className="role-page__perm-item-label">{u.account}</span>
                        <span className="role-page__perm-item-desc">{u.email}</span>
                      </span>
                    </label>
                  ))
                )}
              </div>
              {userTotalPages > 1 && (
                <div className="role-page__user-pagination">
                  <button
                    className="role-page__user-pagination-btn"
                    disabled={userPage <= 1}
                    onClick={() => loadUserPage(userPage - 1)}
                  >
                    上一页
                  </button>
                  <span className="role-page__user-pagination-info">
                    {userPage} / {userTotalPages}
                  </span>
                  <button
                    className="role-page__user-pagination-btn"
                    disabled={userPage >= userTotalPages}
                    onClick={() => loadUserPage(userPage + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}
            </div>
            <div className="role-page__modal-footer">
              <button className="role-page__modal-cancel" onClick={() => setUserRole(null)}>
                取消
              </button>
              <button className="role-page__modal-save" onClick={handleSaveUsers} disabled={userSaving}>
                {userSaving ? (
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

      {conceptPermRole && (
        <div className="role-page__modal-backdrop" onClick={() => setConceptPermRole(null)}>
          <div className="role-page__modal" onClick={(e) => e.stopPropagation()}>
            <div className="role-page__modal-header">
              <h3>概念域权限 — {conceptPermRole.name}</h3>
              <button className="role-page__modal-close" onClick={() => setConceptPermRole(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="role-page__modal-body">
              {error && <div className="role-page__error">{error}</div>}
              <p className="role-page__modal-desc">选择该角色可访问的概念域</p>
              <div className="role-page__perm-list">
                {conceptGroups.length === 0 ? (
                  <div className="role-page__empty">暂无概念域</div>
                ) : (
                  conceptGroups.map((g) => (
                    <label key={g.id} className="role-page__perm-item">
                      <input
                        type="checkbox"
                        checked={conceptPermGroupIds.has(g.id)}
                        onChange={() => toggleConceptGroup(g.id)}
                      />
                      <span className="role-page__perm-item-body">
                        <span className="role-page__perm-item-label">{g.displayName}</span>
                        <span className="role-page__perm-item-desc">{g.description || g.name}</span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="role-page__modal-footer">
              <button className="role-page__modal-cancel" onClick={() => setConceptPermRole(null)}>
                取消
              </button>
              <button className="role-page__modal-save" onClick={handleSaveConceptPermissions} disabled={conceptPermSaving}>
                {conceptPermSaving ? (
                  <>
                    <Loader2 size={14} className="role-page__spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Check size={14} />
                    保存权限
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