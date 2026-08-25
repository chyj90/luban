import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardList, Play, ChevronLeft } from 'lucide-react';
import PageTopbar from '../../components/PageTopbar';
import { useLoadingStore } from '../../stores/loadingStore';
import type { WorkflowTask, WorkflowInstance } from '../../types/workflow';
import { taskApi, instanceApi } from '../../api/workflow';
import { listPendingApprovals } from '../../api/tool';
import { confirm } from '../../stores/confirmStore';
import { listAccessibleApplications, type AccessibleApp, type AccessibleWorkflow } from '../../api/application';
import type { WorkflowView } from '../AppEditor/AppEditorPage';
import FormRenderer from './FormRenderer';
import styles from './MyWorkflow.module.css';

interface MyWorkflowProps {
  embedded?: boolean;
  onNavigate?: (view: WorkflowView) => void;
}

type TabKey = 'start' | 'initiated' | 'pending' | 'processed';

const BASE_TABS: { key: TabKey; label: string }[] = [
  { key: 'start', label: '发起流程' },
  { key: 'initiated', label: '我发起的' },
  { key: 'pending', label: '待审批' },
  { key: 'processed', label: '已处理' },
];

export default function MyWorkflow({ embedded, onNavigate }: MyWorkflowProps = {}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const setGlobalLoading = useLoadingStore((s) => s.setLoading);
  const tabFromUrl = searchParams.get('tab') as TabKey | null;
  const tab: TabKey = tabFromUrl && ['start', 'initiated', 'pending', 'processed'].includes(tabFromUrl) ? tabFromUrl : 'start';
  const setTab = (t: TabKey) => {
    setSearchParams({ tab: t }, { replace: true });
  };
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [accessibleApps, setAccessibleApps] = useState<AccessibleApp[]>([]);
  const [startWf, setStartWf] = useState<{ appId: number; wf: AccessibleWorkflow; formId: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setGlobalLoading(loading);
  }, [loading, setGlobalLoading]);

  const goTo = (view: WorkflowView) => {
    if (onNavigate) {
      onNavigate(view);
    } else if (view.view === 'instance-detail') {
      navigate(`/work/instances/${view.instanceId}`);
    }
  };

  useEffect(() => {
    if (tab === 'start') {
      listAccessibleApplications().then((res) => {
        setAccessibleApps(res.data || []);
      }).catch(() => setAccessibleApps([]))
        .finally(() => setLoading(false));
      return;
    }
    setLoading(true);
    if (tab === 'initiated') {
      instanceApi.list()
        .then(setInstances)
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      taskApi.list({ status: tab === 'pending' ? 'PENDING' : 'completed' })
        .then(setTasks)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [tab]);

  useEffect(() => {
    if (!embedded) {
      listPendingApprovals()
        .then((res) => setPendingApprovalCount((res.data as unknown[]).length))
        .catch(() => setPendingApprovalCount(0));
    }
  }, [embedded]);

  const handleStartWorkflow = async (formData: Record<string, unknown>) => {
    if (!startWf) return;
    setSubmitting(true);
    try {
      await instanceApi.start({
        definitionId: startWf.wf.id,
        formData: JSON.stringify(formData),
      });
      setStartWf(null);
      setTab('initiated');
    } catch (e) {
      console.error('发起流程失败:', e);
    } finally {
      setSubmitting(false);
    }
  };

  const statusBadge = (status: string, action?: string | null) => {
    const isRejected = status === 'COMPLETED' && action === 'REJECT';
    const map: Record<string, { label: string; className: string }> = {
      PENDING: { label: '待审批', className: styles.tagPending },
      PROCESSING: { label: '处理中', className: styles.tagPending },
      COMPLETED: { label: isRejected ? '已驳回' : '已通过', className: isRejected ? styles.tagRejected : styles.tagCompleted },
      REJECTED: { label: '已驳回', className: styles.tagRejected },
      TRANSFERRED: { label: '已转办', className: styles.tagTransferred },
      CANCELLED: { label: '已取消', className: styles.tagCancelled },
      RUNNING: { label: '审批中', className: styles.tagRunning },
      FROZEN: { label: '已冻结', className: styles.tagFrozen },
    };
    const item = map[status] || { label: status, className: styles.tagCancelled };
    return <span className={`${styles.statusBadge} ${item.className}`}><span className={styles.statusDot} /><span>{item.label}</span></span>;
  };

  const assigneeTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      NORMAL: '正常',
      TRANSFER: '转办',
      DELEGATE: '委派',
      ADD_SIGN: '加签',
    };
    return map[type] || type;
  };

  const isInitiatedTab = tab === 'initiated';

  return (
    <div className={`${styles.page} ${embedded ? styles.embedded : ''}`}>
      {!embedded && (
        <PageTopbar
          icon={<ClipboardList size={22} />}
          title="我的工作"
          subtitle="查看我发起的流程、待处理的任务和平台审核"
          actions={
            <div className={styles.tabs}>
              {BASE_TABS.map((t) => (
                <button
                  key={t.key}
                  className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  {t.key === 'pending' && pendingApprovalCount > 0 && !embedded && (
                    <span className={styles.tagPending}>
                      {pendingApprovalCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          }
        />
      )}

      <div className={styles.content}>
      {tab === 'pending' && pendingApprovalCount > 0 && !embedded && (
        <div className={styles.testBanner} style={{ background: '#e6f4ff', borderColor: '#91caff' }}>
          <span className={styles.testBannerDot} style={{ background: '#1677ff' }} />
          您有 {pendingApprovalCount} 条待处理的平台审核
          <button
            className={styles.actionBtn}
            style={{ marginLeft: 12 }}
            onClick={() => navigate('/work/approvals')}
          >
            去处理
          </button>
        </div>
      )}

      {loading ? null : tab === 'start' ? (
        startWf ? (
          <div className={styles.formWrapper}>
            <div className={styles.formHeader}>
              <button className={styles.backBtn} onClick={() => setStartWf(null)} disabled={submitting}>
                <ChevronLeft size={16} />
                返回列表
              </button>
              <span className={styles.formTitle}>发起流程：{startWf.wf.name}</span>
            </div>
            <FormRenderer
              formId={startWf.formId}
              mode="submit"
              onSubmit={handleStartWorkflow}
            />
          </div>
        ) : (
          accessibleApps.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIconWrap}>
                <Play size={28} />
              </div>
              <h3>暂无可发起的流程</h3>
              <p>您还没有可发起流程的权限，请联系管理员分配</p>
            </div>
          ) : (
            <div className={styles.startList}>
              {accessibleApps.map((app) => (
                <div key={app.id} className={styles.startAppGroup}>
                  <div className={styles.startAppName}>{app.name}</div>
                  {app.workflows.length === 0 ? (
                    <div className={styles.startAppEmpty}>暂无可发起的流程</div>
                  ) : (
                    <div className={styles.startWorkflowGrid}>
                      {app.workflows.map((wf) => {
                        const defaultForm = wf.forms.find((f) => f.isDefault) || wf.forms[0];
                        return (
                          <div key={wf.id} className={styles.startWorkflowCard}>
                            <div className={styles.startWorkflowInfo}>
                              <div className={styles.startWorkflowName}>{wf.name}</div>
                              {wf.description && (
                                <div className={styles.startWorkflowDesc}>{wf.description}</div>
                              )}
                            </div>
                            <button
                              className={styles.startBtn}
                              disabled={!defaultForm}
                              onClick={() => {
                                if (defaultForm) {
                                  setStartWf({ appId: app.id, wf, formId: defaultForm.formId });
                                }
                              }}
                            >
                              <Play size={14} />
                              发起
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )
      ) : (isInitiatedTab ? (
        instances.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIconWrap}>
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <h3>暂无发起的流程</h3>
            <p>提交表单后，发起的流程会显示在这里</p>
          </div>
        ) : (
          <div className={styles.card}>
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
                    <tr key={inst.id}>
                      <td className={styles.cellCenter}>
                        <span className={styles.instanceName}>{inst.workflowName || `流程 #${inst.workflowId}`}</span>
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
                      <td className={styles.cellCenter}>{inst.pendingTasks?.map(t => t.nodeName || t.nodeId).join('、') || '-'}</td>
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
            <h3>
              {tab === 'pending' ? '暂无待审批任务' : '暂无已处理任务'}
            </h3>
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
                      <td className={styles.cellCenter}>{assigneeTypeLabel(task.assigneeType)}</td>
                      <td className={styles.cellCenter}>{statusBadge(task.status, task.action)}</td>
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
    </div>
  );
}