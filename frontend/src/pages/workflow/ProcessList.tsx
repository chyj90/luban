import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { WorkflowDefinition, FormWorkflowBinding } from '../../types/workflow';
import { workflowApi, formApi, bindingApi } from '../../api/workflow';
import type { WorkflowView } from '../AppEditor/AppEditorPage';
import styles from './ProcessList.module.css';

interface ProcessListProps {
  embedded?: boolean;
  appId?: number;
  onNavigate?: (view: WorkflowView) => void;
}

export default function ProcessList({ embedded, appId: propAppId, onNavigate }: ProcessListProps = {}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const appId = propAppId ?? (searchParams.get('appId') ? Number(searchParams.get('appId')) : undefined);
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [bindings, setBindings] = useState<FormWorkflowBinding[]>([]);
  const [forms, setForms] = useState<{ id: number; name: string }[]>([]);
  const [bindPickerOpen, setBindPickerOpen] = useState<number | null>(null);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);

  const goTo = (view: WorkflowView) => {
    if (onNavigate) {
      onNavigate(view);
    } else if (view.view === 'designer') {
      navigate(`/apps/${appId}/designer/${view.processId || 'new'}`);
    }
  };

  useEffect(() => {
    workflowApi.listDefinitions(appId ? { applicationId: Number(appId) } : undefined)
      .then(setDefinitions)
      .catch(console.error)
      .finally(() => setLoading(false));
    bindingApi.list(appId ? { applicationId: Number(appId) } : undefined).then(setBindings).catch(() => {});
    formApi.list(appId ? { applicationId: Number(appId) } : undefined)
      .then((list) => setForms(list.map((f) => ({ id: f.id, name: f.name }))))
      .catch(() => {});
  }, [appId]);

  const filtered = definitions.filter((d) =>
    !search || d.name.toLowerCase().includes(search.toLowerCase())
  );

  const statusBadge = (status: string) => {
    switch (status) {
      case 'PUBLISHED':
        return <span className={`${styles.statusBadge} ${styles.statusPublished}`}><span className={styles.statusDot} />已发布</span>;
      case 'DRAFT':
        return <span className={`${styles.statusBadge} ${styles.statusDraft}`}><span className={styles.statusDot} />草稿</span>;
      case 'ARCHIVED':
        return <span className={`${styles.statusBadge} ${styles.statusArchived}`}><span className={styles.statusDot} />已归档</span>;
      default:
        return <span className={`${styles.statusBadge} ${styles.statusArchived}`}><span className={styles.statusDot} />{status}</span>;
    }
  };

  const getBoundForm = (workflowId: number) => {
    const binding = bindings.find((b) => b.workflowId === workflowId);
    if (!binding) return null;
    return forms.find((f) => f.id === binding.formId) || null;
  };

  const handleBindForm = async (workflowId: number, formId: number) => {
    try {
      const existing = bindings.find((b) => b.workflowId === workflowId);
      if (existing) {
        await bindingApi.unbind(existing.id);
      }
      await bindingApi.bind({ formId, workflowId });
      const updated = await bindingApi.list(appId ? { applicationId: Number(appId) } : undefined);
      setBindings(updated);
      setBindPickerOpen(null);
      setPickerPos(null);
    } catch (e: any) {
      console.error(e);
    }
  };

  const openBindPicker = (workflowId: number, btn: HTMLButtonElement) => {
    if (bindPickerOpen === workflowId) {
      setBindPickerOpen(null);
      setPickerPos(null);
      return;
    }
    const rect = btn.getBoundingClientRect();
    setPickerPos({ top: rect.bottom + 4, left: rect.left + rect.width / 2 });
    setBindPickerOpen(workflowId);
  };

  useEffect(() => {
    if (bindPickerOpen === null) return;
    const close = () => {
      setBindPickerOpen(null);
      setPickerPos(null);
    };
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(`.${styles.formPicker}`) &&
          !(e.target as HTMLElement).closest(`.${styles.bindFormBtn}`)) {
        close();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [bindPickerOpen]);

  if (loading) {
    return <div className={styles.loading}>加载中...</div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>流程管理</h1>
          <p className={styles.subtitle}>管理和设计自动化业务流程，提升组织运行效率</p>
        </div>
        <button className={styles.createBtn} onClick={() => goTo({ view: 'designer' })}>
          <svg className={styles.createBtnIcon} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          新建流程
        </button>
      </div>

      {filtered.length === 0 && !search ? (
        <div className={styles.card}>
          <div className={styles.empty}>
            <div className={styles.emptyIconWrap}>
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
            </div>
            <h3 className={styles.emptyTitle}>暂无流程定义</h3>
            <p className={styles.emptyDesc}>当前应用下还没有创建任何业务流程，点击上方「新建流程」按钮开始设计第一个流程。</p>
          </div>
        </div>
      ) : (
        <div className={styles.card}>
          <div className={styles.toolbar}>
            <div className={styles.toolbarLeft}>
              <span className={styles.count}>共 <span className={styles.countNum}>{filtered.length}</span> 个流程</span>
              <div className={styles.searchWrap}>
                <svg className={styles.searchIcon} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  className={styles.searchInput}
                  type="text"
                  placeholder="搜索流程名称..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>流程名称</th>
                  <th>关联表单</th>
                  <th>版本</th>
                  <th>状态</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((def) => (
                  <tr key={def.id}>
                    <td>
                      <div className={styles.processCell}>
                        <div className={styles.processIcon}>
                          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                          </svg>
                        </div>
                        <div>
                          <div className={styles.processName}>{def.name}</div>
                          {def.description && (
                            <div className={styles.processDesc}>{def.description}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className={styles.cellFormBind}>
                      {(() => {
                        const boundForm = getBoundForm(def.id);
                        return boundForm ? (
                          <span className={styles.boundFormName}>{boundForm.name}</span>
                        ) : (
                          <span className={styles.noFormBind}>未关联</span>
                        );
                      })()}
                      <button
                        className={styles.bindFormBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          openBindPicker(def.id, e.currentTarget);
                        }}
                      >
                        {getBoundForm(def.id) ? '更换' : '关联'}
                      </button>
                      </div>
                    </td>
                    <td>
                      {def.status === 'DRAFT' && def.publishedVersionId ? (
                        <span className={styles.versionInfo}>
                          已发布版本: v{def.version - 1} | 草稿版本: v{def.version} (编辑中)
                        </span>
                      ) : def.status === 'DRAFT' ? (
                        <span className={styles.versionInfo}>v{def.version} (草稿)</span>
                      ) : (
                        <span className={styles.versionInfo}>v{def.version} (已发布)</span>
                      )}
                    </td>
                    <td>{statusBadge(def.status)}</td>
                    <td>
                      {new Date(def.updatedAt).toLocaleString('zh-CN')}
                    </td>
                    <td className={styles.cellActions}>
                      <button
                        className={styles.actionBtn}
                        onClick={() => goTo({ view: 'designer', processId: def.id })}
                      >
                        {def.status === 'DRAFT' ? '编辑' : '查看'}
                      </button>
                      {def.status === 'DRAFT' && (
                        <button
                          className={styles.actionBtnPrimary}
                          onClick={() => {
                            if (!window.confirm(
                              `确认发布流程「${def.name}」？\n\n` +
                              `版本: v${def.version}\n` +
                              `发布后，所有用户将可使用此版本发起流程。`
                            )) return;
                            workflowApi.publishDefinition(def.id).then(() => {
                              setDefinitions((prev) =>
                                prev.map((d) =>
                                  d.id === def.id ? { ...d, status: 'PUBLISHED' as const } : d,
                                ),
                              );
                            });
                          }}
                        >
                          发布
                        </button>
                      )}
                      {def.status === 'PUBLISHED' && (
                        <button
                          className={styles.actionBtn}
                          onClick={() => {
                            workflowApi.unpublishDefinition(def.id).then(() => {
                              setDefinitions((prev) =>
                                prev.map((d) =>
                                  d.id === def.id ? { ...d, status: 'DRAFT' as const } : d,
                                ),
                              );
                            });
                          }}
                        >
                          下线
                        </button>
                      )}
                      <button
                        className={styles.actionBtnDanger}
                        onClick={() => {
                          if (confirm('确认删除该流程？')) {
                            workflowApi.deleteDefinition(def.id).then(() => {
                              setDefinitions((prev) => prev.filter((d) => d.id !== def.id));
                            });
                          }
                        }}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.pagination}>
            <span className={styles.paginationInfo}>共 {filtered.length} 条记录</span>
            <div className={styles.paginationBtns}>
              <button className={styles.pageBtn}>上一页</button>
              <button className={styles.pageBtnActive}>1</button>
              <button className={styles.pageBtn}>下一页</button>
            </div>
          </div>
        </div>
      )}
      {bindPickerOpen !== null && pickerPos && createPortal(
        <div
          className={styles.formPicker}
          style={{ position: 'fixed', top: pickerPos.top, left: pickerPos.left, transform: 'translateX(-50%)' }}
        >
          {forms.length === 0 ? (
            <div className={styles.formPickerEmpty}>暂无可选表单</div>
          ) : (
            forms.map((form) => (
              <div
                key={form.id}
                className={styles.formPickerItem}
                onClick={() => handleBindForm(bindPickerOpen, form.id)}
              >
                {form.name}
              </div>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
}