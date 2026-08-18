import { useState, useEffect, useCallback } from 'react';
import { Shield, Check, X, Clock, User, Key } from 'lucide-react';
import { listPendingApprovals, approvePermission, rejectPermission } from '@/api/tool';
import { useToastStore } from '@/stores/toastStore';
import { useConfirmStore } from '@/stores/confirmStore';
import './WorkApprovalPage.css';

interface ApprovalItem {
  approvalId: number;
  taskId: number;
  applicant: string;
  applicantName: string;
  systemName: string;
  toolName: string;
  reason: string;
  nodeName: string;
  createdAt: string;
}

export default function WorkApprovalPage() {
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToastStore((s) => s.add);
  const confirm = useConfirmStore((s) => s.show);

  const fetchApprovals = useCallback(async () => {
    try {
      const res = await listPendingApprovals();
      setApprovals(res.data as ApprovalItem[]);
    } catch {
      toast('加载审批列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const handleApprove = (item: ApprovalItem) => {
    confirm({
      title: '确认通过',
      message: `确定要通过「${item.applicantName}」对「${item.systemName}」的权限申请吗？`,
      onConfirm: async () => {
        try {
          await approvePermission(item.approvalId);
          toast('已通过', 'success');
          fetchApprovals();
        } catch {
          toast('操作失败', 'error');
        }
      },
    });
  };

  const handleReject = (item: ApprovalItem) => {
    confirm({
      title: '确认驳回',
      message: `确定要驳回「${item.applicantName}」对「${item.systemName}」的权限申请吗？`,
      confirmText: '驳回',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await rejectPermission(item.approvalId);
          toast('已驳回', 'success');
          fetchApprovals();
        } catch {
          toast('操作失败', 'error');
        }
      },
    });
  };

  if (loading) {
    return (
      <div className="work-approval__loading">
        <span>加载中...</span>
      </div>
    );
  }

  return (
    <div className="work-approval">
      <div className="work-approval__header">
        <div className="work-approval__header-left">
          <Shield size={20} />
          <h2>平台审核</h2>
          <span className="work-approval__count">{approvals.length} 条待审核</span>
        </div>
      </div>

      {approvals.length === 0 ? (
        <div className="work-approval__empty">
          <div className="work-approval__empty-icon">
            <Check size={32} />
          </div>
          <p>暂无待审核的权限申请</p>
        </div>
      ) : (
        <div className="work-approval__list">
          {approvals.map((item) => (
            <div key={item.approvalId} className="work-approval__card">
              <div className="work-approval__card-header">
                <div className="work-approval__card-type">
                  <Key size={14} />
                  <span>权限申请</span>
                </div>
                <span className="work-approval__card-time">
                  <Clock size={12} />
                  {item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : '-'}
                </span>
              </div>
              <div className="work-approval__card-body">
                <div className="work-approval__card-row">
                  <span className="work-approval__card-label">申请人</span>
                  <span className="work-approval__card-value">
                    <User size={13} />
                    {item.applicantName || item.applicant}
                  </span>
                </div>
                <div className="work-approval__card-row">
                  <span className="work-approval__card-label">目标系统</span>
                  <span className="work-approval__card-value">{item.systemName}</span>
                </div>
                {item.toolName && (
                  <div className="work-approval__card-row">
                    <span className="work-approval__card-label">申请工具</span>
                    <code className="work-approval__card-tool">{item.toolName}</code>
                  </div>
                )}
                <div className="work-approval__card-row">
                  <span className="work-approval__card-label">申请原因</span>
                  <span className="work-approval__card-reason">{item.reason || '-'}</span>
                </div>
                <div className="work-approval__card-row">
                  <span className="work-approval__card-label">审批节点</span>
                  <span className="work-approval__card-node">{item.nodeName}</span>
                </div>
              </div>
              <div className="work-approval__card-actions">
                <button
                  className="work-approval__btn-reject"
                  onClick={() => handleReject(item)}
                >
                  <X size={14} />
                  驳回
                </button>
                <button
                  className="work-approval__btn-approve"
                  onClick={() => handleApprove(item)}
                >
                  <Check size={14} />
                  通过
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}