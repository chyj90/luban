import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkflowInstance } from '../../types/workflow';
import { instanceApi } from '../../api/workflow';
import type { WorkflowView } from '../AppEditor/AppEditorPage';
import styles from './MyInstances.module.css';

interface MyInstancesProps {
  embedded?: boolean;
  onNavigate?: (view: WorkflowView) => void;
}

export default function MyInstances({ embedded, onNavigate }: MyInstancesProps = {}) {
  const navigate = useNavigate();
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [loading, setLoading] = useState(true);

  const goTo = (view: WorkflowView) => {
    if (onNavigate) {
      onNavigate(view);
    } else if (view.view === 'instance-detail') {
      navigate(`/workflow/instances/${view.instanceId}`);
    }
  };

  useEffect(() => {
    instanceApi.list()
      .then(setInstances)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; className: string }> = {
      RUNNING: { label: '审批中', className: styles.statusRunning },
      COMPLETED: { label: '已完成', className: styles.statusApproved },
      REJECTED: { label: '已驳回', className: styles.statusRejected },
      CANCELLED: { label: '已撤销', className: styles.statusCancelled },
      FROZEN: { label: '已冻结', className: styles.statusFrozen },
    };
    const item = map[status] || { label: status, className: styles.statusCancelled };
    return <span className={`${styles.statusBadge} ${item.className}`}><span className={styles.statusDot} />{item.label}</span>;
  };

  if (loading) {
    return <div className={styles.loading}>加载中...</div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>我发起的</h1>
          <p className={styles.subtitle}>查看我发起的所有流程</p>
        </div>
      </div>

      {instances.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIconWrap}>
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
          <div className={styles.emptyText}>暂无发起的流程</div>
          <div className={styles.emptyHint}>提交表单后，发起的流程会显示在这里</div>
        </div>
      ) : (
        <div className={styles.card}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>流程名称</th>
                  <th>当前节点</th>
                  <th>状态</th>
                  <th>发起时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((inst) => {
                  return (
                    <tr key={inst.id}>
                      <td>
                        <div className={styles.instanceName}>流程 #{inst.workflowId}</div>
                      </td>
                      <td className={styles.cellCenter}>
                        {inst.currentNodes || '-'}
                      </td>
                      <td className={styles.cellCenter}>
                        {statusBadge(inst.status)}
                      </td>
                      <td className={styles.cellCenter}>
                        {inst.startedAt ? new Date(inst.startedAt).toLocaleString('zh-CN') : '-'}
                      </td>
                      <td className={styles.cellActions}>
                        <button
                          className={styles.actionBtn}
                          onClick={() => goTo({ view: 'instance-detail', instanceId: inst.id })}
                        >
                          查看详情
                        </button>
                        {inst.status === 'RUNNING' && (
                          <button
                            className={styles.actionBtnDanger}
                            onClick={async () => {
                              if (!window.confirm('确定要撤销该流程吗？')) return;
                              await instanceApi.cancel(inst.id, 0, '');
                              setInstances((prev) =>
                                prev.map((i) =>
                                  i.id === inst.id ? { ...i, status: 'CANCELLED' } : i,
                                ),
                              );
                            }}
                          >
                            撤销
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}