import { useState, useEffect, useCallback } from 'react';
import { listPendingApprovals, approvePermission, rejectPermission } from '@/api/tool';
import { useToastStore } from '@/stores/toastStore';
import type { PendingApproval } from '@/types/tool';
import './PermissionApprovalPage.css';

export default function PermissionApprovalPage() {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectModal, setRejectModal] = useState<{ permId: number; taskId: number } | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [approving, setApproving] = useState<number | null>(null);
  const toast = useToastStore((s) => s.add);

  const fetchApprovals = useCallback(async () => {
    try {
      const res = await listPendingApprovals();
      setApprovals(res.data);
    } catch {
      toast('加载待审批列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const handleApprove = async (permId: number, taskId: number) => {
    setApproving(permId);
    try {
      await approvePermission(permId, taskId, '同意');
      toast('审批通过', 'success');
      fetchApprovals();
    } catch {
      toast('审批失败', 'error');
    } finally {
      setApproving(null);
    }
  };

  const handleReject = async () => {
    if (!rejectModal || !rejectComment.trim()) {
      toast('请填写驳回原因', 'error');
      return;
    }
    try {
      await rejectPermission(rejectModal.permId, rejectModal.taskId, rejectComment);
      toast('已驳回', 'success');
      setRejectModal(null);
      setRejectComment('');
      fetchApprovals();
    } catch {
      toast('驳回失败', 'error');
    }
  };

  const openReject = (permId: number, taskId: number) => {
    setRejectModal({ permId, taskId });
    setRejectComment('');
  };

  if (loading) {
    return <div className="perm-approval-loading">加载中...</div>;
  }

  return (
    <div className="perm-approval">
      <h2 className="perm-approval-title">权限审批</h2>

      {approvals.length === 0 ? (
        <div className="perm-approval-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <p>暂无待审批申请</p>
        </div>
      ) : (
        <div className="perm-approval-list">
          {approvals.map((item) => (
            <div key={item.taskId} className="perm-approval-card">
              <div className="perm-approval-card-header">
                <div className="perm-approval-card-applicant">
                  <div className="perm-approval-card-avatar">
                    {item.applicant.charAt(0)}
                  </div>
                  <div>
                    <div className="perm-approval-card-name">{item.applicant}</div>
                    <div className="perm-approval-card-node">{item.nodeName}</div>
                  </div>
                </div>
                <span className="perm-approval-card-time">
                  {item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}
                </span>
              </div>
              <div className="perm-approval-card-body">
                <div className="perm-approval-card-subject">
                  申请 <strong>{item.systemName}</strong> 系统访问权限
                </div>
                <div className="perm-approval-card-reason">
                  <span className="perm-approval-card-label">申请原因：</span>
                  {item.reason || '无'}
                </div>
              </div>
              <div className="perm-approval-card-actions">
                <button
                  className="perm-approval-card-btn approve"
                  onClick={() => handleApprove(item.permissionId, item.taskId)}
                  disabled={approving === item.permissionId}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {approving === item.permissionId ? '处理中...' : '通过'}
                </button>
                <button
                  className="perm-approval-card-btn reject"
                  onClick={() => openReject(item.permissionId, item.taskId)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  驳回
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {rejectModal && (
        <div className="perm-approval-overlay" onClick={() => setRejectModal(null)}>
          <div className="perm-approval-form" onClick={(e) => e.stopPropagation()}>
            <h3 className="perm-approval-form-title">驳回申请</h3>
            <div className="perm-approval-form-field">
              <label>驳回原因（必填）</label>
              <textarea
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
                placeholder="请填写驳回原因"
                rows={3}
              />
            </div>
            <div className="perm-approval-form-actions">
              <button className="perm-approval-form-cancel" onClick={() => setRejectModal(null)}>取消</button>
              <button className="perm-approval-form-submit" onClick={handleReject}>确认驳回</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}