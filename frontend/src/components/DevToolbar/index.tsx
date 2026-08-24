import { useState, useEffect, useRef } from 'react';
import { workflowApi } from '@/api/workflow';
import { get } from '@/api/client';
import type { WorkflowDefinition } from '@/types/workflow';
import { useImpersonationStore } from '@/stores/impersonationStore';
import './DevToolbar.css';

interface DevToolbarProps {
  appId: number;
  onTestUserChange?: (userId: number | null) => void;
}

interface TestUser {
  id: number;
  name: string;
  email: string;
  departmentName?: string;
}

export function DevToolbar({ appId, onTestUserChange }: DevToolbarProps) {
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [users, setUsers] = useState<TestUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const bump = useImpersonationStore((s) => s.bump);

  useEffect(() => {
    workflowApi.listDefinitions({ applicationId: appId, status: 'DRAFT' }).then(defs => {
      setDefinitions(defs);
    });
    get<TestUser[]>(`/applications/${appId}/impersonatable-users`).then(res => {
      setUsers(res.data);
    }).catch(() => {});
  }, [appId]);

  useEffect(() => {
    const saved = localStorage.getItem(`impersonate_user_${appId}`)
      || localStorage.getItem('impersonate_user_id');
    if (saved) {
      setSelectedUserId(Number(saved));
      localStorage.setItem('impersonate_user_id', saved);
      localStorage.setItem('impersonate_app_id', String(appId));
    }
  }, [appId]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectUser = (userId: number) => {
    setSelectedUserId(userId);
    localStorage.setItem(`impersonate_user_${appId}`, String(userId));
    localStorage.setItem('impersonate_user_id', String(userId));
    localStorage.setItem('impersonate_app_id', String(appId));
    onTestUserChange?.(userId);
    setDropdownOpen(false);
    bump();
  };

  const handleClearUser = () => {
    setSelectedUserId(null);
    localStorage.removeItem(`impersonate_user_${appId}`);
    localStorage.removeItem('impersonate_user_id');
    localStorage.removeItem('impersonate_app_id');
    onTestUserChange?.(null);
    setDropdownOpen(false);
    bump();
  };

  const selectedUser = users.find(u => u.id === selectedUserId);

  const draftCount = definitions.filter(d => d.status === 'DRAFT').length;
  const publishedCount = definitions.filter(d => d.status === 'PUBLISHED').length;

  return (
    <div className="devtoolbar">
      <div className="devtoolbar-left">
        <span className="devtoolbar-label">开发模式</span>
        <span className="devtoolbar-stats">
          草稿 {draftCount} · 已发布 {publishedCount}
        </span>
      </div>

      <div className="devtoolbar-right">
        <div className="devtoolbar-impersonate" ref={dropdownRef}>
          <button
            className="devtoolbar-impersonate-btn"
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            {selectedUser ? (
              <>
                <span className="devtoolbar-impersonate-dot" />
                模拟: {selectedUser.name}
              </>
            ) : selectedUserId ? (
              <>
                <span className="devtoolbar-impersonate-dot" />
                模拟: ID {selectedUserId}
              </>
            ) : (
              '模拟用户'
            )}
          </button>
          {dropdownOpen && (
            <div className="devtoolbar-dropdown">
              <div className="devtoolbar-dropdown-header">选择测试用户</div>
              {selectedUserId && (
                <div className="devtoolbar-dropdown-item" onClick={handleClearUser}>
                  <span className="devtoolbar-dropdown-name">切换回自己</span>
                </div>
              )}
              {users.map(user => (
                <div
                  key={user.id}
                  className={`devtoolbar-dropdown-item ${selectedUserId === user.id ? 'active' : ''}`}
                  onClick={() => handleSelectUser(user.id)}
                >
                  <span className="devtoolbar-dropdown-name">{user.account}</span>
                  <span className="devtoolbar-dropdown-role">{user.departmentName || user.email}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}