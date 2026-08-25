import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkflowTask } from '../../types/workflow';
import { taskApi } from '../../api/workflow';
import styles from './MyTasks.module.css';

export default function MyTasks() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pending' | 'completed'>('pending');

  const goTo = (instanceId: number) => {
    navigate(`/work/instances/${instanceId}`);
  };

  useEffect(() => {
    setLoading(true);
    taskApi.list({ status: tab === 'pending' ? 'PENDING' : 'completed' })
      .then(setTasks)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tab]);

  const statusBadge = (status: string, action?: string | null) => {
    const isRejected = status === 'COMPLETED' && action === 'REJECT';
    const map: Record<string, { label: string; className: string }> = {
      PENDING: { label: '待审批', className: styles.tagPending },
      PROCESSING: { label: '处理中', className: styles.tagPending },
      COMPLETED: { label: isRejected ? '已驳回' : '已通过', className: isRejected ? styles.tagRejected : styles.tagCompleted },
      REJECTED: { label: '已驳回', className: styles.tagRejected },
      TRANSFERRED: { label: '已转办', className: styles.tagTransferred },
      CANCELLED: { label: '已取消', className: styles.tagCancelled },
    };
    const item = map[status] || { label: status, className: styles.tagCancelled };
    return <span className={`${styles.statusBadge} ${item.className}`}><span className={styles.statusDot} />{item.label}</span>;
  };

  if (loading) {
    return <div className={styles.loading}>加载中...</div>;
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>我的任务</h1>

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === 'pending' ? styles.tabActive : ''}`}
          onClick={() => setTab('pending')}
        >
          待审批
        </button>
        <button
          className={`${styles.tab} ${tab === 'completed' ? styles.tabActive : ''}`}
          onClick={() => setTab('completed')}
        >
          已处理
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIconWrap}>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <div className={styles.emptyText}>
            {tab === 'pending' ? '暂无待审批任务' : '暂无已处理任务'}
          </div>
        </div>
      ) : (
        <div className={styles.list}>
          {tasks.map((task) => {
            return (
              <div
                key={task.id}
                className={styles.card}
                onClick={() => goTo(task.instanceId)}
              >
                <div className={styles.cardHeader}>
                  <span className={styles.cardTitle}>{task.nodeName || task.nodeId}</span>
                  {statusBadge(task.status, task.action)}
                </div>
                <div className={styles.cardMeta}>
                  <span>类型: {task.assigneeType}</span>
                  <span>分配时间: {task.startedAt ? new Date(task.startedAt).toLocaleString('zh-CN') : '-'}</span>
                </div>
                {task.deadline && (
                  <div className={styles.cardDeadline}>
                    截止: {new Date(task.deadline).toLocaleString('zh-CN')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}