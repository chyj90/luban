import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { FormDefinition } from '../../types/workflow';
import { formApi } from '../../api/workflow';
import { confirm } from '../../stores/confirmStore';
import type { WorkflowView } from '../AppEditor/AppEditorPage';
import styles from './FormList.module.css';

interface FormListProps {
  embedded?: boolean;
  appId?: number;
  onNavigate?: (view: WorkflowView) => void;
}

export default function FormList({ embedded, appId: propAppId, onNavigate }: FormListProps = {}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const appId = propAppId ?? (searchParams.get('appId') ? Number(searchParams.get('appId')) : undefined);
  const [forms, setForms] = useState<FormDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  const goTo = (view: WorkflowView) => {
    if (onNavigate) {
      onNavigate(view);
    } else if (view.view === 'designer') {
      navigate(`/apps/${view.appId}/designer?formMode=true${view.formId ? `&formId=${view.formId}` : ''}`);
    } else if (view.view === 'form-preview') {
      navigate(`/apps/${view.appId}/forms/${view.formId}/preview`);
    }
  };

  useEffect(() => {
    formApi.list(appId ? { applicationId: Number(appId) } : undefined)
      .then(setForms)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [appId]);

  const handleDelete = async (id: number, name: string) => {
    const confirmed = await confirm({
      title: '删除表单',
      message: `确定要删除表单「${name}」吗？`,
      confirmText: '删除',
      variant: 'danger',
    });
    if (!confirmed) return;
    await formApi.delete(id);
    setForms((prev) => prev.filter((f) => f.id !== id));
  };

  const handlePublish = async (id: number) => {
    await formApi.publish(id);
    setForms((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: 'PUBLISHED' } : f)),
    );
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; className: string }> = {
      DRAFT: { label: '草稿', className: styles.statusDraft },
      PUBLISHED: { label: '已发布', className: styles.statusPublished },
      ARCHIVED: { label: '已归档', className: styles.statusArchived },
    };
    const item = map[status] || { label: status, className: styles.statusArchived };
    return <span className={`${styles.statusBadge} ${item.className}`}><span className={styles.statusDot} />{item.label}</span>;
  };

  if (loading) {
    return <div className={styles.loading}>加载中...</div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>表单管理</h1>
          <p className={styles.subtitle}>管理所有表单定义</p>
        </div>
        <button className={styles.createBtn} onClick={() => goTo({ view: 'designer', formMode: true })}>
          <svg className={styles.createBtnIcon} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          新建表单
        </button>
      </div>

      {forms.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIconWrap}>
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            </div>
          <div className={styles.emptyText}>暂无表单定义</div>
          <div className={styles.emptyHint}>点击"新建表单"创建第一个表单</div>
        </div>
      ) : (
        <div className={styles.card}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
            <thead>
              <tr>
                <th>表单名称</th>
                <th className={styles.cellCenter}>状态</th>
                <th className={styles.cellCenter}>更新时间</th>
                <th className={styles.cellActions}>操作</th>
              </tr>
            </thead>
            <tbody>
              {forms.map((form) => {
                return (
                  <tr key={form.id}>
                    <td>
                      <div className={styles.formName}>{form.name}</div>
                      {form.description && (
                        <div className={styles.formDesc}>{form.description}</div>
                      )}
                    </td>
                    <td className={styles.cellCenter}>
                      {statusBadge(form.status)}
                    </td>
                    <td className={styles.cellCenter}>
                      {new Date(form.updatedAt).toLocaleString('zh-CN')}
                    </td>
                    <td className={styles.cellActions}>
                      <button
                        className={styles.actionBtn}
                        onClick={() => goTo({ view: 'designer', formMode: true, formId: form.id })}
                      >
                        编辑
                      </button>
                      <button
                        className={styles.actionBtn}
                        onClick={() => goTo({ view: 'form-preview', formId: form.id })}
                      >
                        预览
                      </button>
                      {form.status === 'DRAFT' && (
                        <button
                          className={styles.actionBtnPrimary}
                          onClick={() => handlePublish(form.id)}
                        >
                          发布
                        </button>
                      )}
                      <button
                        className={styles.actionBtnDanger}
                        onClick={() => handleDelete(form.id, form.name)}
                      >
                        删除
                      </button>
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