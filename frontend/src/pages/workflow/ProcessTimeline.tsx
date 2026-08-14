import type { WorkflowHistory } from '../../types/workflow';
import styles from './ProcessTimeline.module.css';

interface ProcessTimelineProps {
  history: WorkflowHistory[];
}

const ACTION_LABELS: Record<string, string> = {
  APPROVE: '审批通过',
  REJECT: '审批驳回',
  TRANSFER: '转办',
  DELEGATE: '委派',
  ADD_SIGN: '加签',
  CANCEL: '撤销',
  START: '发起流程',
  FREEZE: '冻结',
  UNFREEZE: '解冻',
  FORCE_JUMP: '强制跳转',
  FORCE_STOP: '强制终止',
};

const ACTION_COLORS: Record<string, string> = {
  APPROVE: '#52c41a',
  REJECT: '#ff4d4f',
  TRANSFER: '#fa8c16',
  DELEGATE: '#722ed1',
  ADD_SIGN: '#13c2c2',
  CANCEL: '#999',
  START: '#1890ff',
  FREEZE: '#fa8c16',
  UNFREEZE: '#52c41a',
  FORCE_JUMP: '#ff4d4f',
  FORCE_STOP: '#ff4d4f',
};

export default function ProcessTimeline({ history }: ProcessTimelineProps) {
  if (history.length === 0) {
    return (
      <div className={styles.empty}>
        <span>暂无流转记录</span>
      </div>
    );
  }

  return (
    <div className={styles.timeline}>
      {history.map((item, index) => {
        const isLast = index === history.length - 1;
        const actionLabel = ACTION_LABELS[item.action] || item.action;
        const actionColor = ACTION_COLORS[item.action] || '#999';

        return (
          <div key={item.id} className={styles.item}>
            <div className={styles.line}>
              <div
                className={styles.dot}
                style={{ background: actionColor }}
              />
              {!isLast && <div className={styles.connector} />}
            </div>
            <div className={styles.content}>
              <div className={styles.header}>
                <span className={styles.action} style={{ color: actionColor }}>
                  {actionLabel}
                </span>
                <span className={styles.time}>
                  {new Date(item.createdAt).toLocaleString('zh-CN')}
                </span>
              </div>
              <div className={styles.operator}>
                操作人 #{item.operatorId}
                {item.nodeId && (
                  <span className={styles.node}> · {item.nodeId}</span>
                )}
              </div>
              {item.comment && (
                <div className={styles.comment}>{item.comment}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}