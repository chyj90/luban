import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkflowTask, WorkflowInstance } from '../../types/workflow';
import { taskApi, instanceApi } from '../../api/workflow';
import type { WorkflowView } from '../AppEditor/AppEditorPage';
import styles from './MyWorkflow.module.css';

interface MyWorkflowProps {
  embedded?: boolean;
  onNavigate?: (view: WorkflowView) => void;
}

type TabKey = 'initiated' | 'pending' | 'processed';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'initiated', label: '我发起的' },
  { key: 'pending', label: '待审批' },
  { key: 'processed', label: '已处理' },
];

export default function MyWorkflow({ onNavigate }: MyWorkflowProps = {}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>('initiated');
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [loading, setLoading] = useState(true);

  const goTo = (view: WorkflowView) => {
    if (onNavigate) {
      onNavigate(view);
    } else if (view.view === 'instance-detail') {
      navigate(`/workflow/instances/${view.instanceId}`);
    }
  };

  useEffect(() => {
    setLoading(true);
    if (tab === 'initiated') {
      instanceApi.list()
        .then(setInstances)
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      taskApi.list({ status: tab === 'pending' ? 'PENDING' : 'COMPLETED' })
        .then(setTasks)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [tab]);

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; className: string }> = {
      PENDING: { label: '待审批', className: styles.tagPending },
      COMPLETED: { label: '已通过', className: styles.tagCompleted },
      REJECTED: { label: '已驳回', className: styles.tagRejected },
      TRANSFERRED: { label: '已转办', className: styles.tagTransferred },
      CANCELLED: { label: '已取消', className: styles.tagCancelled },
      RUNNING: { label: '审批中', className: styles.tagRunning },
      FROZEN: { label: '已冻结', className: styles.tagFrozen },
    };
    const item = map[status] || { label: status, className: styles.tagCancelled };
    return <span className={`${styles.statusBadge} ${item.className}`}><span className={styles.statusDot} />{item.label}</span>;
  };

  const isInitiatedTab = tab === 'initiated';

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>我的工作</h1>
          <p className={styles.subtitle}>查看我发起的流程和待处理的任务</p>
        </div>
      </div>

      <hr className={styles.divider} />

      <div className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className={styles.loading}>加载中...</div>
      ) : isInitiatedTab ? (
        instances.length === 0 ? (
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
                    <th className={styles.cellCenter}>当前节点</th>
                    <th className={styles.cellCenter}>状态</th>
                    <th className={styles.cellCenter}>发起时间</th>
                    <th className={styles.cellActions}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {instances.map((inst) => (
                    <tr key={inst.id}>
                      <td>
                        <span className={styles.instanceName}>流程 #{inst.workflowId}</span>
                      </td>
                      <td className={styles.cellCenter}>{inst.currentNodes || '-'}</td>
                      <td className={styles.cellCenter}>{statusBadge(inst.status)}</td>
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
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!window.confirm('确定要撤销该流程吗？')) return;
                              await instanceApi.cancel(inst.id);
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
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : (
        tasks.length === 0 ? (
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
          <div className={styles.card}>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>任务节点</th>
                    <th className={styles.cellCenter}>类型</th>
                    <th className={styles.cellCenter}>状态</th>
                    <th className={styles.cellCenter}>分配时间</th>
                    <th className={styles.cellCenter}>截止时间</th>
                    <th className={styles.cellActions}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => (
                    <tr key={task.id}>
                      <td>
                        <span className={styles.instanceName}>{task.nodeId}</span>
                      </td>
                      <td className={styles.cellCenter}>{task.assigneeType}</td>
                      <td className={styles.cellCenter}>{statusBadge(task.status)}</td>
                      <td className={styles.cellCenter}>
                        {task.startedAt ? new Date(task.startedAt).toLocaleString('zh-CN') : '-'}
                      </td>
                      <td className={styles.cellCenter}>
                        {task.deadline ? new Date(task.deadline).toLocaleString('zh-CN') : '-'}
                      </td>
                      <td className={styles.cellActions}>
                        <button
                          className={styles.actionBtn}
                          onClick={() => goTo({ view: 'instance-detail', instanceId: task.instanceId })}
                        >
                          查看详情
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}