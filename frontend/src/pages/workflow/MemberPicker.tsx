import { useState, useEffect, useRef } from 'react';
import type { User } from '../../types/user';
import { orgApi } from '../../api/workflow';
import styles from './MemberPicker.module.css';

interface MemberPickerProps {
  value?: string[];
  onChange?: (selectedIds: string[]) => void;
  placeholder?: string;
  multiple?: boolean;
}

export default function MemberPicker({
  value = [],
  onChange,
  placeholder = '请选择人员',
  multiple = true,
}: MemberPickerProps) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set((value || []).map(String)));
  const containerRef = useRef<HTMLDivElement>(null);
  const valueKey = (value || []).map(String).join(',');

  useEffect(() => {
    setSelectedIds(new Set((value || []).map(String)));
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
      const m = members.find((m) => String(m.id) === id);
      return m ? m.displayName : id;
    })
    .join(', ');

  const filteredMembers = members.filter(
    (m) => !search || m.displayName?.toLowerCase().includes(search.toLowerCase()),
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
            {filteredMembers.map((member) => (
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
                <span className={styles.optionName}>{member.displayName}</span>
                <span className={styles.optionMeta}>{member.email}</span>
              </div>
            ))}

            {filteredMembers.length === 0 && (
              <div className={styles.noResult}>暂无数据</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}