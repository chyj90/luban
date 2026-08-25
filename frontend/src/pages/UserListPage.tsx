import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Users, Shield, Building2, UserCog, X, Check, Loader2, UserPlus, Upload, Download, FileSpreadsheet, Mail, Phone, Briefcase, Hash } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import SearchBox from '@/components/SearchBox';
import Select from '@/components/Select';
import DataTable from '@/components/DataTable';
import type { Column } from '@/components/DataTable';
import type { User, Role, Department } from '@/types/user';
import { listUsers, updateUserRole, updateUserDepartment, listRoles, listDepartments, downloadUserTemplate, importUsers } from '@/api/user';
import { toast } from '@/stores/toastStore';
import './UserListPage.css';

export default function UserListPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState<string>('');

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
  };
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    email: string;
    mobile: string;
    position: string;
    employeeNo: string;
    roleIds: number[];
    deptId: number | null;
  }>({
    name: '',
    email: '',
    mobile: '',
    position: '',
    employeeNo: '',
    roleIds: [],
    deptId: null,
  });
  const [saving, setSaving] = useState(false);
  const [creatingIds, setCreatingIds] = useState<Set<number>>(new Set());
  const [createMenuOpen, setCreateMenuOpen] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; skipped: number; errors: string[] } | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async (p: number, ps: number, kw: string, af: string) => {
    setLoading(true);
    try {
      const usersRes = await listUsers({
        page: p,
        pageSize: ps,
        keyword: kw || undefined,
        accountFilter: af || undefined,
      });
      setUsers(usersRes.data.items);
      setTotal(usersRes.data.total);
      setTotalPages(usersRes.data.totalPages);
    } catch {
      setUsers([]);
      setTotal(0);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, []);

  const prevFilterRef = useRef(accountFilter);

  useEffect(() => {
    const filterChanged = prevFilterRef.current !== accountFilter;
    prevFilterRef.current = accountFilter;

    const p = filterChanged ? 1 : page;
    if (filterChanged) {
      setPage(1);
    }
    fetchData(p, pageSize, debouncedSearch, accountFilter);
  }, [page, pageSize, debouncedSearch, accountFilter, fetchData]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.user-list__create-wrap')) {
        setCreateMenuOpen(null);
      }
    };
    if (createMenuOpen !== null) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [createMenuOpen]);

  useEffect(() => {
    Promise.all([listRoles(), listDepartments()]).then(([rolesRes, deptsRes]) => {
      setRoles(rolesRes.data as Role[]);
      setDepartments(deptsRes.data as Department[]);
    });
  }, []);

  type DeptOption = { value: string; label: string; children: DeptOption[] };

  const deptTreeOptions = useMemo(() => {
    const build = (parentId: number | null): DeptOption[] => {
      const children = departments.filter((d) => (d.parentId ?? null) === parentId);
      return children.map((d) => ({
        value: String(d.id),
        label: d.name,
        children: build(d.id),
      }));
    };
    return build(null);
  }, [departments]);

  const handleCreateAccount = async (user: User, userType: 'normal' | 'test') => {
    setCreateMenuOpen(null);
    setCreatingIds((prev) => new Set(prev).add(user.id));
    try {
      await updateUserRole(user.id, userType === 'test' ? [flowTesterId!] : []);
      toast.success(userType === 'test' ? '测试账号创建成功' : '账号创建成功');
      await fetchData(page, pageSize, debouncedSearch, accountFilter);
    } catch {
      toast.error('账号创建失败');
    } finally {
      setCreatingIds((prev) => {
        const next = new Set(prev);
        next.delete(user.id);
        return next;
      });
    }
  };

  const openEdit = (user: User) => {
    setEditingUser(user);
    setEditForm({
      name: user.displayName || '',
      email: user.email || '',
      mobile: user.mobile || '',
      position: user.position || '',
      employeeNo: user.employeeNo || '',
      roleIds: user.roleIds ? user.roleIds.split(',').map(Number) : [],
      deptId: user.deptId ?? null,
    });
  };

  const handleSave = async () => {
    if (!editingUser) return;
    setSaving(true);
    try {
      if (editForm.deptId !== editingUser.deptId) {
        await updateUserDepartment(editingUser.id, editForm.deptId!);
      }
      const oldIds = editingUser.roleIds ? editingUser.roleIds.split(',').map(Number) : [];
      const newIds = editForm.roleIds.sort();
      const oldSorted = [...oldIds].sort();
      if (JSON.stringify(newIds) !== JSON.stringify(oldSorted)) {
        await updateUserRole(editingUser.id, newIds);
      }
      setEditingUser(null);
      toast.success('用户信息已更新');
      fetchData(page, pageSize, debouncedSearch, accountFilter);
    } catch {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const blob = await downloadUserTemplate();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '成员导入模板.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('模板下载成功');
    } catch {
      toast.error('模板下载失败');
    }
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    setImportResult(null);
    try {
      const res = await importUsers(file);
      setImportResult(res.data);
      if (res.data.success > 0) {
        toast.success(`导入成功 ${res.data.success} 条，跳过 ${res.data.skipped} 条`);
        fetchData(page, pageSize, debouncedSearch, accountFilter);
      }
      setImportModalOpen(false);
    } catch {
      toast.error('导入失败');
    } finally {
      setImporting(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleImport(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleImport(file);
    }
  };

  const openImportModal = () => {
    setImportResult(null);
    setImportModalOpen(true);
  };

  const closeImportModal = () => {
    if (!importing) {
      setImportModalOpen(false);
      setImportResult(null);
    }
  };

  const getRoleBadgeClass = (roleName: string | undefined) => {
    if (!roleName) return 'user-list__role-badge--default';
    if (roleName.includes('超级管理员')) return 'user-list__role-badge--super';
    if (roleName.includes('流程测试')) return 'user-list__role-badge--test';
    const map: Record<string, string> = {
      '系统管理员': 'user-list__role-badge--admin',
      '外部开发者': 'user-list__role-badge--dev',
      '普通用户': 'user-list__role-badge--user',
    };
    return map[roleName] || 'user-list__role-badge--default';
  };

  const columns: Column<User>[] = [
    {
      key: 'user',
      title: '成员',
      className: 'user-list__col--user',
      render: (user) => (
        <>
          <div className="user-list__avatar">
            {(user.displayName || user.email || '?').charAt(0).toUpperCase()}
          </div>
          <div className="user-list__user-info">
            <span className="user-list__user-name">{user.displayName}</span>
            {user.hasAccount && user.account && (
              <span className="user-list__user-account">@{user.account}</span>
            )}
          </div>
        </>
      ),
    },
    {
      key: 'status',
      title: '平台账号',
      className: 'user-list__col--status',
      render: (user) =>
        user.hasAccount ? (
          <span className="user-list__status-badge user-list__status-badge--active">已激活</span>
        ) : (
          <span className="user-list__status-badge user-list__status-badge--inactive">未激活</span>
        ),
    },
    {
      key: 'role',
      title: '角色',
      className: 'user-list__col--role',
      render: (user) =>
        user.hasAccount ? (
          <button
            className={`user-list__role-badge user-list__role-badge--clickable ${getRoleBadgeClass(user.roleName ?? undefined)}`}
            onClick={() => openEdit(user)}
            title="点击编辑角色"
          >
            {user.roleName || '未分配'}
          </button>
        ) : (
          <span className="user-list__role-badge user-list__role-badge--default">-</span>
        ),
    },
    {
      key: 'dept',
      title: '部门',
      className: 'user-list__col--dept',
      render: (user) => user.deptName || '-',
    },
    {
      key: 'email',
      title: '邮箱',
      className: 'user-list__col--email',
      render: (user) => user.email || '-',
    },
    {
      key: 'actions',
      title: '操作',
      className: 'user-list__col--actions',
      render: (user) => (
        <div className="user-list__actions">
          <button className="user-list__edit-btn" onClick={() => openEdit(user)}>
            <UserCog size={14} />
            编辑
          </button>
          {!user.hasAccount && (
            <div className="user-list__create-wrap">
              {createMenuOpen === user.id ? (
                <div className="user-list__create-menu">
                  <button
                    className="user-list__create-btn"
                    onClick={() => handleCreateAccount(user, 'normal')}
                    disabled={creatingIds.has(user.id)}
                  >
                    <UserPlus size={14} />
                    普通用户
                  </button>
                  <button
                    className="user-list__create-btn user-list__create-btn--test"
                    onClick={() => handleCreateAccount(user, 'test')}
                    disabled={creatingIds.has(user.id)}
                  >
                    <UserPlus size={14} />
                    测试用户
                  </button>
                </div>
              ) : (
                <button
                  className="user-list__create-btn"
                  onClick={() => setCreateMenuOpen(user.id)}
                  disabled={creatingIds.has(user.id)}
                >
                  {creatingIds.has(user.id) ? (
                    <>
                      <Loader2 size={14} className="user-list__spin" />
                      创建中...
                    </>
                  ) : (
                    <>
                      <UserPlus size={14} />
                      创建账号
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      ),
    },
  ];

  if (loading && users.length === 0 && !search) {
    return (
      <div className="user-list__loading">
        <Loader2 className="user-list__loading-icon" />
        <span>加载中...</span>
      </div>
    );
  }

  return (
    <div className="user-list">
      <PageTopbar
        icon={<Users size={22} />}
        title="用户管理"
        subtitle="管理平台用户，配置角色、部门和账号信息"
        actions={
          <div className="user-list__header-right">
            <div className="user-list__filter-label">用户类型</div>
            <div className="user-list__filter-select">
              <Select
                value={accountFilter}
                options={[
                  { value: '', label: '全部' },
                  { value: 'has', label: '注册用户' },
                  { value: 'none', label: '非注册用户' },
                ]}
                onChange={setAccountFilter}
                placeholder="全部"
                className="user-list__filter-select-compact"
              />
            </div>
            <SearchBox
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="搜索姓名、账号、邮箱..."
            />
            <button
              className="user-list__action-btn user-list__action-btn--primary"
              onClick={openImportModal}
            >
              <Upload size={14} />
              导入Excel
            </button>
          </div>
        }
      />

      {importResult && (
        <div className="user-list__import-result">
          <div className="user-list__import-summary">
            <span className="user-list__import-success">成功: {importResult.success}</span>
            <span className="user-list__import-skipped">跳过: {importResult.skipped}</span>
          </div>
          {importResult.errors.length > 0 && (
            <div className="user-list__import-errors">
              {importResult.errors.map((err, i) => (
                <div key={i}>{err}</div>
              ))}
            </div>
          )}
          <button className="user-list__import-close" onClick={() => setImportResult(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="user-list__table">
        <DataTable
          columns={columns}
          data={users}
          rowKey={(user) => user.id}
          loading={loading && users.length > 0}
          pagination={{
            page,
            pageSize,
            total,
            totalPages,
            onPageChange: setPage,
            onPageSizeChange: setPageSize,
          }}
        />
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
              <div className="user-list__modal-section">
                <h4 className="user-list__modal-section-title">基本信息</h4>
                <div className="user-list__form-group">
                  <label><Hash size={14} />姓名</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div className="user-list__form-group">
                  <label><Mail size={14} />邮箱</label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                  />
                </div>
                <div className="user-list__form-group">
                  <label><Phone size={14} />手机号</label>
                  <input
                    type="text"
                    value={editForm.mobile}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, mobile: e.target.value }))}
                  />
                </div>
                <div className="user-list__form-group">
                  <label><Briefcase size={14} />职位</label>
                  <input
                    type="text"
                    value={editForm.position}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, position: e.target.value }))}
                  />
                </div>
                <div className="user-list__form-group">
                  <label><Hash size={14} />工号</label>
                  <input
                    type="text"
                    value={editForm.employeeNo}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, employeeNo: e.target.value }))}
                  />
                </div>
                <div className="user-list__form-group">
                  <label><Building2 size={14} />部门</label>
                  <Select
                    value={editForm.deptId != null ? String(editForm.deptId) : ''}
                    options={deptTreeOptions}
                    onChange={(value) =>
                      setEditForm((prev) => ({ ...prev, deptId: value ? Number(value) : null }))
                    }
                  />
                </div>
              </div>
              {editingUser.hasAccount && (
                <div className="user-list__modal-section">
                  <h4 className="user-list__modal-section-title">角色与权限</h4>
                  <div className="user-list__form-group">
                    <label><Shield size={14} />角色</label>
                    {(() => {
                      const platformRoles = roles.filter(r => r.scope === 'PLATFORM');
                      return (
                        <div className="user-list__role-checkboxes">
                          {platformRoles.map((r) => {
                            const checked = editForm.roleIds.includes(r.id);
                            return (
                              <label
                                key={r.id}
                                className="user-list__role-checkbox"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setEditForm((prev) => {
                                      const next = checked
                                        ? prev.roleIds.filter(id => id !== r.id)
                                        : [...prev.roleIds, r.id];
                                      return { ...prev, roleIds: next };
                                    });
                                  }}
                                />
                                <span>{r.name}</span>
                                <span className="user-list__role-slug">({r.slug})</span>
                              </label>
                            );
                          })}
                          {wasFlowTester && (
                            <p className="user-list__role-hint">测试角色用户不可修改角色</p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
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
      {importModalOpen && (
        <div className="user-list__modal-overlay" onClick={closeImportModal}>
          <div className="user-list__import-modal" onClick={(e) => e.stopPropagation()}>
            <div className="user-list__import-modal-header">
              <h3>导入Excel</h3>
              <button className="user-list__import-modal-close" onClick={closeImportModal} disabled={importing}>
                <X size={18} />
              </button>
            </div>
            <div
              className={`user-list__import-dropzone ${dragOver ? 'user-list__import-dropzone--active' : ''} ${importing ? 'user-list__import-dropzone--loading' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !importing && fileInputRef.current?.click()}
            >
              {importing ? (
                <div className="user-list__import-dropzone-content">
                  <Loader2 size={36} className="user-list__spin" />
                  <span>正在导入...</span>
                </div>
              ) : (
                <div className="user-list__import-dropzone-content">
                  <FileSpreadsheet size={40} />
                  <span className="user-list__import-dropzone-title">拖拽Excel文件到此处</span>
                  <span className="user-list__import-dropzone-hint">或点击选择文件（支持 .xlsx、.xls）</span>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
            </div>
            <div className="user-list__import-modal-footer">
              <button className="user-list__import-download-btn" onClick={handleDownloadTemplate}>
                <Download size={14} />
                下载模板
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}