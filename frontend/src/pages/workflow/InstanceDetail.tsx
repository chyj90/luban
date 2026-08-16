import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { WorkflowInstance, WorkflowHistory, WorkflowTask } from '../../types/workflow';
import { instanceApi, formApi, workflowApi, taskApi } from '../../api/workflow';
import FormRenderer from './FormRenderer';
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
  const [workflowName, setWorkflowName] = useState<string>('');
  const [formDef, setFormDef] = useState<{ name: string; description?: string } | null>(null);
  const [myTask, setMyTask] = useState<WorkflowTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dialog, setDialog] = useState<{ type: 'approve' | 'reject' } | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      instanceApi.get(Number(id)),
      instanceApi.getHistory(Number(id)),
      taskApi.getByInstance(Number(id)).catch(() => null),
    ])
      .then(([inst, hist, task]) => {
        setInstance(inst);
        setHistory(hist);
        setMyTask(task);
        workflowApi.getDefinition(inst.workflowId).then(def => setWorkflowName(def.name));
        if (inst.formId > 0) {
          formApi.get(inst.formId).then(f => setFormDef({ name: f.name, description: f.description }));
        }
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

  const handleSubmit = async () => {
    if (!myTask?.id || !dialog) return;
    setSubmitting(true);
    try {
      if (dialog.type === 'approve') {
        await taskApi.approve(myTask.id, comment);
      } else {
        await taskApi.reject(myTask.id, comment);
      }
      setMyTask(null);
      setComment('');
      setDialog(null);
      const [inst, hist] = await Promise.all([instanceApi.get(Number(id)), instanceApi.getHistory(Number(id))]);
      setInstance(inst);
      setHistory(hist);
    } catch (e: any) {
      alert(e?.response?.data?.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const openDialog = (type: 'approve' | 'reject') => {
    setComment('');
    setDialog({ type });
  };

  const initialData = useMemo(() => {
    if (!instance?.formData) return {};
    try {
      return JSON.parse(instance.formData);
    } catch {
      return {};
    }
  }, [instance?.formData]);

  if (loading) {
    return <div className={styles.loading}>加载中...</div>;
  }

  if (!instance) {
    return <div className={styles.error}>流程实例不存在</div>;
  }

  return (
    <div className={styles.page} style={myTask && instance.status === 'RUNNING' ? { paddingTop: 64 } : undefined}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => onBack ? onBack() : navigate(-1)}>
          ← 返回
        </button>
        <h1 className={styles.title}>{workflowName || '流程详情'}</h1>
      </div>

      <div className={styles.infoCard}>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>流程ID</span>
          <span className={styles.infoValue}>{instance.workflowId}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>发起人</span>
          <span className={styles.infoValue}>{instance.initiatorName || `用户 #${instance.initiatorId}`}</span>
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
        <h2 className={styles.sectionTitle}>{formDef?.name || '表单数据'}</h2>
        {formDef?.description && (
          <p className={styles.sectionDesc}>{formDef.description}</p>
        )}
        <div className={styles.formDataCard}>
          <FormRenderer formId={instance.formId} mode="view" initialData={initialData} hideHeader />
        </div>
      </div>

      {myTask && instance.status === 'RUNNING' && (
        <div className={styles.approvalBar}>
          <div className={styles.approvalBarInner}>
            <div className={styles.approvalBarLeft}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 11l3 3L22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
              <span>待审批</span>
            </div>
            <div className={styles.approvalBarRight}>
              <button className={styles.approveBtnSm} onClick={() => openDialog('approve')}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                同意
              </button>
              <button className={styles.rejectBtnSm} onClick={() => openDialog('reject')}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                驳回
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog && (
        <div className={styles.overlay} onClick={() => setDialog(null)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <div className={styles.dialogHeader}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={dialog.type === 'approve' ? '#1677ff' : '#ef4444'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {dialog.type === 'approve'
                  ? <><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>
                  : <><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></>
                }
              </svg>
              <span>{dialog.type === 'approve' ? '确认同意' : '确认驳回'}</span>
            </div>
            <div className={styles.dialogBody}>
              <p className={styles.dialogHint}>
                {dialog.type === 'approve'
                  ? '确认同意该审批申请？'
                  : '确认驳回该审批申请？驳回后流程将回到发起人处。'}
              </p>
              <textarea
                className={styles.dialogTextarea}
                placeholder="审批意见（可选）"
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={3}
                autoFocus
              />
            </div>
            <div className={styles.dialogFooter}>
              <button className={styles.dialogCancel} onClick={() => setDialog(null)}>取消</button>
              <button
                className={dialog.type === 'approve' ? styles.dialogApprove : styles.dialogReject}
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? '提交中...' : '确认提交'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>审批历史</h2>
        <div className={styles.timeline}>
        {history.map((item, index) => (
          <div key={item.id} className={styles.timelineItem}>
            <div className={styles.timelineDot} />
            {index < history.length - 1 && <div className={styles.timelineLine} />}
            <div className={styles.timelineContent}>
              <div className={styles.timelineHeader}>
                <span className={styles.timelineOperator}>{item.operatorName || `操作人 #${item.operatorId}`}</span>
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