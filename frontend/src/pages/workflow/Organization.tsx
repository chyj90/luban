import { useState, useEffect } from 'react';
import type { Department, Member } from '../../types/workflow';
import { orgApi } from '../../api/workflow';
import OrganizationTree from './OrganizationTree';
import styles from './Organization.module.css';

interface OrganizationProps {
  embedded?: boolean;
}

export default function Organization({ embedded }: OrganizationProps = {}) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [memberLoading, setMemberLoading] = useState(false);

  useEffect(() => {
    orgApi.getDepartmentTree()
      .then(setDepartments)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedDept) return;
    setMemberLoading(true);
    orgApi.getDepartmentMembers(selectedDept.id)
      .then(setMembers)
      .catch(console.error)
      .finally(() => setMemberLoading(false));
  }, [selectedDept]);

  if (loading) {
    return <div className={styles.loading}>加载中...</div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>组织管理</h1>
        <p className={styles.subtitle}>查看组织架构与人员信息</p>
      </div>

      <div className={styles.body}>
        <div className={styles.treePanel}>
          <div className={styles.panelTitle}>部门架构</div>
          <OrganizationTree
            departments={departments}
            selectedId={selectedDept?.id}
            onSelect={setSelectedDept}
          />
        </div>

        <div className={styles.memberPanel}>
          <div className={styles.panelTitle}>
            {selectedDept ? `${selectedDept.name} - 成员` : '请选择部门'}
          </div>

          {memberLoading ? (
            <div className={styles.memberLoading}>加载中...</div>
          ) : selectedDept ? (
            members.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyIconWrap}>
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div className={styles.emptyText}>该部门暂无成员</div>
              </div>
            ) : (
              <div className={styles.memberList}>
                {members.map((member) => (
                  <div key={member.id} className={styles.memberCard}>
                    <div className={styles.memberAvatar}>
                      {member.name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className={styles.memberInfo}>
                      <div className={styles.memberName}>{member.name}</div>
                      <div className={styles.memberMeta}>
                        {member.email && <span>{member.email}</span>}
                        {member.mobile && <span>{member.mobile}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className={styles.empty}>
              <div className={styles.emptyIconWrap}>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div className={styles.emptyText}>从左侧选择部门查看成员</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}