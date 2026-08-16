import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLoadingStore } from '../../stores/loadingStore';
import { useImpersonationStore } from '../../stores/impersonationStore';
import type { WorkflowTask, WorkflowInstance, WorkflowDefinition } from '../../types/workflow';
import { taskApi, instanceApi } from '../../api/workflow';
import { isImpersonating } from '../../utils/impersonation';
import { confirm } from '../../stores/confirmStore';
import type { WorkflowView } from '../AppEditor/AppEditorPage';
import styles from './MyWorkflow.module.css';

interface MyWorkflowProps {
  embedded?: boolean;
  workflows?: WorkflowDefinition[];
  appId?: number;
  onNavigate?: (view: WorkflowView) => void;
}

type TabKey = 'start' | 'initiated' | 'pending' | 'processed';

const BASE_TABS: { key: TabKey; label: string }[] = [
  { key: 'initiated', label: '我发起的' },
  { key: 'pending', label: '待审批' },
  { key: 'processed', label: '已处理' },
];

export default function MyWorkflow({ embedded, workflows, appId, onNavigate }: MyWorkflowProps = {}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const setGlobalLoading = useLoadingStore((s) => s.setLoading);
  const hasStartTab = !!workflows;
  const defaultTab: TabKey = hasStartTab ? 'start' : 'initiated';
  const tabFromUrl = searchParams.get('tab') as TabKey | null;
  const tab: TabKey = tabFromUrl && ['start', 'initiated', 'pending', 'processed'].includes(tabFromUrl) ? tabFromUrl : defaultTab;
  const setTab = (t: TabKey) => {
    setSearchParams({ tab: t }, { replace: true });
  };
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [loading, setLoading] = useState(true);

  const showTest = embedded ? isImpersonating() : false;
  const impersonationVersion = useImpersonationStore((s) => s.version);

  useEffect(() => {
    setGlobalLoading(loading);
  }, [loading, setGlobalLoading]);

  const goTo = (view: WorkflowView) => {
    if (onNavigate) {
      onNavigate(view);
    } else if (view.view === 'instance-detail' && view.appId != null) {
      navigate(`/apps/${view.appId}/instances/${view.instanceId}`);
    }
  };

  useEffect(() => {
    if (tab === 'start') {
      setLoading(false);
      return;
    }
    setLoading(true);
    if (tab === 'initiated') {
      instanceApi.list({ isTest: showTest })
        .then(setInstances)
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      taskApi.list({ status: tab === 'pending' ? 'PENDING' : 'completed', isTest: showTest })
        .then(setTasks)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [tab, showTest, impersonationVersion]);

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
  const isStartTab = tab === 'start';
  const tabs = hasStartTab
    ? [{ key: 'start' as TabKey, label: '发起流程' }, ...BASE_TABS]
    : BASE_TABS;

  return (
    <div className={`${styles.page} ${embedded ? styles.embedded : ''}`}>
      {!embedded && (
        <>
          <div className={styles.header}>
            <div>
              <h1 className={styles.title}>我的工作</h1>
              <p className={styles.subtitle}>查看我发起的流程和待处理的任务</p>
            </div>
          </div>
          <hr className={styles.divider} />
        </>
      )}

      <div className={styles.tabs}>
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? null : isStartTab ? (
        workflows!.length > 0 ? (
          <div className={styles.startList}>
            {workflows!.map((wf) => (
              <div key={wf.id} className={styles.startCard}>
                <div className={styles.startCardBody}>
                  <div className={styles.startCardName}>{wf.name}</div>
                  {wf.description && (
                    <div className={styles.startCardDesc}>{wf.description}</div>
                  )}
                </div>
                <div className={styles.startCardFooter}>
                  <span className={styles.startCardVersion}>v{wf.version}</span>
                  <button
                    className={styles.startCardBtn}
                    onClick={() => {
                      const targetAppId = appId || wf.applicationId;
                      navigate(`/apps/${targetAppId}/designer?processId=${wf.id}&mode=start`);
                    }}
                  >
                    发起
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyList}>暂无可用流程，请联系管理员发布流程</div>
        )
      ) : (isInitiatedTab ? (
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
            {instances.some(inst => inst.isTest) && (
              <div className={styles.testBanner}>
                <span className={styles.testBannerDot} />
                当前为测试数据视图
              </div>
            )}
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.cellCenter}>流程名称</th>
                    <th className={styles.cellId}>实例ID</th>
                    <th className={styles.cellCenter}>应用</th>
                    <th className={styles.cellCenter}>当前节点</th>
                    <th className={styles.cellCenter}>状态</th>
                    <th className={styles.cellCenter}>发起时间</th>
                    <th className={styles.cellActions}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {instances.map((inst) => (
                    <tr key={inst.id} className={inst.isTest ? styles.testRow : undefined}>
                      <td className={styles.cellCenter}>
                        <span className={styles.instanceName}>流程 #{inst.workflowId}</span>
                      </td>
                      <td className={styles.cellId}>
                        <code className={styles.idCode}>#{inst.id}</code>
                      </td>
                      <td className={styles.cellCenter}>
                        <span
                          className={styles.appLink}
                          onClick={() => navigate(`/apps/${inst.applicationId}`)}
                        >
                          {inst.applicationName || `应用 #${inst.applicationId}`}
                        </span>
                      </td>
                      <td className={styles.cellCenter}>{inst.currentNodes || '-'}</td>
                      <td className={styles.cellCenter}>{statusBadge(inst.status)}</td>
                      <td className={styles.cellCenter}>
                        {inst.startedAt ? new Date(inst.startedAt).toLocaleString('zh-CN') : '-'}
                      </td>
                      <td className={styles.cellActions}>
                        <button
                          className={styles.actionBtn}
                          onClick={() => goTo({ view: 'instance-detail', instanceId: inst.id, appId: inst.applicationId })}
                        >
                          查看详情
                        </button>
                        {inst.status === 'RUNNING' && (
                          <button
                            className={styles.actionBtnDanger}
                            onClick={async (e) => {
                              e.stopPropagation();
                              const confirmed = await confirm({
                                title: '撤销流程',
                                message: '确定要撤销该流程吗？',
                                confirmText: '撤销',
                                variant: 'danger',
                              });
                              if (!confirmed) return;
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
                    <th className={styles.cellCenter}>任务节点</th>
                    <th className={styles.cellId}>实例ID</th>
                    <th className={styles.cellCenter}>应用</th>
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
                      <td className={styles.cellCenter}>
                        <span className={styles.instanceName}>{task.nodeName || task.nodeId}</span>
                      </td>
                      <td className={styles.cellId}>
                        <code className={styles.idCode}>#{task.instanceId}</code>
                      </td>
                      <td className={styles.cellCenter}>
                        <span
                          className={styles.appLink}
                          onClick={() => navigate(`/apps/${task.applicationId}`)}
                        >
                          {task.applicationName || `应用 #${task.applicationId}`}
                        </span>
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
                          onClick={() => goTo({ view: 'instance-detail', instanceId: task.instanceId, appId: task.applicationId })}
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
      ))}
    </div>
  );
}