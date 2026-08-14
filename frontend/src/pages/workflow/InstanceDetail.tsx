import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { WorkflowInstance, WorkflowHistory } from '../../types/workflow';
import { instanceApi } from '../../api/workflow';
import styles from './InstanceDetail.module.css';

interface InstanceDetailProps {
  embedded?: boolean;
  instanceId?: number;
  onBack?: () => void;
}

export default function InstanceDetail({ embedded, instanceId: propInstanceId, onBack }: InstanceDetailProps = {}) {
  const { id: paramId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const id = propInstanceId ?? (paramId ? Number(paramId) : undefined);
  const [instance, setInstance] = useState<WorkflowInstance | null>(null);
  const [history, setHistory] = useState<WorkflowHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      instanceApi.get(Number(id)),
      instanceApi.getHistory(Number(id)),
    ])
      .then(([inst, hist]) => {
        setInstance(inst);
        setHistory(hist);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; className: string }> = {
      RUNNING: { label: '审批中', className: styles.tagPending },
      COMPLETED: { label: '已通过', className: styles.tagApproved },
      REJECTED: { label: '已驳回', className: styles.tagRejected },
      CANCELLED: { label: '已取消', className: styles.tagCancelled },
      FROZEN: { label: '已冻结', className: styles.tagCancelled },
    };
    const item = map[status] || { label: status, className: styles.tagCancelled };
    return <span className={`${styles.statusBadge} ${item.className}`}><span className={styles.statusDot} />{item.label}</span>;
  };

  const actionLabel: Record<string, string> = {
    SUBMIT: '发起流程',
    APPROVE: '同意',
    REJECT: '驳回',
    TRANSFER: '转办',
    FORCE_STOP: '撤回',
    ADD_SIGN: '加签',
    FORCE_JUMP: '强制跳转',
    AUTO_ESCALATE: '自动升级',
  };

  if (loading) {
    return <div className={styles.loading}>加载中...</div>;
  }

  if (!instance) {
    return <div className={styles.error}>流程实例不存在</div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => onBack ? onBack() : navigate(-1)}>
          ← 返回
        </button>
        <h1 className={styles.title}>流程详情</h1>
      </div>

      <div className={styles.infoCard}>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>流程ID</span>
          <span className={styles.infoValue}>{instance.workflowId}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>发起人</span>
          <span className={styles.infoValue}>用户 #{instance.initiatorId}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>状态</span>
          <span className={styles.infoValue}>{statusBadge(instance.status)}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>发起时间</span>
          <span className={styles.infoValue}>{instance.startedAt ? new Date(instance.startedAt).toLocaleString('zh-CN') : '-'}</span>
        </div>
        {instance.completedAt && (
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>完成时间</span>
            <span className={styles.infoValue}>{new Date(instance.completedAt).toLocaleString('zh-CN')}</span>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>审批历史</h2>
        <div className={styles.timeline}>
        {history.map((item, index) => (
          <div key={item.id} className={styles.timelineItem}>
            <div className={styles.timelineDot} />
            {index < history.length - 1 && <div className={styles.timelineLine} />}
            <div className={styles.timelineContent}>
              <div className={styles.timelineHeader}>
                <span className={styles.timelineOperator}>操作人 #{item.operatorId}</span>
                <span className={styles.timelineAction}>
                  {actionLabel[item.action] || item.action}
                </span>
                <span className={styles.timelineTime}>
                  {new Date(item.createdAt).toLocaleString('zh-CN')}
                </span>
              </div>
              {item.comment && (
                <div className={styles.timelineComment}>{item.comment}</div>
              )}
              {item.toNodeId && (
                <div className={styles.timelineTarget}>
                  目标节点: {item.toNodeId}
                </div>
              )}
            </div>
          </div>
        ))}
        {history.length === 0 && (
            <div className={styles.emptyHistory}>暂无审批记录</div>
          )}
        </div>
      </div>
    </div>
  );
}