import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Shield, Plus, Pencil, Trash2, X, Check, Loader2, Globe, Lock, Users, Search, Box, FileText, GitBranch, ChevronDown, ChevronRight } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import type { Role } from '@/types/user';
import type { Page } from '@/types/page';
import type { WorkflowDefinition } from '@/types/workflow';
import { listRoles, createRole, updateRole, deleteRole, getRolePermissions, updateRolePermissions, getRoleUsers, updateRoleUsers, listSimpleUsers, listPermissions } from '@/api/user';
import { listOntologyGroups, getRoleConceptPermissions, updateRoleConceptPermissions } from '@/api/concept';
import { listPages } from '@/api/page';
import { listApplications } from '@/api/application';
import { workflowApi } from '@/api/workflow';
import type { OntologyGroup } from '@/types/concept';
import type { Application } from '@/types/application';
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
  const [form, setForm] = useState({ name: '', slug: '', description: '', scope: 'PLATFORM', applicationId: undefined as number | undefined });
  const [applications, setApplications] = useState<Application[]>([]);
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
  const [appPermRole, setAppPermRole] = useState<Role | null>(null);
  const [appPermTab, setAppPermTab] = useState<'pages' | 'workflows'>('pages');
  const [appPermPages, setAppPermPages] = useState<Page[]>([]);
  const [appPermWorkflows, setAppPermWorkflows] = useState<WorkflowDefinition[]>([]);
  const [appPermPageIds, setAppPermPageIds] = useState<Set<number>>(new Set());
  const [appPermWorkflowIds, setAppPermWorkflowIds] = useState<Set<number>>(new Set());
  const [appPermLoading, setAppPermLoading] = useState(false);
  const [appPermSaving, setAppPermSaving] = useState(false);
  const toast = useToastStore((s) => s.show);
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.superAdmin === true;
  const currentUserId = user?.id;
  const [searchParams] = useSearchParams();
  const urlAppId = searchParams.get('appId');
  const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set());

  const appRoles = roles.filter((r) => r.scope !== 'PLATFORM');
  const appGroups = useMemo(() => {
    const map = new Map<string, { appId: string; appName: string; roles: Role[] }>();
    for (const r of appRoles) {
      const key = r.applicationId ? String(r.applicationId) : '__no_app__';
      if (!map.has(key)) {
        map.set(key, {
          appId: key,
          appName: r.applicationName || (key === '__no_app__' ? '未关联应用' : `应用 ${key}`),
          roles: [],
        });
      }
      map.get(key)!.roles.push(r);
    }
    return Array.from(map.values());
  }, [appRoles]);

  const toggleAppGroup = (appId: string) => {
    setExpandedApps((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) next.delete(appId);
      else next.add(appId);
      return next;
    });
  };

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

  useEffect(() => {
    if (urlAppId) {
      setExpandedApps(new Set([urlAppId]));
    }
  }, [urlAppId]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '',
      slug: '',
      description: '',
      scope: isSuperAdmin ? (urlAppId ? 'APPLICATION' : 'PLATFORM') : 'APPLICATION',
      applicationId: urlAppId ? Number(urlAppId) : undefined,
    });
    if (!isSuperAdmin || urlAppId) {
      loadApplications();
    }
    setShowForm(true);
  };

  const openEdit = (role: Role) => {
    setEditing(role);
    setForm({ name: role.name, slug: role.slug, description: role.description, scope: role.scope, applicationId: role.applicationId ?? undefined });
    if (role.scope === 'APPLICATION') {
      loadApplications();
    }
    setShowForm(true);
  };

  const loadApplications = () => {
    if (applications.length > 0) return;
    listApplications().then(res => setApplications(res.data as Application[])).catch(() => {});
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

  const openAppPermissions = async (role: Role) => {
    setAppPermRole(role);
    setAppPermTab('pages');
    setAppPermLoading(true);
    setError('');
    const appId = role.applicationId;
    if (!appId) {
      setAppPermLoading(false);
      setError('该角色未关联应用');
      return;
    }
    try {
      const [pagesRes, wfRes, permRes] = await Promise.all([
        listPages(appId),
        workflowApi.listDefinitions({ applicationId: appId, status: 'PUBLISHED' }),
        getRolePermissions(role.id),
      ]);
      const pages = (pagesRes.data as Page[]) || [];
      const workflows = (wfRes as WorkflowDefinition[]) || [];
      const perms = (permRes.data as string[]) || [];
      setAppPermPages(pages);
      setAppPermWorkflows(workflows);
      setAppPermPageIds(new Set(pages.filter(p => perms.includes(`app:page:${p.id}`)).map(p => p.id)));
      setAppPermWorkflowIds(new Set(workflows.filter(w => perms.includes(`app:workflow:${w.id}`)).map(w => w.id)));
    } catch {
      setAppPermPages([]);
      setAppPermWorkflows([]);
      setAppPermPageIds(new Set());
      setAppPermWorkflowIds(new Set());
    } finally {
      setAppPermLoading(false);
    }
  };

  const toggleAppPage = (pageId: number) => {
    setAppPermPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  };

  const toggleAppWorkflow = (wfId: number) => {
    setAppPermWorkflowIds((prev) => {
      const next = new Set(prev);
      if (next.has(wfId)) next.delete(wfId);
      else next.add(wfId);
      return next;
    });
  };

  const handleSaveAppPermissions = async () => {
    if (!appPermRole) return;
    setAppPermSaving(true);
    setError('');
    try {
      const allPerms: string[] = [
        ...Array.from(appPermPageIds).map(id => `app:page:${id}`),
        ...Array.from(appPermWorkflowIds).map(id => `app:workflow:${id}`),
      ];
      await updateRolePermissions(appPermRole.id, allPerms);
      setAppPermRole(null);
      toast('权限已保存', 'success');
    } catch {
      setError('保存权限失败，请重试');
    } finally {
      setAppPermSaving(false);
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
          {role.scope === 'APPLICATION' && (
            <button className="role-page__action-btn" onClick={() => openAppPermissions(role)}>
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
          {canEditRole(role) && role.slug !== 'super_admin' && (
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
          {appRoles.length > 0 && appGroups.map((group) => {
            const isExpanded = expandedApps.has(group.appId) || expandedApps.size === 0;
            return (
              <div key={group.appId} className="role-page__section">
                <div
                  className="role-page__section-header role-page__section-header--collapsible"
                  onClick={() => toggleAppGroup(group.appId)}
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span>{group.appName}</span>
                  <span className="role-page__section-count">{group.roles.length}</span>
                </div>
                {isExpanded && (
                  <div className="role-page__grid">
                    {group.roles.map(renderRoleCard)}
                  </div>
                )}
              </div>
            );
          })}
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
                    onChange={(value) => {
                      setForm((prev) => ({ ...prev, scope: value, applicationId: value === 'PLATFORM' ? undefined : prev.applicationId }));
                      if (value === 'APPLICATION') loadApplications();
                    }}
                  />
                ) : (
                  <div className="role-page__scope-disabled">
                    <Globe size={14} />
                    <span>{SCOPE_LABELS[form.scope] || form.scope}</span>
                  </div>
                )}
              </div>
              {form.scope === 'APPLICATION' && (
                <div className="role-page__form-group">
                  <label>关联应用</label>
                  <Select
                    value={form.applicationId ? String(form.applicationId) : ''}
                    options={applications.map(app => ({ value: String(app.id), label: app.name }))}
                    onChange={(value) => setForm((prev) => ({ ...prev, applicationId: value ? Number(value) : undefined }))}
                    placeholder="选择应用"
                  />
                </div>
              )}
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

      {appPermRole && (
        <div className="role-page__modal-backdrop" onClick={() => setAppPermRole(null)}>
          <div className="role-page__modal role-page__modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="role-page__modal-header">
              <h3>权限配置 — {appPermRole.name}</h3>
              <button className="role-page__modal-close" onClick={() => setAppPermRole(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="role-page__modal-body">
              {error && <div className="role-page__error">{error}</div>}
              <div className="role-page__app-perm-tabs">
                <button
                  className={`role-page__app-perm-tab ${appPermTab === 'pages' ? 'active' : ''}`}
                  onClick={() => setAppPermTab('pages')}
                >
                  <FileText size={14} />
                  页面权限
                </button>
                <button
                  className={`role-page__app-perm-tab ${appPermTab === 'workflows' ? 'active' : ''}`}
                  onClick={() => setAppPermTab('workflows')}
                >
                  <GitBranch size={14} />
                  流程发起权限
                </button>
              </div>
              {appPermLoading ? (
                <div className="role-page__loading" style={{ padding: '32px 0' }}>
                  <Loader2 className="role-page__loading-icon" />
                  <span>加载中...</span>
                </div>
              ) : appPermTab === 'pages' ? (
                <>
                  <div className="role-page__perm-list">
                    {appPermPages.length === 0 ? (
                      <div className="role-page__empty">该应用暂无页面</div>
                    ) : (
                      appPermPages.map((p) => (
                        <label key={p.id} className="role-page__perm-item">
                          <input
                            type="checkbox"
                            checked={appPermPageIds.has(p.id)}
                            onChange={() => toggleAppPage(p.id)}
                          />
                          <span className="role-page__perm-item-body">
                            <span className="role-page__perm-item-label">{p.name}</span>
                            <span className="role-page__perm-item-desc">
                              {p.isDefault ? '默认页面' : ''}
                            </span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                  {appPermPages.length > 0 && (
                    <div className="role-page__app-perm-actions">
                      <button
                        className="role-page__app-perm-action-btn"
                        onClick={() => setAppPermPageIds(new Set(appPermPages.map((p) => p.id)))}
                      >
                        全选
                      </button>
                      <button
                        className="role-page__app-perm-action-btn"
                        onClick={() => setAppPermPageIds(new Set())}
                      >
                        全不选
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="role-page__perm-list">
                    {appPermWorkflows.length === 0 ? (
                      <div className="role-page__empty">该应用暂无已发布流程</div>
                    ) : (
                      appPermWorkflows.map((w) => (
                        <label key={w.id} className="role-page__perm-item">
                          <input
                            type="checkbox"
                            checked={appPermWorkflowIds.has(w.id)}
                            onChange={() => toggleAppWorkflow(w.id)}
                          />
                          <span className="role-page__perm-item-body">
                            <span className="role-page__perm-item-label">{w.name}</span>
                            <span className="role-page__perm-item-desc">{w.description}</span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                  {appPermWorkflows.length > 0 && (
                    <div className="role-page__app-perm-actions">
                      <button
                        className="role-page__app-perm-action-btn"
                        onClick={() => setAppPermWorkflowIds(new Set(appPermWorkflows.map((w) => w.id)))}
                      >
                        全选
                      </button>
                      <button
                        className="role-page__app-perm-action-btn"
                        onClick={() => setAppPermWorkflowIds(new Set())}
                      >
                        全不选
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="role-page__modal-footer">
              <button className="role-page__modal-cancel" onClick={() => setAppPermRole(null)}>
                取消
              </button>
              <button className="role-page__modal-save" onClick={handleSaveAppPermissions} disabled={appPermSaving}>
                {appPermSaving ? (
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