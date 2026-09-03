import { useState, useEffect, useRef } from 'react';
import type { Role } from '../../types/user';
import { listRoles } from '../../api/user';
import styles from './MemberPicker.module.css';

interface RolePickerProps {
  value?: string[];
  onChange?: (selectedIds: string[]) => void;
  placeholder?: string;
  multiple?: boolean;
  appId?: number;
}

export default function RolePicker({
  value = [],
  onChange,
  placeholder = '请选择角色',
  multiple = true,
  appId,
}: RolePickerProps) {
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set((value || []).map(String)));
  const containerRef = useRef<HTMLDivElement>(null);
  const valueKey = (value || []).map(String).join(',');

  useEffect(() => {
    setSelectedIds(new Set((value || []).map(String)));
  }, [valueKey]);

  useEffect(() => {
    listRoles()
      .then((res) => setRoles(res.data || []))
      .catch(console.error);
  }, []);

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

  const selectedNames = Array.from(selectedIds)
    .map((id) => {
      const r = roles.find((r) => String(r.id) === id);
      return r ? r.name : id;
    })
    .join(', ');

  const filteredRoles = roles.filter(
    (r) => {
      if (appId != null) {
        if (r.scope !== 'APPLICATION' || r.applicationId !== appId) return false;
      }
      return !search || r.name?.toLowerCase().includes(search.toLowerCase());
    },
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
          <div className={styles.searchBox}>
            <input
              className={styles.searchInput}
              placeholder="搜索..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className={styles.list}>
            {filteredRoles.map((role) => (
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
                <span className={styles.optionMeta}>{role.description}</span>
              </div>
            ))}

            {filteredRoles.length === 0 && (
              <div className={styles.noResult}>暂无数据</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}