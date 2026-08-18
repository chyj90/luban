import { useState, useEffect, useCallback } from 'react';
import { Users, Search, Pencil, X, UserCog } from 'lucide-react';
import type { User, Department } from '@/types/user';
import { listUsers, updateUserDepartment, updateUserLeader, listDepartments } from '@/api/user';
import { useToastStore } from '@/stores/toastStore';
import './MemberListPage.css';

export default function MemberListPage() {
  const [members, setMembers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingMember, setEditingMember] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<{ deptId: number | null; leaderId: number | null }>({
    deptId: null,
    leaderId: null,
  });
  const [saving, setSaving] = useState(false);
  const toast = useToastStore((s) => s.add);

  const fetchData = useCallback(async () => {
    try {
      const [usersRes, deptsRes] = await Promise.all([listUsers(), listDepartments()]);
      setMembers(usersRes.data as User[]);
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

  const filteredMembers = members.filter((m) => {
    const q = search.toLowerCase();
    return (
      m.username.toLowerCase().includes(q) ||
      m.displayName.toLowerCase().includes(q) ||
      (m.email && m.email.toLowerCase().includes(q)) ||
      (m.deptName && m.deptName.toLowerCase().includes(q))
    );
  });

  const openEdit = (member: User) => {
    setEditingMember(member);
    setEditForm({
      deptId: member.deptId ?? null,
      leaderId: member.leaderId ?? null,
    });
  };

  const handleSave = async () => {
    if (!editingMember) return;
    setSaving(true);
    try {
      if (editForm.deptId !== null && editForm.deptId !== editingMember.deptId) {
        await updateUserDepartment(editingMember.id, editForm.deptId);
      }
      if (editForm.leaderId !== null && editForm.leaderId !== editingMember.leaderId) {
        await updateUserLeader(editingMember.id, editForm.leaderId);
      }
      setEditingMember(null);
      toast('成员信息已更新', 'success');
      fetchData();
    } catch {
      toast('保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const getLeaderName = (leaderId: number | null) => {
    if (!leaderId) return null;
    const leader = members.find((m) => m.id === leaderId);
    return leader ? leader.displayName || leader.username : null;
  };

  if (loading) {
    return (
      <div className="member-page__loading">
        <span>加载中...</span>
      </div>
    );
  }

  return (
    <div className="member-page">
      <div className="member-page__header">
        <div className="member-page__header-left">
          <Users size={20} />
          <h2>成员管理</h2>
          <span className="member-page__count">{filteredMembers.length} 人</span>
        </div>
        <div className="member-page__search">
          <Search size={16} />
          <input
            type="text"
            placeholder="搜索姓名、用户名、邮箱..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="member-page__table-wrap">
        <table className="member-page__table">
          <thead>
            <tr>
              <th>成员</th>
              <th>部门</th>
              <th>直属上级</th>
              <th>角色</th>
              <th>邮箱</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredMembers.length === 0 ? (
              <tr>
                <td colSpan={6} className="member-page__empty">暂无成员数据</td>
              </tr>
            ) : (
              filteredMembers.map((member) => {
                const leaderName = getLeaderName(member.leaderId);
                return (
                  <tr key={member.id}>
                    <td>
                      <div className="member-page__user-cell">
                        <div className="member-page__avatar">
                          {(member.displayName || member.username).charAt(0).toUpperCase()}
                        </div>
                        <div className="member-page__user-info">
                          <span className="member-page__user-name">{member.displayName}</span>
                          <span className="member-page__user-username">@{member.username}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="member-page__dept-badge">{member.deptName || '-'}</span>
                    </td>
                    <td>
                      <span className="member-page__leader">{leaderName || '-'}</span>
                    </td>
                    <td>
                      <span className="member-page__role-badge">{member.roleName || '-'}</span>
                    </td>
                    <td className="member-page__email">{member.email || '-'}</td>
                    <td>
                      <button className="member-page__edit-btn" onClick={() => openEdit(member)}>
                        <Pencil size={14} />
                        编辑
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {editingMember && (
        <div className="member-page__modal-backdrop" onClick={() => setEditingMember(null)}>
          <div className="member-page__modal" onClick={(e) => e.stopPropagation()}>
            <div className="member-page__modal-header">
              <h3>编辑成员 - {editingMember.displayName}</h3>
              <button className="member-page__modal-close" onClick={() => setEditingMember(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="member-page__modal-body">
              <div className="member-page__form-group">
                <label>部门</label>
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
              <div className="member-page__form-group">
                <label>
                  <UserCog size={14} />
                  直属上级
                </label>
                <select
                  value={editForm.leaderId ?? ''}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      leaderId: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                >
                  <option value="">-- 选择上级 --</option>
                  {members
                    .filter((m) => m.id !== editingMember.id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName || m.username}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="member-page__modal-footer">
              <button className="member-page__btn-cancel" onClick={() => setEditingMember(null)}>取消</button>
              <button className="member-page__btn-save" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}