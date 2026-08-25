import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Building2, Plus, Pencil, Trash2, X, Users, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import type { Department, User } from '@/types/user';
import { listDepartments, createDepartment, updateDepartment, deleteDepartment, listUsers, listDepartmentMembers } from '@/api/user';
import { useToastStore } from '@/stores/toastStore';
import { useConfirmStore } from '@/stores/confirmStore';
import Select from '@/components/Select';
import './OrgPage.css';

export default function OrgPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState({ name: '', managerId: null as number | null, parentId: null as number | null });
  const [saving, setSaving] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [deptMembers, setDeptMembers] = useState<Record<number, User[]>>({});
  const [loadingMembers, setLoadingMembers] = useState<Set<number>>(new Set());
  const fetchingMembersRef = useRef<Set<number>>(new Set());

  const [managerSearch, setManagerSearch] = useState('');
  const [managerOptions, setManagerOptions] = useState<User[]>([]);
  const [managerSearching, setManagerSearching] = useState(false);
  const [selectedManagerName, setSelectedManagerName] = useState('');
  const managerSearchRef = useRef<ReturnType<typeof setTimeout>>();

  const toast = useToastStore((s) => s.show);
  const confirm = useConfirmStore((s) => s.confirm);

  const fetchData = useCallback(async () => {
    try {
      const deptsRes = await listDepartments();
      setDepartments(deptsRes.data as Department[]);
    } catch {
      toast('加载数据失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  type DeptOption = { value: string; label: string; children: DeptOption[] };

  const deptTreeOptions = useMemo(() => {
    const build = (parentId: number | null): DeptOption[] => {
      const children = departments
        .filter((d) => (d.parentId ?? null) === parentId && d.id !== editing?.id);
      return children.map((d) => ({
        value: String(d.id),
        label: d.name,
        children: build(d.id),
      }));
    };
    return [{ value: '', label: '无（顶级部门）', children: build(null) }] as DeptOption[];
  }, [departments, editing]);

  const fetchMembers = useCallback(async (deptId: number) => {
    if (deptMembers[deptId] || fetchingMembersRef.current.has(deptId)) return;
    fetchingMembersRef.current.add(deptId);
    setLoadingMembers((prev) => new Set(prev).add(deptId));
    try {
      const res = await listDepartmentMembers(deptId);
      setDeptMembers((prev) => ({ ...prev, [deptId]: res.data as User[] }));
    } catch {
      toast('加载成员失败', 'error');
    } finally {
      fetchingMembersRef.current.delete(deptId);
      setLoadingMembers((prev) => {
        const next = new Set(prev);
        next.delete(deptId);
        return next;
      });
    }
  }, [deptMembers, toast]);

  const searchManagers = useCallback((keyword: string) => {
    if (managerSearchRef.current) clearTimeout(managerSearchRef.current);
    managerSearchRef.current = setTimeout(async () => {
      if (!keyword.trim()) {
        setManagerOptions([]);
        return;
      }
      setManagerSearching(true);
      try {
        const res = await listUsers({ keyword, pageSize: 10 });
        setManagerOptions(res.data.items as User[]);
      } catch {
        // ignore
      } finally {
        setManagerSearching(false);
      }
    }, 300);
  }, []);

  const openCreate = (parentId: number | null = null) => {
    setEditing(null);
    setForm({ name: '', managerId: null, parentId });
    setManagerSearch('');
    setManagerOptions([]);
    setSelectedManagerName('');
    setShowForm(true);
  };

  const openEdit = (dept: Department) => {
    setEditing(dept);
    setForm({ name: dept.name, managerId: dept.managerId, parentId: dept.parentId });
    setManagerSearch(dept.managerName || '');
    setManagerOptions([]);
    setSelectedManagerName(dept.managerName || '');
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
        toast('部门已更新', 'success');
      } else {
        await createDepartment(payload);
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

  const handleDelete = async (dept: Department) => {
    const confirmed = await confirm({
      title: '确认删除',
      message: `确定要删除部门「${dept.name}」吗？`,
    });
    if (confirmed) {
      try {
        await deleteDepartment(dept.id);
        toast('已删除', 'success');
        fetchData();
      } catch {
        toast('删除失败', 'error');
      }
    }
  };

  const getChildDepartments = (parentId: number | null) => {
    return departments.filter((d) => d.parentId === parentId);
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        fetchMembers(id);
      }
      return next;
    });
  };

  const expandAll = () => {
    const allIds = new Set<number>();
    const collect = (parentId: number | null) => {
      getChildDepartments(parentId).forEach((d) => {
        allIds.add(d.id);
        fetchMembers(d.id);
        collect(d.id);
      });
    };
    collect(null);
    setExpandedIds(allIds);
  };

  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  const renderMembers = (deptId: number) => {
    const members = deptMembers[deptId];
    if (loadingMembers.has(deptId)) {
      return (
        <div className="org-tree-members-loading">
          <Loader2 size={12} className="org-tree-members-loading-icon" />
          加载中...
        </div>
      );
    }
    if (!members || members.length === 0) {
      return <div className="org-tree-members-empty">暂无成员</div>;
    }
    return (
      <div className="org-tree-members">
        {members.map((m) => (
          <div key={m.id} className="org-tree-member">
            <div className="org-tree-member-avatar">
              {(m.displayName || '?').charAt(0).toUpperCase()}
            </div>
            <span className="org-tree-member-name">{m.displayName}</span>
            {m.position && <span className="org-tree-member-position">{m.position}</span>}
          </div>
        ))}
      </div>
    );
  };

  const renderDeptTree = (parentId: number | null, level: number) => {
    const children = getChildDepartments(parentId);
    if (children.length === 0) return null;

    return children.map((dept) => {
      const managerName = dept.managerName;
      const hasChildren = getChildDepartments(dept.id).length > 0;
      const isExpanded = expandedIds.has(dept.id);

      return (
        <div key={dept.id} className="org-tree-node">
          <div className="org-tree-row" style={{ paddingLeft: `${16 + level * 24}px` }}>
            <div className="org-tree-row-main">
              <button
                className="org-tree-expand-btn"
                onClick={() => toggleExpand(dept.id)}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <div className="org-tree-icon">
                <Building2 size={16} />
              </div>
              <div className="org-tree-info">
                <span className="org-tree-name">{dept.name}</span>
                <span className="org-tree-meta">
                  <Users size={11} />
                  {managerName || '未设置负责人'}
                  {hasChildren && (
                    <span className="org-tree-child-count">
                      · {getChildDepartments(dept.id).length} 个子部门
                    </span>
                  )}
                </span>
              </div>
            </div>
            <div className="org-tree-actions">
              <button className="org-tree-action-btn" onClick={() => openCreate(dept.id)} title="添加子部门">
                <Plus size={14} />
              </button>
              <button className="org-tree-action-btn" onClick={() => openEdit(dept)} title="编辑">
                <Pencil size={14} />
              </button>
              <button className="org-tree-action-btn org-tree-action-btn--danger" onClick={() => handleDelete(dept)} title="删除">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          {isExpanded && renderMembers(dept.id)}
          {hasChildren && isExpanded && renderDeptTree(dept.id, level + 1)}
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
      <PageTopbar
        icon={<Building2 size={22} />}
        title="组织架构"
        subtitle="管理部门层级结构，配置部门负责人和成员"
        actions={
          <button className="org-page__add-btn" onClick={() => openCreate(null)}>
            <Plus size={16} />
            新建部门
          </button>
        }
      />

      <div className="org-page__tree-card">
        <div className="org-page__tree-toolbar">
          <button
            className="org-page__tree-toggle"
            onClick={() => expandedIds.size > 0 ? collapseAll() : expandAll()}
          >
            {expandedIds.size > 0 ? '收起全部' : '展开全部'}
          </button>
        </div>
        <div className="org-page__tree">
          {departments.length === 0 ? (
            <div className="org-page__empty">暂无部门数据，点击「新建部门」开始</div>
          ) : (
            renderDeptTree(null, 0)
          )}
        </div>
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
                <Select
                  value={form.parentId != null ? String(form.parentId) : ''}
                  options={deptTreeOptions}
                  onChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      parentId: value ? Number(value) : null,
                    }))
                  }
                />
              </div>
              <div className="org-page__form-group">
                <label>部门负责人</label>
                <div className="org-page__manager-search">
                  <input
                    type="text"
                    className="org-page__manager-search-input"
                    placeholder="搜索姓名、账号..."
                    value={managerSearch}
                    onChange={(e) => {
                      setManagerSearch(e.target.value);
                      searchManagers(e.target.value);
                      if (!e.target.value) {
                        setForm((prev) => ({ ...prev, managerId: null }));
                      }
                    }}
                    onFocus={() => {
                      if (selectedManagerName && !managerSearch) {
                        setManagerSearch(selectedManagerName);
                      }
                    }}
                  />
                  {managerSearching && (
                    <Loader2 size={14} className="org-page__manager-search-spinner" />
                  )}
                  {managerOptions.length > 0 && (
                    <div className="org-page__manager-search-dropdown">
                      {managerOptions.map((u) => (
                        <div
                          key={u.id}
                          className="org-page__manager-search-option"
                          onClick={() => {
                            setForm((prev) => ({ ...prev, managerId: u.id }));
                            setSelectedManagerName(u.displayName || u.account || '');
                            setManagerSearch(u.displayName || u.account || '');
                            setManagerOptions([]);
                          }}
                        >
                          <span className="org-page__manager-search-name">
                            {u.displayName}
                          </span>
                          {u.account && (
                            <span className="org-page__manager-search-account">
                              @{u.account}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
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