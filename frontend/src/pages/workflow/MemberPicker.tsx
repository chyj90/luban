import { useState, useEffect, useRef } from 'react';
import type { Member, Department, Role } from '../../types/workflow';
import { orgApi } from '../../api/workflow';
import styles from './MemberPicker.module.css';

interface MemberPickerProps {
  value?: string[];
  onChange?: (selectedIds: string[]) => void;
  placeholder?: string;
  multiple?: boolean;
}

type TabType = 'members' | 'departments' | 'roles';

export default function MemberPicker({
  value = [],
  onChange,
  placeholder = '请选择人员',
  multiple = true,
}: MemberPickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabType>('members');
  const [members, setMembers] = useState<Member[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(value));
  const containerRef = useRef<HTMLDivElement>(null);
  const valueKey = value.join(',');

  useEffect(() => {
    setSelectedIds(new Set(value));
  }, [valueKey]);

  useEffect(() => {
    orgApi.getMembers({})
      .then(setMembers)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!open) return;
    orgApi.getMembers({ keyword: search || undefined })
      .then(setMembers)
      .catch(console.error);
  }, [open, search]);

  useEffect(() => {
    orgApi.getDepartmentTree()
      .then(setDepartments)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!open) return;
    orgApi.getDepartmentTree().then(setDepartments).catch(console.error);
  }, [open]);

  useEffect(() => {
    if (!open || tab !== 'roles') return;
    orgApi.getRoles(1).then(setRoles).catch(console.error);
  }, [open, tab]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      if (!multiple) next.clear();
      next.add(id);
    }
    const nextArray = Array.from(next);
    setSelectedIds(next);
    onChange?.(nextArray);
  };

  const handleTabChange = (newTab: TabType) => {
    if (newTab !== tab) {
      setTab(newTab);
      setSelectedIds(new Set());
      setSearch('');
      onChange?.([]);
    }
  };

  const selectedNames = Array.from(selectedIds)
    .map((id) => {
      const m = members.find((m) => String(m.id) === id);
      if (m) return m.name;
      const d = departments.find((d) => String(d.id) === id);
      if (d) return d.name;
      const r = roles.find((r) => String(r.id) === id);
      if (r) return r.name;
      return id;
    })
    .join(', ');

  const filteredMembers = members.filter(
    (m) => !search || m.name?.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredDepts = departments.filter(
    (d) => !search || d.name?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className={styles.picker} ref={containerRef}>
      <div
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
        onClick={() => setOpen(!open)}
      >
        {selectedNames || <span className={styles.placeholder}>{placeholder}</span>}
        <span className={styles.arrow}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${tab === 'members' ? styles.tabActive : ''}`}
              onClick={() => handleTabChange('members')}
            >
              人员
            </button>
            <button
              className={`${styles.tab} ${tab === 'departments' ? styles.tabActive : ''}`}
              onClick={() => handleTabChange('departments')}
            >
              部门
            </button>
            <button
              className={`${styles.tab} ${tab === 'roles' ? styles.tabActive : ''}`}
              onClick={() => handleTabChange('roles')}
            >
              角色
            </button>
          </div>

          <div className={styles.searchBox}>
            <input
              className={styles.searchInput}
              placeholder="搜索..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className={styles.list}>
            {tab === 'members' &&
              filteredMembers.map((member) => (
                <div
                  key={member.id}
                  className={`${styles.option} ${selectedIds.has(String(member.id)) ? styles.optionSelected : ''}`}
                  onClick={() => toggleSelect(String(member.id))}
                >
                  <span className={styles.checkbox}>
                    {selectedIds.has(String(member.id)) ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                    )}
                  </span>
                  <span className={styles.optionName}>{member.name}</span>
                  <span className={styles.optionMeta}>{member.email}</span>
                </div>
              ))}

            {tab === 'departments' &&
              filteredDepts.map((dept) => (
                <div
                  key={dept.id}
                  className={`${styles.option} ${selectedIds.has(String(dept.id)) ? styles.optionSelected : ''}`}
                  onClick={() => toggleSelect(String(dept.id))}
                >
                  <span className={styles.checkbox}>
                    {selectedIds.has(String(dept.id)) ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                    )}
                  </span>
                  <span className={styles.optionName}>{dept.name}</span>
                </div>
              ))}

            {tab === 'roles' &&
              roles.map((role) => (
                <div
                  key={role.id}
                  className={`${styles.option} ${selectedIds.has(String(role.id)) ? styles.optionSelected : ''}`}
                  onClick={() => toggleSelect(String(role.id))}
                >
                  <span className={styles.checkbox}>
                    {selectedIds.has(String(role.id)) ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                    )}
                  </span>
                  <span className={styles.optionName}>{role.name}</span>
                </div>
              ))}

            {((tab === 'members' && filteredMembers.length === 0) ||
              (tab === 'departments' && filteredDepts.length === 0) ||
              (tab === 'roles' && roles.length === 0)) && (
              <div className={styles.noResult}>暂无数据</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}