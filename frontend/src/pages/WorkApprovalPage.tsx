import { useState, useEffect, useCallback, Fragment } from 'react';
import { Shield, Check, X, Clock, User, Key } from 'lucide-react';
import PageTopbar from '@/components/PageTopbar';
import { listPendingApprovals, listProcessedApprovals, approvePermission, rejectPermission } from '@/api/tool';
import { useToastStore } from '@/stores/toastStore';
import { useConfirmStore } from '@/stores/confirmStore';
import './WorkApprovalPage.css';

interface FlowNode {
  nodeId: string;
  nodeType: string;
  nodeName: string;
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
}

interface FlowStatus {
  nodes: FlowNode[];
  edges: FlowEdge[];
  history: { nodeId: string; status: string }[];
}

interface ApprovalItem {
  type: string;
  taskId: number;
  permissionId: number;
  applicant: string;
  applicantName?: string;
  assigneeName?: string;
  nextNodeName?: string;
  nextApprover?: string;
  flowStatus?: FlowStatus;
  systemName: string;
  toolName?: string;
  keyName?: string;
  reason?: string;
  nodeName: string;
  createdAt: string;
  action?: string;
  comment?: string;
  completedAt?: string;
}

type TabKey = 'pending' | 'processed';

export default function WorkApprovalPage() {
  const [tab, setTab] = useState<TabKey>('pending');
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [processed, setProcessed] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToastStore((s) => s.show);
  const confirm = useConfirmStore((s) => s.confirm);

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

  const fetchProcessed = useCallback(async () => {
    try {
      const res = await listProcessedApprovals();
      setProcessed(res.data as ApprovalItem[]);
    } catch {
      toast('加载已处理列表失败', 'error');
    }
  }, [toast]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  useEffect(() => {
    if (tab === 'processed') {
      fetchProcessed();
    }
  }, [tab, fetchProcessed]);

  const handleApprove = async (item: ApprovalItem) => {
    const isTool = item.type === 'tool';
    const title = isTool ? `通过「${item.toolName}」权限申请` : `通过「${item.systemName}」权限申请`;
    const confirmed = await confirm({
      title: '确认通过',
      message: `确定要通过「${item.applicantName || item.applicant}」的${title}吗？`,
    });
    if (!confirmed) return;
    try {
      await approvePermission(item.permissionId, item.taskId, '同意');
      toast('已通过', 'success');
      fetchApprovals();
    } catch {
      toast('操作失败', 'error');
    }
  };

  const handleReject = async (item: ApprovalItem) => {
    const confirmed = await confirm({
      title: '确认驳回',
      message: `确定要驳回「${item.applicantName || item.applicant}」对「${item.systemName}」的权限申请吗？`,
      confirmText: '驳回',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await rejectPermission(item.permissionId, item.taskId, '驳回');
      toast('已驳回', 'success');
      fetchApprovals();
    } catch {
      toast('操作失败', 'error');
    }
  };

  if (loading) {
    return (
      <div className="work-approval__loading">
        <span>加载中...</span>
      </div>
    );
  }

  const currentList = tab === 'pending' ? approvals : processed;
  const emptyText = tab === 'pending' ? '暂无待审核的权限申请' : '暂无已处理的审批记录';

  return (
    <div className="work-approval">
      <PageTopbar
        icon={<Shield size={22} />}
        title="平台审核"
        subtitle="审核用户的权限申请，管理平台访问控制"
        actions={
          <div className="work-approval__tabs">
            <button
              className={`work-approval__tab ${tab === 'pending' ? 'work-approval__tab--active' : ''}`}
              onClick={() => setTab('pending')}
            >
              待审核
              {approvals.length > 0 && <span className="work-approval__badge">{approvals.length}</span>}
            </button>
            <button
              className={`work-approval__tab ${tab === 'processed' ? 'work-approval__tab--active' : ''}`}
              onClick={() => setTab('processed')}
            >
              已处理
            </button>
          </div>
        }
      />

      <div className="work-approval__content">
      {currentList.length === 0 ? (
        <div className="work-approval__empty">
          <div className="work-approval__empty-icon">
            <Shield size={48} />
          </div>
          <h3>{emptyText}</h3>
          <p>{tab === 'pending' ? '当用户申请工具或系统权限时，需要你在此审批' : '已处理的审批申请会显示在这里'}</p>
        </div>
      ) : (
        <div className="work-approval__list">
          {currentList.map((item) => (
            <div key={`${item.type}-${item.permissionId}-${item.taskId}`} className="work-approval__card">
              <div className="work-approval__card-header">
                <div className="work-approval__card-type">
                  <Key size={14} />
                  <span>{item.type === 'tool' ? '工具权限' : '系统权限'}</span>
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
                {item.keyName && (
                  <div className="work-approval__card-row">
                    <span className="work-approval__card-label">API Key</span>
                    <code className="work-approval__card-tool">{item.keyName}</code>
                  </div>
                )}
                <div className="work-approval__card-row">
                  <span className="work-approval__card-label">申请原因</span>
                  <span className="work-approval__card-reason">{item.reason || '-'}</span>
                </div>
                {tab === 'processed' && item.action && (
                  <div className="work-approval__card-row">
                    <span className="work-approval__card-label">处理结果</span>
                    <span className={`work-approval__card-result ${item.action === 'APPROVE' ? 'work-approval__card-result--approve' : 'work-approval__card-result--reject'}`}>
                      {item.action === 'APPROVE' ? '通过' : '驳回'}
                      {item.comment && ` - ${item.comment}`}
                    </span>
                  </div>
                )}
                {tab === 'processed' && item.nextNodeName && (
                  <div className="work-approval__card-row">
                    <span className="work-approval__card-label">下一节点</span>
                    <span className="work-approval__card-node">{item.nextNodeName}</span>
                  </div>
                )}
                {tab === 'processed' && item.nextApprover && (
                  <div className="work-approval__card-row">
                    <span className="work-approval__card-label">下一审批人</span>
                    <span className="work-approval__card-value">
                      <User size={13} />
                      {item.nextApprover}
                    </span>
                  </div>
                )}
              </div>
              {tab === 'pending' && (
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
              )}
              {item.flowStatus && item.flowStatus.nodes.length > 0 && (
                <div className="work-approval__flow">
                  <div className="work-approval__flow-bar">
                    {item.flowStatus.nodes.map((node, idx) => {
                      const historyEntry = item.flowStatus!.history.find(h => h.nodeId === node.nodeId);
                      let status = historyEntry?.status || 'pending';
                      const isApprovalNode = node.nodeType !== 'start' && node.nodeType !== 'end';
                      const isRejected = isApprovalNode && tab === 'processed' && item.action === 'REJECT';
                      if (isRejected && status === 'COMPLETED') {
                        status = 'REJECTED';
                      }
                      const isLast = idx === item.flowStatus!.nodes.length - 1;
                      const isCompleted = status === 'COMPLETED';
                      const isRejectedStatus = status === 'REJECTED';
                      return (
                        <Fragment key={node.nodeId}>
                          <div className="work-approval__flow-step">
                            <div className={`work-approval__flow-dot work-approval__flow-dot--${status}`}>
                              {isCompleted ? <Check size={10} /> : isRejectedStatus ? <X size={10} /> : status === 'ACTIVE' ? <Clock size={10} /> : null}
                            </div>
                            <span className={`work-approval__flow-name work-approval__flow-name--${status}`}>
                              {node.nodeName}
                            </span>
                            {(isCompleted || isRejectedStatus) && isApprovalNode && item.assigneeName && (
                              <span className="work-approval__flow-approver">
                                <User size={10} />
                                {item.assigneeName}
                              </span>
                            )}
                            {(isCompleted || isRejectedStatus) && isApprovalNode && tab === 'processed' && item.completedAt && (
                              <span className="work-approval__flow-time">
                                {new Date(item.completedAt).toLocaleString('zh-CN')}
                              </span>
                            )}
                          </div>
                          {!isLast && <div className={`work-approval__flow-line work-approval__flow-line--${status}`} />}
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}