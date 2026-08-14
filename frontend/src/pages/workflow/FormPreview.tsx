import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { FormDefinition } from '../../types/workflow';
import { formApi } from '../../api/workflow';
import FormRenderer from './FormRenderer';
import styles from './FormPreview.module.css';

interface FormPreviewProps {
  embedded?: boolean;
  formId?: number;
  onBack?: () => void;
}

export default function FormPreview({ embedded, formId: propFormId, onBack }: FormPreviewProps = {}) {
  const { id: paramId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const id = propFormId ?? (paramId ? Number(paramId) : undefined);
  const [form, setForm] = useState<FormDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop');

  useEffect(() => {
    if (!id) return;
    formApi.preview(Number(id))
      .then((data) => setForm(data as FormDefinition))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className={styles.loading}>加载中...</div>;
  }

  if (!form) {
    return <div className={styles.error}>表单不存在</div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => onBack ? onBack() : navigate('/workflow/forms')}>
          ← 返回
        </button>
        <h1 className={styles.title}>表单预览: {form.name}</h1>
        <div className={styles.modeTabs}>
          <button
            className={`${styles.modeTab} ${viewMode === 'desktop' ? styles.modeTabActive : ''}`}
            onClick={() => setViewMode('desktop')}
          >
            桌面端
          </button>
          <button
            className={`${styles.modeTab} ${viewMode === 'mobile' ? styles.modeTabActive : ''}`}
            onClick={() => setViewMode('mobile')}
          >
            移动端
          </button>
        </div>
      </div>

      <div className={viewMode === 'mobile' ? styles.mobileWrapper : styles.desktopWrapper}>
        <div className={viewMode === 'mobile' ? styles.mobileFrame : styles.desktopFrame}>
          <FormRenderer formId={form.id} mode="view" />
        </div>
      </div>
    </div>
  );
}